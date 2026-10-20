/**
 * NEXA Privileged VPN Helper — entry point.
 *
 * This is the ONLY component that runs with elevated privileges. It does
 * exactly one thing: accept newline-delimited JSON requests, hand each to
 * `handleHelperRequest` (which validates + performs a single allowlisted
 * WireGuard operation via `execFile`), and write the JSON response back.
 *
 * There is NO generic command path, NO shell, NO arbitrary executable, NO
 * arbitrary filesystem access. See NEXA_P4_1_PRIVILEGED_HELPER_SECURITY.md.
 *
 * Two transports:
 *   - default: a unix domain socket / Windows named pipe at the platform
 *     endpoint (PRODUCTION). The socket is created 0600 and root-owned.
 *   - `--stdio`: read/write over stdio (useful for supervised launch/testing).
 *
 * Packaging/signing/installation (SMAppService / Windows Service / polkit) is a
 * production step documented in NEXA_P4_2_SIGNING_AND_INSTALLER.md. This file
 * is intentionally standalone so it can be built + signed separately from the
 * Electron app bundle.
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeMessages, encodeMessage } from '../main/services/vpn-helper/protocol'
import { handleHelperRequest, type CommandResult, type CommandRunner, type HelperDeps, type TempConfig } from '../main/services/vpn-helper/handler'
import { helperEndpoint } from '../main/services/vpn-helper/endpoint'

function platformKind(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

/** Per-connection receive-buffer ceiling (> MAX_MESSAGE_BYTES). A client that
 * streams data without a newline, or an oversized single frame, is dropped
 * instead of growing the privileged process's memory without bound. */
const MAX_HELPER_BUFFER = 256 * 1024
/** Drop idle sockets so a parked connection cannot pin a slot indefinitely. */
const SOCKET_IDLE_MS = 30_000
/** Cap concurrent connections to the privileged helper. */
const MAX_HELPER_CONNECTIONS = 8
/** Fixed, minimal PATH for every privileged exec — never the inherited PATH,
 * so an attacker-influenced environment cannot redirect `wg`/`wg-quick` or the
 * tools they call (`ip`/`iptables`/`resolvconf`). */
const SAFE_PATH = process.platform === 'win32' ? process.env.PATH || '' : '/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/bin:/opt/homebrew/bin'

/** Fixed, validated executable discovery — never a renderer-provided path. */
function resolveExecutable(candidates: string[], bareName: string): string {
  for (const c of candidates) if (existsSync(c)) return c
  return bareName // rely on PATH; execFile with shell:false keeps this safe
}

function wgPaths(): { wg: string; wgQuick: string } {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    return { wg: join(pf, 'WireGuard', 'wg.exe'), wgQuick: join(pf, 'WireGuard', 'wireguard.exe') }
  }
  return {
    wg: resolveExecutable(['/usr/bin/wg', '/usr/local/bin/wg', '/opt/homebrew/bin/wg'], 'wg'),
    wgQuick: resolveExecutable(['/usr/bin/wg-quick', '/usr/local/bin/wg-quick', '/opt/homebrew/bin/wg-quick'], 'wg-quick')
  }
}

const realRunner: CommandRunner = {
  run(cmd, args, timeoutMs) {
    return new Promise<CommandResult>((resolve) => {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, shell: false, env: { PATH: SAFE_PATH } }, (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          const spawnError = e.code === 'ENOENT' ? 'enoent' : e.code === 'EACCES' || e.code === 'EPERM' ? 'eacces' : e.killed ? 'timeout' : 'other'
          resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout: String(stdout || ''), stderr: String(stderr || ''), spawnError })
          return
        }
        resolve({ code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
      })
    })
  }
}

const realTempConfig: TempConfig = {
  write(interfaceName, contents) {
    const base = join(tmpdir(), 'nexa-vpn-helper')
    mkdirSync(base, { recursive: true, mode: 0o700 })
    const dir = mkdtempSync(join(base, 'run-'))
    const path = join(dir, `${interfaceName}.conf`)
    writeFileSync(path, contents, { mode: 0o600 })
    return path
  },
  cleanup(path) {
    try {
      rmSync(path, { force: true })
    } catch {
      /* best-effort */
    }
  }
}

