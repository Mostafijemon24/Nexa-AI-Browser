import { z } from 'zod'

export const VPN_VERSION = 1

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

export type VpnState = 'not_configured' | 'off' | 'connecting' | 'protected' | 'disconnecting' | 'error'

export type VpnEvent = 'connect' | 'established' | 'disconnect' | 'settled_off' | 'fail' | 'reset' | 'configure'

/**
 * Explicit, guarded transitions. Crucially there is NO direct off -> protected
 * edge: PROTECTED is only reachable from CONNECTING via `established` (which the
 * service only emits after real health verification).
 */
export function nextVpnState(current: VpnState, event: VpnEvent): VpnState | null {
  switch (event) {
    case 'configure':
      // A config was added; leave not_configured -> off. Otherwise no-op.
      return current === 'not_configured' ? 'off' : null
    case 'reset':
      // Configuration removed / capability lost.
      return 'not_configured'
    case 'connect':
      // Only allowed from a settled, configured, non-busy state.
      return current === 'off' || current === 'error' ? 'connecting' : null
    case 'established':
      // The ONLY path to PROTECTED.
      return current === 'connecting' ? 'protected' : null
    case 'fail':
      return current === 'connecting' || current === 'protected' || current === 'disconnecting' ? 'error' : null
    case 'disconnect':
      return current === 'protected' || current === 'connecting' || current === 'error' ? 'disconnecting' : null
    case 'settled_off':
      return current === 'disconnecting' ? 'off' : null
    default:
      return null
  }
}

export function isBusyState(s: VpnState): boolean {
  return s === 'connecting' || s === 'disconnecting'
}

/* ------------------------------------------------------------------ *
 * WireGuard configuration model
 * ------------------------------------------------------------------ */

/** Parsed config with secrets — main-process only, never sent to the renderer. */
export interface ParsedWgConfig {
  privateKey: string
  presharedKey?: string
  address: string[]
  dns: string[]
  mtu?: number
  peerPublicKey: string
  endpoint: string
  allowedIPs: string[]
  persistentKeepalive?: number
}

/** Non-secret, persisted server record (safe for renderer). */
export interface VpnServer {
  id: string
  providerId: string
  name: string
  countryCode?: string
  city?: string
  endpoint: string
  publicKey: string
  address: string[]
  dns: string[]
  allowedIPs: string[]
  mtu?: number
  persistentKeepalive?: number
  hasPresharedKey: boolean
  createdAt: number
}

export type AutoConnectMode = 'never' | 'launch' | 'profile'
export type Ipv6Policy = 'block' | 'allow'

export interface VpnSettings {
  version: number
  selectedServerId: string | null
  autoConnect: AutoConnectMode
  killSwitch: boolean
  dnsProtection: boolean
  ipv6: Ipv6Policy
  disconnectOnExit: boolean
}

export function defaultVpnSettings(): VpnSettings {
  return {
    version: VPN_VERSION,
    selectedServerId: null,
    autoConnect: 'never',
    killSwitch: false,
    dnsProtection: true,
    ipv6: 'block',
    disconnectOnExit: true
  }
}

export interface VpnStore {
  version: number
  servers: VpnServer[]
  settings: VpnSettings
}

export function emptyVpnStore(): VpnStore {
  return { version: VPN_VERSION, servers: [], settings: defaultVpnSettings() }
}

/* ------------------------------------------------------------------ *
 * Health + status projection (renderer-safe)
 * ------------------------------------------------------------------ */

export type Verification = 'verified' | 'unverified' | 'unknown'
export type VpnCapability = 'available' | 'unavailable' | 'unknown'

export interface VpnHealth {
  handshakeAgeSec: number | null
  rxBytes: number | null
  txBytes: number | null
  latencyMs: number | null
  endpoint: string | null
  interfaceUp: boolean
  publicIpVerified: Verification
  dnsVerified: Verification
}

/** Privileged-helper availability (renderer-safe; mirrors HelperInfo). */
export type VpnHelperState = 'installed' | 'not_installed' | 'needs_authorization' | 'error'
export interface VpnHelperStatus {
  installed: boolean
  authorized: boolean
  version: number | null
  state: VpnHelperState
}

export interface VpnStatus {
  profileId: string
  state: VpnState
  capability: VpnCapability
  platform: 'macos' | 'windows' | 'linux'
  selectedServerId: string | null
  serverName: string | null
  connectedSince: number | null
  health: VpnHealth | null
  killSwitch: { enabled: boolean; enforced: boolean }
  dnsProtection: { enabled: boolean; verified: boolean }
  ipv6: Ipv6Policy
  autoConnect: AutoConnectMode
  lastError: string | null
  reconnectCount: number
  /** P4.1: privileged-helper availability. */
  helper: VpnHelperStatus
}

/* ------------------------------------------------------------------ *
 * Validation helpers
 * ------------------------------------------------------------------ */

