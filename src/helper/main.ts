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
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, shell: false, env: { PATH: process.env.PATH || '' } }, (err, stdout, stderr) => {
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

/** Wire one bidirectional line-delimited connection through the handler. */
function serveConnection(write: (line: string) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    const { messages, rest } = decodeMessages(buffer)
    buffer = rest
    for (const msg of messages) void handleHelperRequest(msg, deps).then((res) => write(encodeMessage(res)))
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
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    const onData = serveConnection((line) => {
      if (!socket.destroyed) socket.write(line)
    })
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  })
  server.listen(endpoint.path, () => {
    if (endpoint.kind === 'unix-socket') {
      try {
        chmodSync(endpoint.path, 0o600)
      } catch {
        /* best-effort; installer sets ownership root:wheel */
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
