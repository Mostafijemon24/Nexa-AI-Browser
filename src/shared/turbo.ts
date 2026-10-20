/**
 * NEXA P9 STEP 9 — Turbo Mode core (pure, dependency-light, unit-testable).
 *
 * Turbo is a thin, HONEST browser-optimization layer on top of Chromium/Electron.
 * This module holds only the DETERMINISTIC decision logic: the state model,
 * navigation-timing classification, URL/prefetch/preconnect safety policy,
 * sensitive-navigation detection, a bounded duplicate-navigation guard, and a
 * safe summary of real Performance API values.
 *
 * HONESTY / SAFETY INVARIANTS (enforced + tested):
 *  - No fabricated timings, percentages, speeds or "Turbo N× faster" claims.
 *    Missing data → `Unavailable` / "Not available", never a made-up number.
 *  - Never mark a preconnect/prefetch target safe when it is a sensitive
 *    (auth/payment) path or a non-http(s) / dangerous scheme.
 *  - No I/O, no AI, no side effects. This module cannot bypass VPN/protection.
 */

/* --------------------------------- State --------------------------------- */

export type TurboState = 'OFF' | 'ON' | 'OPTIMIZING' | 'NOT_SUPPORTED'

export interface TurboStateInput {
  supported: boolean
  enabled: boolean
  optimizing?: boolean
}

/** Derive the user-facing Turbo state honestly from real inputs. */
export function deriveTurboState(i: TurboStateInput): TurboState {
  if (!i.supported) return 'NOT_SUPPORTED'
  if (!i.enabled) return 'OFF'
  return i.optimizing ? 'OPTIMIZING' : 'ON'
}

export function turboStateLabel(s: TurboState): string {
  switch (s) {
    case 'ON':
      return 'Turbo On'
    case 'OFF':
      return 'Turbo Off'
    case 'OPTIMIZING':
      return 'Optimizing'
    case 'NOT_SUPPORTED':
      return 'Not supported'
  }
}

/* ------------------------------ URL safety ------------------------------ */

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'file:', 'chrome:', 'about:', 'vbscript:', 'blob:', 'ftp:']

/** True only for a normal navigable http(s) URL. */
export function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  const lower = url.trim().toLowerCase()
  if (DANGEROUS_SCHEMES.some((s) => lower.startsWith(s))) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

export function sameOrigin(a: string, b: string): boolean {
  const oa = originOf(a)
  const ob = originOf(b)
  return oa !== null && oa === ob
}

/* --------------------------- Sensitive navigation --------------------------- */

// Auth/payment/account surfaces — never speculatively preconnected/prefetched.
const SENSITIVE_SEGMENTS = [
  'login',
  'signin',
  'sign-in',
  'logon',
  'account',
  'accounts',
  'checkout',
  'payment',
  'payments',
  'billing',
  'oauth',
  'oauth2',
  'authorize',
  'authorization',
  'token',
  'reset',
  'password',
  'passwd',
  'signup',
  'sign-up',
  'register',
  '2fa',
  'mfa',
  'otp',
  'verify',
  'wallet',
  'bank'
]

/**
 * Heuristic sensitive-navigation detector. Matches on path segments,
 * query keys and host prefixes (e.g. `login.example.com`). Conservative by
 * design: when in doubt, treat as sensitive (safer to skip optimization).
 */
export function isSensitiveNavigation(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return true // unparseable → treat as sensitive (never optimize)
  }
  const host = u.hostname.toLowerCase()
  const firstLabel = host.split('.')[0]
  if (SENSITIVE_SEGMENTS.includes(firstLabel)) return true
  const segs = u.pathname.toLowerCase().split(/[/._-]+/).filter(Boolean)
  if (segs.some((s) => SENSITIVE_SEGMENTS.includes(s))) return true
  for (const key of u.searchParams.keys()) {
    if (SENSITIVE_SEGMENTS.includes(key.toLowerCase())) return true
  }
  return false
}

/* ------------------------------ Preconnect policy ------------------------------ */

export interface PreconnectContext {
  /** Turbo master + safe-prediction sub-toggle both enabled. */
  enabled: boolean
  /** Never preconnect from/for a private tab (privacy boundary). */
  privateMode: boolean
}

/**
 * Decide whether it is safe to warm a connection (DNS/TCP/TLS) to a target the
 * user is likely about to visit. Returns the ORIGIN to preconnect, or null.
 */
export function preconnectTarget(url: string, ctx: PreconnectContext): string | null {
  if (!ctx.enabled || ctx.privateMode) return null
  if (!isHttpUrl(url)) return null
  if (isSensitiveNavigation(url)) return null
  return originOf(url)
}

