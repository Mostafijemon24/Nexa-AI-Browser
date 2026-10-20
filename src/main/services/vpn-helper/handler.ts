import type { ParsedWgConfig } from '../../../shared/vpn'
import {
  HelperRequestError,
  helperErrorMessage,
  redactHelperRequest,
  validateHelperRequest,
  type HandshakeResult,
  type HelperErrorCode,
  type HelperRequest,
  type HelperResponse,
  type HelperTunnelConfig,
  type ProbeResult,
  HELPER_PROTOCOL_VERSION
} from '../../../shared/vpn-helper'
import { buildWgQuickConfig, parseWgDump } from '../vpn-platform/base'

/**
 * Helper-side request handler. THIS is the code that runs inside the privileged
 * helper. It is intentionally the ONLY thing the helper does: it re-validates
 * every request, then performs exactly one allowlisted operation via a
 * validated `execFile` invocation. There is no generic command path.
 *
 * All OS interaction is injected (CommandRunner / TempConfig / Logger) so the
 * full decision + argument-construction logic is deterministically testable
 * without any privilege or real WireGuard install.
 */

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  /** Set when the process could not be started / timed out. */
  spawnError?: 'enoent' | 'eacces' | 'timeout' | 'other'
}

export interface CommandRunner {
  /** Execute a fixed binary with an argument array. NEVER a shell string. */
  run(cmd: string, args: string[], timeoutMs: number): Promise<CommandResult>
}

export interface TempConfig {
  /** Write a 0600 config, return its path. */
  write(interfaceName: string, contents: string): string
  /** Remove a previously written config (best effort). */
  cleanup(path: string): void
}

export interface HelperLogger {
  info(event: string, meta?: Record<string, unknown>): void
  warn(event: string, meta?: Record<string, unknown>): void
}

export interface HelperDeps {
  runner: CommandRunner
  tempConfig: TempConfig
  paths: { wg: string; wgQuick: string }
  platform: 'macos' | 'windows' | 'linux'
  logger?: HelperLogger
}

const noopLogger: HelperLogger = { info: () => {}, warn: () => {} }

function ok(requestId: string, result: unknown): HelperResponse {
  return { protocol: HELPER_PROTOCOL_VERSION, requestId, ok: true, result }
}

function fail(requestId: string, code: HelperErrorCode): HelperResponse {
  return { protocol: HELPER_PROTOCOL_VERSION, requestId, ok: false, error: { code, message: helperErrorMessage(code) } }
}

/** Map a failed CommandResult to a stable helper error code (never raw stderr). */
function mapRunFailure(res: CommandResult, fallback: HelperErrorCode): HelperErrorCode {
  if (res.spawnError === 'enoent') return 'VPN_WIREGUARD_UNAVAILABLE'
  if (res.spawnError === 'eacces') return 'VPN_PERMISSION_DENIED'
  if (res.spawnError === 'timeout') return 'VPN_HELPER_TIMEOUT'
  if (/permission denied|must be run as root|operation not permitted/i.test(res.stderr || '')) return 'VPN_PERMISSION_DENIED'
  return fallback
}

function toParsedConfig(c: HelperTunnelConfig): ParsedWgConfig {
  return {
    privateKey: c.privateKey,
    presharedKey: c.presharedKey,
    address: c.address,
    dns: c.dns,
    mtu: c.mtu,
    peerPublicKey: c.peerPublicKey,
    endpoint: c.endpoint,
    allowedIPs: c.allowedIPs,
    persistentKeepalive: c.persistentKeepalive
  }
}

export async function handleHelperRequest(raw: unknown, deps: HelperDeps, rawBytes?: number): Promise<HelperResponse> {
  const log = deps.logger || noopLogger
  let requestId = 'unknown'
  try {
    const { op, requestId: rid, payload } = validateHelperRequest(raw, rawBytes)
    requestId = rid
    // Audit-safe log: secrets redacted, no arbitrary payload echo.
    log.info('helper.request', { op, requestId, ...redactMeta(raw) })

    switch (op) {
      case 'probeWireGuard':
        return ok(requestId, await probe(deps))
      case 'bringTunnelUp':
        return await bringUp(requestId, payload as { interfaceName: string; config: HelperTunnelConfig }, deps)
      case 'bringTunnelDown':
        return await bringDown(requestId, (payload as { interfaceName: string }).interfaceName, deps)
      case 'queryHandshakeState':
        return await queryHandshake(requestId, (payload as { interfaceName: string }).interfaceName, deps)
      case 'enableKillSwitch':
      case 'disableKillSwitch':
        // Real OS-enforced kill switch is not implemented in P4.1 -> honest EXPERIMENTAL.
        return ok(requestId, { enforced: false, experimental: true })
      default:
        return fail(requestId, 'VPN_UNKNOWN_OPERATION')
    }
  } catch (err) {
    if (err instanceof HelperRequestError) {
      log.warn('helper.reject', { code: err.code, requestId })
      return fail(requestId, err.code)
    }
    log.warn('helper.error', { requestId })
    return fail(requestId, 'VPN_INTERFACE_FAILED')
  }
}

