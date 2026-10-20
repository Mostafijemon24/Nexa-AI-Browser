import { z } from 'zod'
import { isValidCidr, isValidEndpoint, isValidWgKey, isValidIpv4, isValidIpv6, type Ipv6Policy } from './vpn'

/**
 * P4.1 privileged-helper protocol.
 *
 * The helper is a NARROW capability service: it exposes ONLY the operations in
 * HELPER_OPS. There is no generic command execution. Every request is validated
 * here (client-side) and MUST be re-validated inside the helper before any
 * privileged action is taken.
 */

export const HELPER_PROTOCOL_VERSION = 1

export const HELPER_OPS = [
  'probeWireGuard',
  'bringTunnelUp',
  'bringTunnelDown',
  'queryHandshakeState',
  'enableKillSwitch',
  'disableKillSwitch'
] as const
export type HelperOp = (typeof HELPER_OPS)[number]

export function isHelperOp(x: unknown): x is HelperOp {
  return typeof x === 'string' && (HELPER_OPS as readonly string[]).includes(x)
}

/* ------------------------------------------------------------------ *
 * Stable, safe error codes (never raw stderr / paths / stack traces)
 * ------------------------------------------------------------------ */

export const HELPER_ERRORS = [
  'VPN_HELPER_NOT_INSTALLED',
  'VPN_HELPER_UNAUTHORIZED',
  'VPN_HELPER_UNAVAILABLE',
  'VPN_HELPER_PROTOCOL_ERROR',
  'VPN_HELPER_TIMEOUT',
  'VPN_HELPER_VERSION_MISMATCH',
  'VPN_WIREGUARD_UNAVAILABLE',
  'VPN_INVALID_CONFIG',
  'VPN_INVALID_REQUEST',
  'VPN_UNKNOWN_OPERATION',
  'VPN_INTERFACE_FAILED',
  'VPN_ROUTE_FAILED',
  'VPN_DNS_FAILED',
  'VPN_KILLSWITCH_FAILED',
  'VPN_HANDSHAKE_TIMEOUT',
  'VPN_HEALTH_CHECK_FAILED',
  'VPN_ROLLBACK_FAILED',
  'VPN_PERMISSION_DENIED',
  'VPN_UNSUPPORTED_PLATFORM'
] as const
export type HelperErrorCode = (typeof HELPER_ERRORS)[number]

const HELPER_ERROR_MESSAGES: Record<string, string> = {
  VPN_HELPER_NOT_INSTALLED: 'The NEXA VPN helper is not installed.',
  VPN_HELPER_UNAUTHORIZED: 'The NEXA VPN helper rejected the request (unauthorized).',
  VPN_HELPER_UNAVAILABLE: 'The NEXA VPN helper is not available.',
  VPN_HELPER_PROTOCOL_ERROR: 'The NEXA VPN helper returned an unexpected response.',
  VPN_HELPER_TIMEOUT: 'The NEXA VPN helper did not respond in time.',
  VPN_HELPER_VERSION_MISMATCH: 'The NEXA VPN helper version is incompatible.',
  VPN_WIREGUARD_UNAVAILABLE: 'WireGuard is not available on this system.',
  VPN_INVALID_CONFIG: 'The WireGuard configuration is invalid.',
  VPN_INVALID_REQUEST: 'The VPN request was rejected as invalid.',
  VPN_UNKNOWN_OPERATION: 'The VPN operation is not supported.',
  VPN_INTERFACE_FAILED: 'NEXA could not create the VPN network interface.',
  VPN_ROUTE_FAILED: 'NEXA could not install the VPN network routes.',
  VPN_DNS_FAILED: 'NEXA could not apply the VPN DNS settings.',
  VPN_KILLSWITCH_FAILED: 'NEXA could not apply the VPN kill switch.',
  VPN_HANDSHAKE_TIMEOUT: 'The VPN server did not respond. The tunnel could not be verified.',
  VPN_HEALTH_CHECK_FAILED: 'The VPN tunnel health check failed.',
  VPN_ROLLBACK_FAILED: 'NEXA could not fully roll back the VPN tunnel. Network state may need attention.',
  VPN_PERMISSION_DENIED: 'NEXA does not have permission to configure the VPN tunnel.',
  VPN_UNSUPPORTED_PLATFORM: 'VPN is not supported on this platform.'
}

export function helperErrorMessage(code: string): string {
  return HELPER_ERROR_MESSAGES[code] || 'The VPN operation could not be completed.'
}

export class HelperRequestError extends Error {
  constructor(public code: HelperErrorCode) {
    super(code)
  }
}

/* ------------------------------------------------------------------ *
 * Interface-name allowlist (NEXA-owned names only)
 * ------------------------------------------------------------------ */

export const INTERFACE_NAME_RE = /^nexa[a-z0-9]{1,11}$/

export function isValidInterfaceName(name: string): boolean {
  return typeof name === 'string' && INTERFACE_NAME_RE.test(name)
}

/* ------------------------------------------------------------------ *
 * Payload schemas (per operation)
 * ------------------------------------------------------------------ */