/* ------------------------------ Prefetch policy ------------------------------ */

export interface PrefetchContext {
  enabled: boolean
  privateMode: boolean
  /** The origin of the page the candidate link came from (for same-origin checks). */
  currentUrl?: string
  /** Whether the candidate came from trusted UI (true) vs untrusted page content (false). */
  trusted?: boolean
}

/**
 * Extremely conservative prefetch gate. Rejects: disabled, private mode, unsafe
 * schemes, sensitive paths, untrusted-page-content links, and cross-origin links
 * unless explicitly same-origin. STEP 9 does not perform document prefetch by
 * default — this policy exists so any future prefetch is forced through it.
 */
export function isPrefetchable(url: string, ctx: PrefetchContext): boolean {
  if (!ctx.enabled || ctx.privateMode) return false
  if (!isHttpUrl(url)) return false
  if (isSensitiveNavigation(url)) return false
  if (ctx.trusted === false) return false
  if (ctx.currentUrl && !sameOrigin(url, ctx.currentUrl)) return false
  return true
}

/* --------------------------- Duplicate navigation guard --------------------------- */

export interface NavGuardEntry {
  url: string
  at: number
}

/** Default window in which an identical navigation is treated as a duplicate. */
export const NAV_DEDUPE_MS = 400

/**
 * True when `next` should be suppressed as a duplicate of `prev` (same normalized
 * URL within `windowMs`). Bounded + deterministic; never suppresses a different
 * URL or a repeat outside the window.
 */
export function isDuplicateNavigation(
  prev: NavGuardEntry | null,
  next: { url: string; at: number },
  windowMs: number = NAV_DEDUPE_MS
): boolean {
  if (!prev) return false
  if (prev.url !== next.url) return false
  return next.at - prev.at >= 0 && next.at - prev.at < windowMs
}

/* --------------------------- Navigation performance --------------------------- */

export interface NavigationPerformance {
  navigationId: string
  startedAt: number
  responseStart?: number
  domContentLoaded?: number
  loadEventEnd?: number
  transferSize?: number
  encodedBodySize?: number
  decodedBodySize?: number
  connectionType?: string
  fromCache?: boolean
}

export type NavClass = 'Fast' | 'Normal' | 'Slow' | 'Unavailable'

/**
 * Classification thresholds (documented, deterministic; milliseconds). Uses the
 * most complete available signal: loadEventEnd → domContentLoaded → responseStart.
 *   ≤ 1500ms → Fast   |   ≤ 4000ms → Normal   |   > 4000ms → Slow   |   none → Unavailable
 * These reflect LOCAL navigation responsiveness only — they never imply NEXA
 * caused or fixed remote server/network latency.
 */
export const NAV_FAST_MS = 1500
export const NAV_NORMAL_MS = 4000

export function classifyNavigation(p: NavigationPerformance | null | undefined): NavClass {
  if (!p) return 'Unavailable'
  const t = pickPrimary(p)
  if (t == null || !isFinite(t) || t <= 0) return 'Unavailable'
  if (t <= NAV_FAST_MS) return 'Fast'
  if (t <= NAV_NORMAL_MS) return 'Normal'
  return 'Slow'
}

function pickPrimary(p: NavigationPerformance): number | undefined {
  if (typeof p.loadEventEnd === 'number' && p.loadEventEnd > 0) return p.loadEventEnd
  if (typeof p.domContentLoaded === 'number' && p.domContentLoaded > 0) return p.domContentLoaded
  if (typeof p.responseStart === 'number' && p.responseStart > 0) return p.responseStart
  return undefined
}

/** Human "420 ms" / "1.8 s" formatting; null/invalid → "Not available". */
export function msLabel(n: number | undefined | null): string {
  if (n == null || !isFinite(n) || n < 0) return 'Not available'
  if (n < 1000) return `${Math.round(n)} ms`
  return `${(n / 1000).toFixed(1)} s`
}

export interface PerfSummary {
  ttfb: string
  domContentLoaded: string
  load: string
  fromCache: boolean | null
  classification: NavClass
}

/** Build a display-only summary of a navigation. Never fabricates missing values. */
export function summarizePerf(p: NavigationPerformance | null | undefined): PerfSummary {
  return {
    ttfb: msLabel(p?.responseStart),
    domContentLoaded: msLabel(p?.domContentLoaded),
    load: msLabel(p?.loadEventEnd),
    fromCache: p ? p.fromCache ?? null : null,
    classification: classifyNavigation(p)
  }
}