// A WireGuard key is 32 bytes, base64 -> 43 chars + '='.
const WG_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/

export function isValidWgKey(k: string): boolean {
  return WG_KEY_RE.test(k.trim())
}

export function isValidIpv4(ip: string): boolean {
  const m = ip.split('.')
  if (m.length !== 4) return false
  return m.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
}

export function isValidIpv6(ip: string): boolean {
  // Pragmatic IPv6 check (not exhaustive): hex groups + optional '::'.
  if (!ip.includes(':')) return false
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false
  return (ip.match(/::/g) || []).length <= 1 && ip.split(':').length <= 8
}

export function isValidCidr(cidr: string): boolean {
  const [addr, prefix, ...rest] = cidr.split('/')
  if (rest.length) return false
  const isV4 = isValidIpv4(addr)
  const isV6 = !isV4 && isValidIpv6(addr)
  if (!isV4 && !isV6) return false
  if (prefix === undefined) return isV4 || isV6 // bare address allowed for Address
  if (!/^\d{1,3}$/.test(prefix)) return false
  const p = Number(prefix)
  return isV4 ? p >= 0 && p <= 32 : p >= 0 && p <= 128
}

export function isValidEndpoint(ep: string): boolean {
  const idx = ep.lastIndexOf(':')
  if (idx <= 0) return false
  const host = ep.slice(0, idx).replace(/^\[|\]$/g, '')
  const port = ep.slice(idx + 1)
  if (!/^\d{1,5}$/.test(port)) return false
  const pn = Number(port)
  if (pn < 1 || pn > 65535) return false
  if (!host) return false
  // host may be domain, ipv4, or ipv6 (bracketed above)
  if (isValidIpv4(host) || isValidIpv6(host)) return true
  return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(host) || /^[a-zA-Z0-9-]+$/.test(host)
}

/* ------------------------------------------------------------------ *
 * WireGuard config parser (INI-like). Pure — no shell, no fs.
 * ------------------------------------------------------------------ */

export class WgParseError extends Error {}

export function parseWireGuardConfig(text: string): ParsedWgConfig {
  if (typeof text !== 'string' || text.length > 100_000) throw new WgParseError('invalid_config')
  const sections: Record<string, Record<string, string[]>> = {}
  let current: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const sec = line.match(/^\[(\w+)\]$/)
    if (sec) {
      current = sec[1].toLowerCase()
      sections[current] = sections[current] || {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0 || !current) throw new WgParseError('malformed_line')
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    ;(sections[current][key] = sections[current][key] || []).push(value)
  }

  const iface = sections['interface']
  const peer = sections['peer']
  if (!iface) throw new WgParseError('missing_interface')
  if (!peer) throw new WgParseError('missing_peer')

  const first = (o: Record<string, string[]>, k: string) => (o[k] ? o[k][0] : undefined)
  const csv = (v?: string) =>
    (v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  // Interface
  const privateKey = first(iface, 'privatekey')
  if (!privateKey || !isValidWgKey(privateKey)) throw new WgParseError('invalid_private_key')
  const address = csv(first(iface, 'address'))
  if (address.length === 0 || !address.every(isValidCidr)) throw new WgParseError('invalid_address')
  const dns = csv(first(iface, 'dns'))
  if (dns.length && !dns.every((d) => isValidIpv4(d) || isValidIpv6(d))) throw new WgParseError('invalid_dns')
  let mtu: number | undefined
  const mtuRaw = first(iface, 'mtu')
  if (mtuRaw !== undefined) {
    mtu = Number(mtuRaw)
    if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1500) throw new WgParseError('invalid_mtu')
  }

  // Peer
  const peerPublicKey = first(peer, 'publickey')
  if (!peerPublicKey || !isValidWgKey(peerPublicKey)) throw new WgParseError('invalid_public_key')
  const presharedKey = first(peer, 'presharedkey')
  if (presharedKey !== undefined && !isValidWgKey(presharedKey)) throw new WgParseError('invalid_preshared_key')
  const endpoint = first(peer, 'endpoint')
  if (!endpoint || !isValidEndpoint(endpoint)) throw new WgParseError('invalid_endpoint')
  const allowedIPs = csv(first(peer, 'allowedips'))
  if (allowedIPs.length === 0 || !allowedIPs.every(isValidCidr)) throw new WgParseError('invalid_allowed_ips')
  let persistentKeepalive: number | undefined
  const kaRaw = first(peer, 'persistentkeepalive')
  if (kaRaw !== undefined) {
    persistentKeepalive = Number(kaRaw)
    if (!Number.isInteger(persistentKeepalive) || persistentKeepalive < 0 || persistentKeepalive > 65535)
      throw new WgParseError('invalid_keepalive')
  }

  return { privateKey, presharedKey, address, dns, mtu, peerPublicKey, endpoint, allowedIPs, persistentKeepalive }
}