const wgKey = z.string().refine(isValidWgKey, 'invalid_key')
const cidr = z.string().refine(isValidCidr, 'invalid_cidr')
const ipAddr = z.string().refine((s) => isValidIpv4(s) || isValidIpv6(s), 'invalid_ip')
const ifaceName = z.string().refine(isValidInterfaceName, 'invalid_interface')

export const helperTunnelConfigSchema = z.object({
  privateKey: wgKey,
  presharedKey: wgKey.optional(),
  address: z.array(cidr).min(1).max(16),
  dns: z.array(ipAddr).max(8),
  mtu: z.number().int().min(1280).max(1500).optional(),
  peerPublicKey: wgKey,
  endpoint: z.string().refine(isValidEndpoint, 'invalid_endpoint'),
  allowedIPs: z.array(cidr).min(1).max(64),
  persistentKeepalive: z.number().int().min(0).max(65535).optional(),
  ipv6: z.enum(['block', 'allow'])
})
export type HelperTunnelConfig = z.infer<typeof helperTunnelConfigSchema>

const emptyPayload = z.object({}).strict()

export const HELPER_PAYLOAD_SCHEMAS: Record<HelperOp, z.ZodTypeAny> = {
  probeWireGuard: emptyPayload,
  bringTunnelUp: z.object({ interfaceName: ifaceName, config: helperTunnelConfigSchema }).strict(),
  bringTunnelDown: z.object({ interfaceName: ifaceName }).strict(),
  queryHandshakeState: z.object({ interfaceName: ifaceName }).strict(),
  enableKillSwitch: z.object({ interfaceName: ifaceName, allowedEndpoints: z.array(z.string().refine(isValidEndpoint, 'invalid_endpoint')).max(8).optional() }).strict(),
  disableKillSwitch: z.object({ interfaceName: ifaceName }).strict()
}

/* ------------------------------------------------------------------ *
 * Message envelopes
 * ------------------------------------------------------------------ */

export interface HelperRequest {
  protocol: number
  requestId: string
  op: HelperOp
  payload: unknown
}

export interface HelperResponse {
  protocol: number
  requestId: string
  ok: boolean
  result?: unknown
  error?: { code: HelperErrorCode; message: string }
}

const requestEnvelopeSchema = z.object({
  protocol: z.number().int(),
  requestId: z.string().min(1).max(64),
  op: z.string(),
  payload: z.unknown()
})

const MAX_MESSAGE_BYTES = 64 * 1024

/**
 * Fully validate a raw incoming request. Throws HelperRequestError with a stable
 * code. This runs on BOTH sides of the boundary.
 */
export function validateHelperRequest(raw: unknown, rawBytes?: number): { op: HelperOp; requestId: string; payload: unknown } {
  if (rawBytes !== undefined && rawBytes > MAX_MESSAGE_BYTES) throw new HelperRequestError('VPN_INVALID_REQUEST')
  const env = requestEnvelopeSchema.safeParse(raw)
  if (!env.success) throw new HelperRequestError('VPN_INVALID_REQUEST')
  if (env.data.protocol !== HELPER_PROTOCOL_VERSION) throw new HelperRequestError('VPN_HELPER_VERSION_MISMATCH')
  if (!isHelperOp(env.data.op)) throw new HelperRequestError('VPN_UNKNOWN_OPERATION')
  const schema = HELPER_PAYLOAD_SCHEMAS[env.data.op]
  const payload = schema.safeParse(env.data.payload)
  if (!payload.success) {
    // Config-shaped ops map to a config error; others to a generic request error.
    throw new HelperRequestError(env.data.op === 'bringTunnelUp' ? 'VPN_INVALID_CONFIG' : 'VPN_INVALID_REQUEST')
  }
  return { op: env.data.op, requestId: env.data.requestId, payload: payload.data }
}

/* ------------------------------------------------------------------ *
 * Redaction for logs — secrets must NEVER be logged
 * ------------------------------------------------------------------ */

export function redactHelperRequest(req: HelperRequest): HelperRequest {
  const payload = req.payload as { config?: Record<string, unknown> } | undefined
  if (payload && payload.config && typeof payload.config === 'object') {
    return {
      ...req,
      payload: { ...payload, config: { ...payload.config, privateKey: '[redacted]', presharedKey: payload.config.presharedKey ? '[redacted]' : undefined } }
    }
  }
  return req
}

/* ------------------------------------------------------------------ *
 * Helper install/availability info (renderer-safe)
 * ------------------------------------------------------------------ */

export type HelperState = 'installed' | 'not_installed' | 'needs_authorization' | 'error'

export interface HelperInfo {
  installed: boolean
  authorized: boolean
  version: number | null
  state: HelperState
}

export function notInstalledHelper(): HelperInfo {
  return { installed: false, authorized: false, version: null, state: 'not_installed' }
}

export interface ProbeResult {
  available: boolean
  implementation: 'wireguard-tools' | 'wireguard-go' | 'wireguard-nt' | 'unknown'
  version?: string
}

export interface HandshakeResult {
  interfaceUp: boolean
  handshakeAgeSec: number | null
  rxBytes: number | null
  txBytes: number | null
  endpoint: string | null
}

export type Ipv6PolicyValue = Ipv6Policy