function redactMeta(raw: unknown): Record<string, unknown> {
  try {
    const r = raw as HelperRequest
    if (r && typeof r === 'object' && 'op' in r) {
      const red = redactHelperRequest(r)
      return { interfaceName: (red.payload as { interfaceName?: string })?.interfaceName }
    }
  } catch {
    /* ignore */
  }
  return {}
}

async function probe(deps: HelperDeps): Promise<ProbeResult> {
  const res = await deps.runner.run(deps.paths.wg, ['--version'], 5000)
  if (res.spawnError === 'enoent') return { available: false, implementation: 'unknown' }
  const version = (res.stdout.match(/v?\d+\.\d+(\.\d+)?/) || [])[0]
  const impl = deps.platform === 'windows' ? 'wireguard-nt' : 'wireguard-tools'
  return { available: true, implementation: impl, version }
}

async function bringUp(
  requestId: string,
  payload: { interfaceName: string; config: HelperTunnelConfig },
  deps: HelperDeps
): Promise<HelperResponse> {
  const { interfaceName, config } = payload
  const parsed = toParsedConfig(config)
  const confText = buildWgQuickConfig(parsed, config.ipv6)
  const path = deps.tempConfig.write(interfaceName, confText)
  try {
    const res = await deps.runner.run(deps.paths.wgQuick, ['up', path], 20_000)
    if (res.code !== 0 || res.spawnError) {
      // wg-quick rolls back its own partial config on failure; ensure teardown anyway.
      await safeDown(interfaceName, deps)
      return fail(requestId, mapRunFailure(res, 'VPN_INTERFACE_FAILED'))
    }
    return ok(requestId, { interfaceName, up: true })
  } finally {
    // Remove the on-disk private key immediately regardless of outcome.
    deps.tempConfig.cleanup(path)
  }
}

async function safeDown(interfaceName: string, deps: HelperDeps): Promise<void> {
  try {
    await deps.runner.run(deps.paths.wgQuick, ['down', interfaceName], 20_000)
  } catch {
    /* best-effort rollback */
  }
}

async function bringDown(requestId: string, interfaceName: string, deps: HelperDeps): Promise<HelperResponse> {
  const res = await deps.runner.run(deps.paths.wgQuick, ['down', interfaceName], 20_000)
  // Idempotent: "is not a WireGuard interface" / already-down is treated as success.
  if (res.code !== 0 && !res.spawnError && /is not a wireguard interface|no such|does not exist/i.test(res.stderr || '')) {
    return ok(requestId, { interfaceName, down: true })
  }
  if (res.code !== 0 || res.spawnError) return fail(requestId, mapRunFailure(res, 'VPN_INTERFACE_FAILED'))
  return ok(requestId, { interfaceName, down: true })
}

async function queryHandshake(requestId: string, interfaceName: string, deps: HelperDeps): Promise<HelperResponse> {
  const res = await deps.runner.run(deps.paths.wg, ['show', interfaceName, 'dump'], 5000)
  if (res.spawnError === 'enoent') return fail(requestId, 'VPN_WIREGUARD_UNAVAILABLE')
  if (res.code !== 0) {
    // Interface absent -> report down rather than error, so callers can decide.
    const result: HandshakeResult = { interfaceUp: false, handshakeAgeSec: null, rxBytes: null, txBytes: null, endpoint: null }
    return ok(requestId, result)
  }
  const h = parseWgDump(res.stdout)
  const result: HandshakeResult = {
    interfaceUp: !!h.interfaceUp,
    handshakeAgeSec: h.handshakeAgeSec ?? null,
    rxBytes: h.rxBytes ?? null,
    txBytes: h.txBytes ?? null,
    endpoint: h.endpoint ?? null
  }
  return ok(requestId, result)
}