/** Build a server record (non-secret) from a parsed config. */
export function serverFromConfig(id: string, name: string, cfg: ParsedWgConfig): VpnServer {
  return {
    id,
    providerId: 'custom',
    name: name.trim().slice(0, 80) || 'Custom server',
    endpoint: cfg.endpoint,
    publicKey: cfg.peerPublicKey,
    address: cfg.address,
    dns: cfg.dns,
    allowedIPs: cfg.allowedIPs,
    mtu: cfg.mtu,
    persistentKeepalive: cfg.persistentKeepalive,
    hasPresharedKey: !!cfg.presharedKey,
    createdAt: Date.now()
  }
}

/* ------------------------------------------------------------------ *
 * Redaction — never let secrets reach logs.
 * ------------------------------------------------------------------ */

export function redactWgConfig(text: string): string {
  return text
    .replace(/(PrivateKey\s*=\s*).*/gi, '$1[redacted]')
    .replace(/(PresharedKey\s*=\s*).*/gi, '$1[redacted]')
}

export function redactSecret(s: string | undefined | null): string {
  if (!s) return ''
  return '[redacted]'
}

/* ------------------------------------------------------------------ *
 * Server selection + reconnect backoff
 * ------------------------------------------------------------------ */

export function selectServer(servers: VpnServer[], selectedId: string | null): VpnServer | null {
  if (servers.length === 0) return null
  if (selectedId) {
    const found = servers.find((s) => s.id === selectedId)
    if (found) return found
  }
  return servers[0]
}

/** Exponential backoff with cap and jitter-free determinism (testable). */
export function reconnectBackoffMs(attempt: number, base = 1000, cap = 30_000): number {
  if (attempt <= 0) return base
  const ms = base * 2 ** attempt
  return Math.min(ms, cap)
}

/* ------------------------------------------------------------------ *
 * Error mapping — sanitized, user-facing.
 * ------------------------------------------------------------------ */

const ERROR_MESSAGES: Record<string, string> = {
  wg_unavailable: 'NEXA could not start the VPN tunnel because the WireGuard component is unavailable.',
  no_server: 'No VPN server is selected. Import a WireGuard configuration first.',
  no_config: 'No WireGuard configuration has been added.',
  permission_denied: 'NEXA does not have permission to configure the VPN tunnel on this system.',
  handshake_timeout: 'The VPN server did not respond. The tunnel could not be verified.',
  interface_failed: 'NEXA could not create the VPN network interface.',
  route_failed: 'NEXA could not install the VPN network routes.',
  dns_failed: 'NEXA could not apply the VPN DNS settings.',
  endpoint_unreachable: 'The VPN server endpoint could not be reached.',
  busy: 'A VPN operation is already in progress.',
  invalid_config: 'The WireGuard configuration is invalid.',
  teardown_failed: 'NEXA could not fully tear down the VPN tunnel. Network state may need attention.'
}

export function friendlyVpnError(code: string): string {
  return ERROR_MESSAGES[code] || 'The VPN operation could not be completed.'
}

/* ------------------------------------------------------------------ *
 * Zod schemas (IPC)
 * ------------------------------------------------------------------ */

export const vpnImportSchema = z.object({
  profileId: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  config: z.string().min(1).max(100_000)
})

export const vpnServerIdSchema = z.object({
  profileId: z.string().min(1).max(64),
  serverId: z.string().min(1).max(64)
})

export const vpnProfileSchema = z.object({ profileId: z.string().min(1).max(64) })

export const vpnSettingsSchema = z.object({
  profileId: z.string().min(1).max(64),
  autoConnect: z.enum(['never', 'launch', 'profile']),
  killSwitch: z.boolean(),
  dnsProtection: z.boolean(),
  ipv6: z.enum(['block', 'allow']),
  disconnectOnExit: z.boolean()
})

export const vpnStoreSchema = z.object({
  version: z.number(),
  servers: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      name: z.string(),
      countryCode: z.string().optional(),
      city: z.string().optional(),
      endpoint: z.string(),
      publicKey: z.string(),
      address: z.array(z.string()),
      dns: z.array(z.string()),
      allowedIPs: z.array(z.string()),
      mtu: z.number().optional(),
      persistentKeepalive: z.number().optional(),
      hasPresharedKey: z.boolean(),
      createdAt: z.number()
    })
  ),
  settings: z.object({
    version: z.number(),
    selectedServerId: z.string().nullable(),
    autoConnect: z.enum(['never', 'launch', 'profile']),
    killSwitch: z.boolean(),
    dnsProtection: z.boolean(),
    ipv6: z.enum(['block', 'allow']),
    disconnectOnExit: z.boolean()
  })
})

export function normalizeVpnStore(raw: unknown): VpnStore {
  const parsed = vpnStoreSchema.safeParse(raw)
  if (!parsed.success) return emptyVpnStore()
  return parsed.data as VpnStore
}
