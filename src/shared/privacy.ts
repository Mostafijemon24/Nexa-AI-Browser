/**
 * NEXA P7 STEP 7 — Privacy Center core (pure, dependency-light, unit-testable).
 *
 * This module holds the DETERMINISTIC classification, normalization and
 * aggregation logic behind the Privacy Center. It performs NO I/O and uses no
 * model/LLM. Live probes (main-process network info + renderer WebRTC/fingerprint/
 * permissions) feed their raw results into these pure functions, which turn them
 * into honest, verifiable status labels.
 *
 * HONESTY INVARIANTS (enforced + tested):
 *  - Never emit a positive "verified" label unless the underlying state was
 *    actually verified. Unverifiable conditions resolve to UNKNOWN / UNAVAILABLE /
 *    NOT_CONFIGURED — never a false positive.
 *  - A local/private interface IP is NEVER reported as the public IP.
 *  - No fabricated numeric "privacy score"; fingerprint surface uses documented,
 *    deterministic signal-count thresholds.
 */
import { isValidIpv4, isValidIpv6 } from './vpn'

/* --------------------------------- Status --------------------------------- */

export type DiagStatus =
  | 'PROTECTED'
  | 'ACTIVE'
  | 'DETECTED'
  | 'BLOCKED'
  | 'NOT_CONFIGURED'
  | 'CHECKING'
  | 'UNKNOWN'
  | 'UNAVAILABLE'

export type HttpsState = 'ACTIVE' | 'NONE' | 'UNKNOWN'

export type IpFamily = 'ipv4' | 'ipv6' | 'unknown'
export type IpKind = 'public' | 'private' | 'loopback' | 'link-local' | 'unique-local' | 'special' | 'unknown'

export type WebrtcStatus = 'NO_EXPOSURE_DETECTED' | 'POTENTIAL_EXPOSURE' | 'UNAVAILABLE' | 'CHECKING' | 'UNKNOWN'

export type DnsStatus =
  | 'NO_LEAK_DETECTED'
  | 'POTENTIAL_LEAK'
  | 'CHECKING'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'

export type FingerprintSurface =
  | 'LOW SIGNAL SURFACE'
  | 'MODERATE SIGNAL SURFACE'
  | 'HIGH SIGNAL SURFACE'
  | 'UNKNOWN'

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unavailable' | 'unknown'

/* ------------------------------ IP classification ------------------------------ */

export interface IpClass {
  family: IpFamily
  kind: IpKind
  /** True only for a globally-routable (public) address. */
  isPublic: boolean
}

function ipv4Kind(ip: string): IpKind {
  const p = ip.split('.').map(Number)
  const [a, b] = p
  if (a === 127) return 'loopback'
  if (a === 10) return 'private'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  if (a === 100 && b >= 64 && b <= 127) return 'private' // CGNAT (RFC 6598) — not public
  if (a === 0 || a === 255) return 'special'
  if (a >= 224) return 'special' // multicast / reserved
  return 'public'
}

function ipv6Kind(ip: string): IpKind {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1') return 'loopback'
  if (lower === '::' ) return 'special'
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return 'link-local'
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'unique-local'
  if (lower.startsWith('ff')) return 'special' // multicast
  return 'public'
}

/** Classify a single IP literal. Never guesses a public IP from a private range. */
export function classifyIp(ip: string): IpClass {
  const raw = String(ip ?? '').trim().replace(/^\[|\]$/g, '')
  if (isValidIpv4(raw)) {
    const kind = ipv4Kind(raw)
    return { family: 'ipv4', kind, isPublic: kind === 'public' }
  }
  // Strip a trailing zone id (e.g. fe80::1%en0) before validating.
  const noZone = raw.split('%')[0]
  if (isValidIpv6(noZone)) {
    const kind = ipv6Kind(noZone)
    return { family: 'ipv6', kind, isPublic: kind === 'public' }
  }
  return { family: 'unknown', kind: 'unknown', isPublic: false }
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip).isPublic
}

/* --------------------------------- HTTPS --------------------------------- */

/** Classify transport security from the ACTUAL live page URL. */
export function classifyHttps(url: string): HttpsState {
  const s = String(url ?? '').trim()
  if (!s) return 'UNKNOWN'
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return 'UNKNOWN'
  }
  if (u.protocol === 'https:' || u.protocol === 'wss:') return 'ACTIVE'
  if (u.protocol === 'http:' || u.protocol === 'ws:') return 'NONE'
  return 'UNKNOWN'
}

/* ------------------------------ Interface IPs ------------------------------ */

export interface RawInterfaceAddr {
  address: string
  family?: string | number
  internal?: boolean
}

export interface InterfaceAddrInfo {
  family: IpFamily
  kind: IpKind
  internal: boolean
}

export interface InterfaceSummary {
  addresses: InterfaceAddrInfo[]
  ipv4Count: number
  ipv6Count: number
  /** True when at least one non-internal IPv6 address exists on the host. */
  ipv6Available: boolean
  /** Local (non-internal, non-public) addresses — safe to surface as "local interface". */
  localCount: number
  /**
   * A globally-routable IPv6 present on an interface. NOTE: this is an interface
   * address, NOT necessarily the public IP seen by websites — labelled as such.
   */
  routableIpv6Count: number
}