const deps: HelperDeps = {
  runner: realRunner,
  tempConfig: realTempConfig,
  paths: wgPaths(),
  platform: platformKind(),
  logger: {
    // stderr only, never stdout (stdout is a protocol channel in stdio mode).
    // Secrets are already redacted by the handler before logging.
    info: (event, meta) => process.stderr.write(`${JSON.stringify({ level: 'info', event, ...meta })}\n`),
    warn: (event, meta) => process.stderr.write(`${JSON.stringify({ level: 'warn', event, ...meta })}\n`)
  }
}

/**
 * Wire one bidirectional line-delimited connection through the handler.
 * `onOverflow` fires if the peer exceeds the receive-buffer ceiling (memory-
 * exhaustion guard); the caller tears the connection down.
 */
function serveConnection(write: (line: string) => void, onOverflow?: () => void): (chunk: string) => void {
  let buffer = ''
  let overflowed = false
  return (chunk: string) => {
    if (overflowed) return
    buffer += chunk
    if (buffer.length > MAX_HELPER_BUFFER) {
      overflowed = true
      buffer = ''
      onOverflow?.()
      return
    }
    const { messages, rest } = decodeMessages(buffer)
    buffer = rest
    // Pass the serialized byte length so the handler's MAX_MESSAGE_BYTES cap is
    // actually enforced server-side (previously rawBytes was never provided).
    for (const msg of messages) {
      const rawBytes = Buffer.byteLength(JSON.stringify(msg) || '', 'utf8')
      void handleHelperRequest(msg, deps, rawBytes).then((res) => write(encodeMessage(res)))
    }
  }
}

function startStdio(): void {
  process.stdin.setEncoding('utf8')
  const onData = serveConnection((line) => process.stdout.write(line))
  process.stdin.on('data', onData)
  process.stdin.on('end', () => process.exit(0))
}

function startSocket(): void {
  const endpoint = helperEndpoint(platformKind())
  // Unix sockets must be removed before re-listening; owned root:wheel, 0600.
  if (endpoint.kind === 'unix-socket' && existsSync(endpoint.path)) {
    try {
      unlinkSync(endpoint.path)
    } catch {
      /* ignore */
    }
  }
  let openConnections = 0
  const server = net.createServer((socket) => {
    if (openConnections >= MAX_HELPER_CONNECTIONS) {
      socket.destroy()
      return
    }
    openConnections++
    socket.setEncoding('utf8')
    socket.setTimeout(SOCKET_IDLE_MS, () => socket.destroy())
    socket.on('close', () => {
      openConnections = Math.max(0, openConnections - 1)
    })
    const onData = serveConnection(
      (line) => {
        if (!socket.destroyed) socket.write(line)
      },
      () => socket.destroy()
    )
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  })
  // A bind failure (EADDRINUSE/EACCES) must not crash the privileged process
  // with an unhandled 'error' event.
  server.on('error', (err) => {
    deps.logger?.warn('helper.listen_error', { code: (err as NodeJS.ErrnoException).code || 'unknown' })
    process.exit(1)
  })
  if (endpoint.kind === 'unix-socket') {
    // Create the socket 0600 from the moment it is bound (close the window
    // where it briefly existed group/world-accessible before the old chmod).
    try {
      process.umask(0o177)
    } catch {
      /* umask unavailable; chmod fallback below still applies */
    }
  }
  server.listen(endpoint.path, () => {
    if (endpoint.kind === 'unix-socket') {
      try {
        chmodSync(endpoint.path, 0o600)
      } catch (err) {
        // Fail closed: if we cannot restrict the socket we must not keep serving
        // privileged operations on a potentially world-accessible endpoint.
        deps.logger?.warn('helper.socket_perms_failed', { code: (err as NodeJS.ErrnoException).code || 'unknown' })
        server.close()
        process.exit(1)
      }
    }
  })
  const shutdown = () => {
    server.close()
    if (endpoint.kind === 'unix-socket') {
      try {
        rmSync(endpoint.path, { force: true })
      } catch {
        /* ignore */
      }
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv.includes('--stdio')) startStdio()
else startSocket()
