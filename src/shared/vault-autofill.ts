/**
 * NEXA P6 STEP 6 — Secure Vault Autofill (pure, dependency-light, unit-testable).
 *
 * This module is the DETERMINISTIC core of vault autofill. It NEVER handles a
 * secret. It classifies login fields, picks the username/password targets, and
 * decides whether a stored credential's origin matches the LIVE page origin.
 *
 * SECURITY INVARIANTS (enforced + tested):
 *  - No secret ever appears in this module, its inputs, or its outputs. The
 *    autofill request contract carries ONLY ids/metadata (credentialId, field
 *    ephemeral eids). The decrypted password lives only in the main process.
 *  - Origin matching is computed from the LIVE browser URL (passed by main) vs.
 *    the stored credential origin. Never from page title, model output, or a
 *    renderer-claimed origin. Lookalike domains are rejected.
 *  - Field targeting uses the existing observation ephemeral `eid` — never a
 *    model-generated selector.
 */
import { hostnameOf, registrableDomain } from './protection'

/* ------------------------------ Field model ------------------------------ */

export type FieldClass =
  | 'USERNAME'
  | 'EMAIL'
  | 'PASSWORD'
  | 'OTP'
  | 'SECURITY_CODE'
  | 'NAME'
  | 'PHONE'
  | 'OTHER_SENSITIVE'
  | 'NON_SENSITIVE'
  | 'UNKNOWN'

/**
 * Minimal, deterministic view of a captured form field. Sourced from the
 * existing OBSERVE_SRC raw capture (which carries type/name/autocomplete/label/
 * placeholder/aria) — richer than the reduced ObservedElement, and where the
 * `id` is the observation ephemeral eid (element_N). No value is carried.
 */
export interface VaultFieldInput {
  /** Ephemeral observation id (element_N). */
  id: string
  tag?: string
  role?: string
  type?: string
  name?: string
  autocomplete?: string
  ariaLabel?: string
  label?: string
  placeholder?: string
}

function hay(f: VaultFieldInput): string {
  return [f.name, f.ariaLabel, f.label, f.placeholder, f.id].map((s) => String(s ?? '').toLowerCase()).join(' ')
}

const OTP_RE = /one[-\s]?time|\botp\b|\btotp\b|verification\s*code|auth(entication)?\s*code|2fa|security\s*code(?!.*card)/i
const CARD_CODE_RE = /\bcvv\b|\bcvc\b|\bcsc\b|card\s*(security|verification)|security\s*code/i
const USERNAME_RE = /user\s*name|user_id|userid|\buser\b|login|account|handle|screen\s*name/i
const EMAIL_RE = /e-?mail/i
const PHONE_RE = /phone|mobile|tel(ephone)?/i
const NAME_RE = /full\s*name|first\s*name|last\s*name|given\s*name|family\s*name|your\s*name|\bname\b/i

/** Deterministic field classification from multiple signals (never one attribute). */
export function classifyField(f: VaultFieldInput): FieldClass {
  const type = String(f.type ?? '').toLowerCase()
  const auto = String(f.autocomplete ?? '').toLowerCase()
  const text = hay(f)

  // PASSWORD — strongest signal is the input type, then autocomplete tokens.
  if (type === 'password') return 'PASSWORD'
  if (/current-password|new-password/.test(auto)) return 'PASSWORD'

  // OTP / one-time code (detected, but never auto-retrieved — manual entry).
  if (auto.includes('one-time-code') || OTP_RE.test(text)) return 'OTP'

  // Card / security code.
  if (/cc-csc/.test(auto) || CARD_CODE_RE.test(text)) return 'SECURITY_CODE'

  // EMAIL.
  if (type === 'email' || auto === 'email' || auto === 'username email' || EMAIL_RE.test(text)) return 'EMAIL'

  // USERNAME.
  if (auto === 'username' || (type === 'text' && USERNAME_RE.test(text))) return 'USERNAME'

  // Non-login classes (minimal, for honest reporting only).
  if (type === 'tel' || PHONE_RE.test(text)) return 'PHONE'
  if (auto.includes('name') || NAME_RE.test(text)) return 'NAME'

  if (type === 'text' || type === '' || f.tag === 'textarea') return 'NON_SENSITIVE'
  return 'UNKNOWN'
}

export interface LoginFieldTargets {
  usernameEid?: string
  usernameClass?: 'USERNAME' | 'EMAIL'
  passwordEid?: string
  otpEid?: string
}

/**
 * Deterministically select the login targets from an in-DOM-order field list.
 * Picks the first PASSWORD field, and the nearest preceding USERNAME/EMAIL field
 * (else the first USERNAME/EMAIL on the page). Never guesses beyond these rules.
 */
export function findLoginFields(fields: VaultFieldInput[]): LoginFieldTargets {
  const classed = (Array.isArray(fields) ? fields : []).map((f) => ({ f, c: classifyField(f) }))
  const pwdIdx = classed.findIndex((x) => x.c === 'PASSWORD')
  const out: LoginFieldTargets = {}
  if (pwdIdx >= 0) out.passwordEid = classed[pwdIdx].f.id

  const isUser = (c: FieldClass) => c === 'USERNAME' || c === 'EMAIL'
  let userPick: { f: VaultFieldInput; c: FieldClass } | undefined
  if (pwdIdx >= 0) {
    for (let i = pwdIdx - 1; i >= 0; i--) {
      if (isUser(classed[i].c)) { userPick = classed[i]; break }
    }
  }
  if (!userPick) userPick = classed.find((x) => isUser(x.c))
  if (userPick) {
    out.usernameEid = userPick.f.id
    out.usernameClass = userPick.c as 'USERNAME' | 'EMAIL'
  }

  const otp = classed.find((x) => x.c === 'OTP')
  if (otp) out.otpEid = otp.f.id
  return out
}