/** Summarize host interface addresses. Never labels a private address as public. */
export function summarizeInterfaces(addrs: RawInterfaceAddr[]): InterfaceSummary {
  const out: InterfaceAddrInfo[] = []
  for (const a of Array.isArray(addrs) ? addrs : []) {
    if (!a || !a.address) continue
    const c = classifyIp(a.address)
    out.push({ family: c.family, kind: c.kind, internal: !!a.internal })
  }
  const ipv4Count = out.filter((a) => a.family === 'ipv4').length
  const ipv6Count = out.filter((a) => a.family === 'ipv6').length
  const ipv6Available = out.some((a) => a.family === 'ipv6' && !a.internal && a.kind !== 'link-local')
  const localCount = out.filter((a) => !a.internal && !(a.kind === 'public')).length
  const routableIpv6Count = out.filter((a) => a.family === 'ipv6' && a.kind === 'public' && !a.internal).length
  return { addresses: out, ipv4Count, ipv6Count, ipv6Available, localCount, routableIpv6Count }
}

/* --------------------------------- WebRTC --------------------------------- */

export interface RawIceCandidate {
  address?: string | null
  type?: string | null
  protocol?: string | null
}

export interface WebrtcResult {
  status: WebrtcStatus
  localIpExposed: boolean
  publicIpExposed: boolean
  ipv4Exposed: boolean
  ipv6Exposed: boolean
  /** mDNS-obfuscated (.local) candidates — not an exposure. */
  obfuscatedCount: number
  candidateCount: number
}

/**
 * Normalize gathered ICE candidates into an honest exposure verdict.
 * `.local` (mDNS) candidates are obfuscated → not an exposure. A real IP (private
 * OR public) surfaced by WebRTC is a POTENTIAL_EXPOSURE. `available:false` (no
 * RTCPeerConnection) → UNAVAILABLE.
 */
export function normalizeWebrtc(
  candidates: RawIceCandidate[],
  opts: { available?: boolean } = {}
): WebrtcResult {
  if (opts.available === false) {
    return {
      status: 'UNAVAILABLE',
      localIpExposed: false,
      publicIpExposed: false,
      ipv4Exposed: false,
      ipv6Exposed: false,
      obfuscatedCount: 0,
      candidateCount: 0
    }
  }
  const list = Array.isArray(candidates) ? candidates : []
  let localIpExposed = false
  let publicIpExposed = false
  let ipv4Exposed = false
  let ipv6Exposed = false
  let obfuscatedCount = 0
  let withAddress = 0
  for (const c of list) {
    const addr = String(c?.address ?? '').trim().toLowerCase()
    if (!addr) continue
    withAddress++
    if (addr.endsWith('.local')) {
      obfuscatedCount++
      continue
    }
    const cls = classifyIp(addr)
    if (cls.family === 'ipv4') ipv4Exposed = true
    else if (cls.family === 'ipv6') ipv6Exposed = true
    else continue
    if (cls.isPublic) publicIpExposed = true
    else if (cls.kind !== 'unknown') localIpExposed = true
  }
  let status: WebrtcStatus
  if (publicIpExposed || localIpExposed) status = 'POTENTIAL_EXPOSURE'
  else if (withAddress > 0 || obfuscatedCount > 0) status = 'NO_EXPOSURE_DETECTED'
  else status = 'UNKNOWN'
  return { status, localIpExposed, publicIpExposed, ipv4Exposed, ipv6Exposed, obfuscatedCount, candidateCount: withAddress }
}

/* ----------------------------------- DNS ----------------------------------- */

export interface DnsResolverInfo {
  ip: string
  family: IpFamily
  kind: IpKind
}

export interface DnsResult {
  status: DnsStatus
  resolvers: DnsResolverInfo[]
}

/**
 * Normalize resolver addresses (from the OS, via `dns.getServers()` in main).
 * Leak verdict is intentionally conservative: we only claim NO_LEAK_DETECTED when
 * the VPN is connected AND every resolver is non-public (tunnel-side). If the VPN
 * is connected but a public resolver is used, that's a POTENTIAL_LEAK. Without a
 * VPN we cannot verify a leak → UNKNOWN. No servers → NOT_CONFIGURED.
 */
export function normalizeDns(
  servers: string[],
  opts: { vpnConnected?: boolean; available?: boolean } = {}
): DnsResult {
  if (opts.available === false) return { status: 'UNAVAILABLE', resolvers: [] }
  const list = (Array.isArray(servers) ? servers : []).map((s) => String(s || '').trim()).filter(Boolean)
  if (list.length === 0) return { status: 'NOT_CONFIGURED', resolvers: [] }
  const resolvers: DnsResolverInfo[] = list.map((ip) => {
    const c = classifyIp(ip)
    return { ip, family: c.family, kind: c.kind }
  })
  if (opts.vpnConnected) {
    const anyPublic = resolvers.some((r) => r.kind === 'public')
    return { status: anyPublic ? 'POTENTIAL_LEAK' : 'NO_LEAK_DETECTED', resolvers }
  }
  return { status: 'UNKNOWN', resolvers }
}