/** True when the page has a fillable login form (a password field present). */
export function hasLoginForm(fields: VaultFieldInput[]): boolean {
  return !!findLoginFields(fields).passwordEid
}

/* ------------------------------ Origin match ----------------------------- */

export type OriginConfidence = 'exact' | 'domain' | 'none'
export interface OriginMatch {
  ok: boolean
  confidence: OriginConfidence
  reason?: string
}

function toUrl(input: string): { url: URL; hadScheme: boolean } | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      return { url: new URL(s), hadScheme: true }
    } catch {
      return null
    }
  }
  try {
    return { url: new URL('https://' + s), hadScheme: false }
  } catch {
    return null
  }
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : protocol === 'http:' ? '80' : ''
}

/**
 * Compare the LIVE page URL against a stored credential origin. Exact = scheme +
 * host + port all equal. Domain = same registrable domain (same-site subdomain).
 * Anything else is `none` (never autofilled). Lookalike domains (example-login.com
 * vs example.com) resolve to `none`. Scheme downgrade (https→http) is rejected.
 */
export function matchCredentialOrigin(liveUrl: string, credentialOrigin: string): OriginMatch {
  const live = toUrl(liveUrl)
  if (!live) return { ok: false, confidence: 'none', reason: 'invalid_live_url' }
  const liveScheme = live.url.protocol
  if (liveScheme !== 'http:' && liveScheme !== 'https:') return { ok: false, confidence: 'none', reason: 'ineligible_scheme' }

  const cred = toUrl(credentialOrigin)
  if (!cred) return { ok: false, confidence: 'none', reason: 'invalid_credential_origin' }

  const liveHost = live.url.hostname.toLowerCase()
  const credHost = cred.url.hostname.toLowerCase()
  if (!liveHost || !credHost) return { ok: false, confidence: 'none', reason: 'invalid_host' }

  // Scheme: enforce only when the credential explicitly stored one. Reject downgrade.
  if (cred.hadScheme && cred.url.protocol !== liveScheme) {
    return { ok: false, confidence: 'none', reason: 'scheme_mismatch' }
  }

  // Port: enforce only when the credential explicitly stored a scheme (real origin).
  if (cred.hadScheme) {
    const livePort = live.url.port || defaultPort(liveScheme)
    const credPort = cred.url.port || defaultPort(cred.url.protocol)
    if (livePort !== credPort) return { ok: false, confidence: 'none', reason: 'port_mismatch' }
  }

  if (liveHost === credHost) return { ok: true, confidence: 'exact' }

  const liveReg = registrableDomain(liveHost)
  const credReg = registrableDomain(credHost)
  if (liveReg && credReg && liveReg === credReg) return { ok: true, confidence: 'domain' }

  return { ok: false, confidence: 'none', reason: 'host_mismatch' }
}

/** Safe, display-only credential metadata (NEVER includes the password). */
export interface CredentialMeta {
  id: string
  title?: string
  origin: string
  username: string
}

/**
 * Filter+rank stored credentials that match the live origin. Exact matches first.
 * Returns only safe metadata; passwords are never part of this contract.
 */
export function matchCredentials<T extends CredentialMeta>(liveUrl: string, creds: T[]): T[] {
  const scored: { c: T; conf: OriginConfidence }[] = []
  for (const c of Array.isArray(creds) ? creds : []) {
    const m = matchCredentialOrigin(liveUrl, c.origin)
    if (m.ok) scored.push({ c, conf: m.confidence })
  }
  const rank = (conf: OriginConfidence) => (conf === 'exact' ? 0 : conf === 'domain' ? 1 : 2)
  return scored.sort((a, b) => rank(a.conf) - rank(b.conf)).map((x) => x.c)
}

/** True when a live URL is eligible for vault autofill at all (http/https only). */
export function isEligibleOrigin(liveUrl: string): boolean {
  const u = toUrl(liveUrl)
  if (!u || !u.hadScheme) return false
  return u.url.protocol === 'http:' || u.url.protocol === 'https:'
}

/** Short label for the live origin (scheme+host), for safe display. */
export function displayOrigin(liveUrl: string): string {
  const h = hostnameOf(liveUrl)
  return h || ''
}

/* --------------------------- Request/result contract --------------------------- */

/**
 * The renderer→main autofill request. NOTE: there is intentionally NO secret,
 * password, or vault key field here. Main decrypts and injects; the renderer
 * only names the credential and the resolved target fields.
 */
export interface VaultAutofillRequest {
  profileId: string
  credentialId: string
  /** Live guest webContents id (main resolves the authoritative origin from it). */
  webContentsId: number
  usernameEid?: string
  passwordEid: string
  mode: 'ask' | 'assist' | 'agent'
}

/** The main→renderer result. Communicates outcome only — never the secret. */
export interface VaultAutofillResult {
  filled: boolean
}