/* ------------------------------- Fingerprint ------------------------------- */

/** High-entropy signal keys the audit inspects (order-stable, documented). */
export const FINGERPRINT_SIGNAL_KEYS = [
  'userAgent',
  'platform',
  'language',
  'timezone',
  'screen',
  'devicePixelRatio',
  'hardwareConcurrency',
  'deviceMemory',
  'webglRenderer',
  'colorDepth',
  'touch',
  'canvas',
  'audio'
] as const
export type FingerprintSignalKey = (typeof FINGERPRINT_SIGNAL_KEYS)[number]

export interface FingerprintResult {
  /** Per-signal availability (true = signal readable = adds to surface). */
  signals: Record<string, boolean>
  availableCount: number
  totalCount: number
  surface: FingerprintSurface
}

/**
 * Deterministic surface classification from the count of AVAILABLE high-entropy
 * signals. Thresholds (documented, defensible):
 *   0        → UNKNOWN
 *   1–4      → LOW SIGNAL SURFACE
 *   5–8      → MODERATE SIGNAL SURFACE
 *   9+       → HIGH SIGNAL SURFACE
 */
export function classifyFingerprintSurface(availableCount: number): FingerprintSurface {
  const n = Math.max(0, Math.floor(availableCount || 0))
  if (n === 0) return 'UNKNOWN'
  if (n <= 4) return 'LOW SIGNAL SURFACE'
  if (n <= 8) return 'MODERATE SIGNAL SURFACE'
  return 'HIGH SIGNAL SURFACE'
}

/** Build the fingerprint audit from a raw availability map. Pure + deterministic. */
export function buildFingerprint(raw: Partial<Record<FingerprintSignalKey, boolean>>): FingerprintResult {
  const signals: Record<string, boolean> = {}
  let availableCount = 0
  for (const k of FINGERPRINT_SIGNAL_KEYS) {
    const v = !!raw?.[k]
    signals[k] = v
    if (v) availableCount++
  }
  return {
    signals,
    availableCount,
    totalCount: FINGERPRINT_SIGNAL_KEYS.length,
    surface: classifyFingerprintSurface(availableCount)
  }
}

/* ------------------------------- Aggregation ------------------------------- */

export interface ProtectionSummary {
  status: DiagStatus
  blocked: number
  requests: number
}

export interface VpnSummary {
  status: DiagStatus
  handshakeVerified: boolean
  killSwitch: 'ON' | 'OFF' | 'NOT_CONFIGURED'
}

export interface PrivacyAggregateInput {
  https: HttpsState
  protection: ProtectionSummary
  vpn: VpnSummary
  dns: DnsStatus
  webrtc: WebrtcStatus
}

export interface PrivacyAggregate {
  /** Honest count of concerns that were actually detected (never a fake score). */
  concerns: number
  /** Verified positives (e.g. HTTPS active, protection active, VPN verified). */
  verified: number
  /** Human-facing headline label — only ever positive when something was verified. */
  headline: 'STRONG' | 'MIXED' | 'ATTENTION' | 'UNKNOWN'
}

/**
 * Aggregate posture WITHOUT inventing a score. Counts verified protections and
 * detected concerns; the headline is derived deterministically and conservatively.
 */
export function aggregatePrivacy(input: PrivacyAggregateInput): PrivacyAggregate {
  let verified = 0
  let concerns = 0

  if (input.https === 'ACTIVE') verified++
  else if (input.https === 'NONE') concerns++

  if (input.protection.status === 'ACTIVE' || input.protection.status === 'PROTECTED') verified++
  else if (input.protection.status === 'NOT_CONFIGURED') concerns++

  if (input.vpn.status === 'PROTECTED') verified++

  if (input.webrtc === 'POTENTIAL_EXPOSURE') concerns++
  if (input.dns === 'POTENTIAL_LEAK') concerns++

  let headline: PrivacyAggregate['headline']
  if (verified === 0 && concerns === 0) headline = 'UNKNOWN'
  else if (concerns === 0 && verified > 0) headline = 'STRONG'
  else if (concerns > 0 && verified > 0) headline = 'MIXED'
  else headline = 'ATTENTION'

  return { concerns, verified, headline }
}

/* --------------------------- Origin authority --------------------------- */

/** Parse a live URL into scheme/host/port, or null if not a valid http(s) URL. */
export function parseLiveOrigin(url: string): { scheme: string; host: string; port: string; origin: string } | null {
  const s = String(url ?? '').trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return { scheme: u.protocol.replace(':', ''), host: u.hostname.toLowerCase(), port: u.port, origin: u.origin }
}

/** True when a live URL is eligible for site-specific privacy diagnostics. */
export function isDiagnosableOrigin(url: string): boolean {
  return parseLiveOrigin(url) !== null
}
