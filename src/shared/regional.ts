/**
 * NEXA STEP 10 — Per-profile regional preferences (pure, unit-testable core).
 *
 * Legitimate regional customization ONLY: timezone, locale, ordered language
 * preferences, and NEXA-owned date/time/number formatting. This module holds the
 * deterministic validation, registries and formatting logic — no I/O, no AI, no
 * page-script injection, and (critically) NO fingerprint spoofing / randomization.
 *
 * Honesty invariants (enforced + tested):
 *  - Timezone MUST be a runtime-validated IANA identifier (via `Intl`). Arbitrary
 *    strings like "GMT+6" / "Dhaka Time" / "foo/bar" are rejected.
 *  - Locale MUST be a valid BCP-47 tag (via `Intl.getCanonicalLocales`).
 *  - Capability is reported honestly: NEXA cannot override Chromium's PROCESS-GLOBAL
 *    timezone/locale per session, so those are `PARTIALLY_SUPPORTED` (preference +
 *    Accept-Language + NEXA UI formatting), never faked as browser-runtime applied.
 */

/* -------------------------------- Types -------------------------------- */

export type RegionalCapabilityState = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'NOT_SUPPORTED' | 'INVALID_CONFIGURATION'

export type DateFormatPref = 'auto' | 'DMY' | 'MDY' | 'YMD'
export type TimeFormatPref = 'auto' | '12h' | '24h'
export type WeekStartPref = 'auto' | 0 | 1
export type MeasurementPref = 'auto' | 'metric' | 'imperial'

/** Profile-level regional preferences. `'auto'` means "derive from locale/system". */
export interface ProfileRegionalPreferences {
  timezone: string // IANA identifier or 'auto'
  locale: string // BCP-47 tag or 'auto'
  languages: string[] // ordered BCP-47 tags (primary first)
  dateFormat: DateFormatPref
  timeFormat: TimeFormatPref
  weekStartsOn: WeekStartPref
  measurementSystem: MeasurementPref
}

/** Honest, layered capability report — which layer actually applies each setting. */
export interface RegionalCapabilityReport {
  /** Accept-Language header applied at the profile's Chromium session (network). */
  acceptLanguage: RegionalCapabilityState
  /** navigator.language / page Intl locale (Chromium is process-global). */
  locale: RegionalCapabilityState
  /** page Date/Intl timezone (Chromium is process-global). */
  timezone: RegionalCapabilityState
  /** NEXA's own UI date/time/number formatting. */
  appFormatting: RegionalCapabilityState
  /** The resolved Accept-Language string that was/would be applied. */
  acceptLanguageValue: string
}

export const MAX_LANGUAGES = 10

/* ------------------------------ Timezone ------------------------------ */

// Curated IANA fallback (used only if the runtime lacks Intl.supportedValuesOf).
// Not a homemade TZ database — validation is always delegated to Intl at runtime.
const CURATED_TIMEZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Pacific/Auckland'
]

let _timeZoneCache: string[] | null = null

/** All IANA time zones the runtime supports (cached). No network access. */
export function listTimeZones(): string[] {
  if (_timeZoneCache) return _timeZoneCache
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof sv === 'function') {
      const list = sv('timeZone')
      if (Array.isArray(list) && list.length) {
        _timeZoneCache = list.includes('UTC') ? list : ['UTC', ...list]
        return _timeZoneCache
      }
    }
  } catch {
    /* fall through to curated */
  }
  _timeZoneCache = CURATED_TIMEZONES
  return _timeZoneCache
}

/**
 * True only for a runtime-recognized IANA time zone. Delegates to `Intl`, which is
 * authoritative — this rejects "GMT+6", "Dhaka Time", "foo/bar", etc.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  const v = tz.trim()
  if (v === 'auto') return false // 'auto' is a preference sentinel, not an IANA id
  try {
    // Throws RangeError for anything Intl does not recognize as a valid IANA id.
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return true
  } catch {
    return false
  }
}

/** "UTC+06:00" style label for a zone at a given instant. `null` if invalid. */
export function timeZoneOffsetLabel(tz: string, at: number = Date.now()): string | null {
  if (!isValidTimeZone(tz)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(at))
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    // name looks like "GMT+06:00" / "GMT" / "UTC" → normalize to UTC±HH:MM.
    const m = name.match(/([+-])(\d{1,2})(?::?(\d{2}))?/)
    if (!m) return 'UTC+00:00'
    const sign = m[1]
    const hh = m[2].padStart(2, '0')
    const mm = (m[3] || '00').padStart(2, '0')
    return `UTC${sign}${hh}:${mm}`
  } catch {
    return null
  }
}

/* ------------------------------- Locale ------------------------------- */

/** True for a well-formed, runtime-canonicalizable BCP-47 tag (or 'auto'-rejecting). */
export function isValidLocale(tag: unknown): tag is string {
  if (typeof tag !== 'string' || !tag.trim()) return false
  const v = tag.trim()
  if (v === 'auto') return false
  // Structural guard first (rejects spaces / underscores / junk), then Intl canonicalization.
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) return false
  try {
    const canon = Intl.getCanonicalLocales(v)
    return canon.length === 1
  } catch {
    return false
  }
}

/** Canonical form of a valid tag (e.g. "en-us" → "en-US"), else null. */
export function canonicalizeLocale(tag: string): string | null {
  if (!isValidLocale(tag)) return null
  try {
    return Intl.getCanonicalLocales(tag.trim())[0]
  } catch {
    return null
  }
}

/* ---------------------------- Languages ---------------------------- */

/** Validate + canonicalize + dedupe an ordered language list (bounded). */
export function normalizeLanguages(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const canon = typeof raw === 'string' ? canonicalizeLocale(raw) : null
    if (!canon) continue
    const key = canon.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(canon)
    if (out.length >= MAX_LANGUAGES) break
  }
  return out
}

/**
 * Build a deterministic RFC 7231 Accept-Language value from ordered languages.
 * The primary language has implicit q=1.0; each subsequent entry (and its base
 * language fallback) gets a descending q in 0.1 steps down to 0.1.
 *   ['bn-BD','en-US'] → "bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7"
 */
export function buildAcceptLanguage(languages: string[]): string {
  const langs = normalizeLanguages(languages)
  if (!langs.length) return ''
  const tokens: string[] = []
  const emitted = new Set<string>()
  let q = 1.0
  const push = (tag: string) => {
    const key = tag.toLowerCase()
    if (emitted.has(key)) return
    emitted.add(key)
    if (q >= 0.999) tokens.push(tag)
    else tokens.push(`${tag};q=${q.toFixed(1)}`)
    q = Math.max(0.1, Math.round((q - 0.1) * 10) / 10)
  }
  for (const tag of langs) {
    push(tag)
    const base = tag.split('-')[0]
    if (base && base.toLowerCase() !== tag.toLowerCase()) push(base)
  }
  return tokens.join(',')
}

/**
 * Curated, audited language registry for the picker (name — region). Static; no
 * network. Not exhaustive — any valid BCP-47 tag is still accepted via validation.
 */
export const COMMON_LANGUAGES: { tag: string; name: string }[] = [
  { tag: 'en-US', name: 'English — United States' },
  { tag: 'en-GB', name: 'English — United Kingdom' },
  { tag: 'bn-BD', name: 'Bengali — Bangladesh' },
  { tag: 'bn-IN', name: 'Bengali — India' },
  { tag: 'hi-IN', name: 'Hindi — India' },
  { tag: 'ur-PK', name: 'Urdu — Pakistan' },
  { tag: 'de-DE', name: 'German — Germany' },
  { tag: 'fr-FR', name: 'French — France' },
  { tag: 'es-ES', name: 'Spanish — Spain' },
  { tag: 'es-MX', name: 'Spanish — Mexico' },
  { tag: 'pt-BR', name: 'Portuguese — Brazil' },
  { tag: 'it-IT', name: 'Italian — Italy' },
  { tag: 'nl-NL', name: 'Dutch — Netherlands' },
  { tag: 'ru-RU', name: 'Russian — Russia' },
  { tag: 'ar-SA', name: 'Arabic — Saudi Arabia' },
  { tag: 'tr-TR', name: 'Turkish — Türkiye' },
  { tag: 'ja-JP', name: 'Japanese — Japan' },
  { tag: 'ko-KR', name: 'Korean — South Korea' },
  { tag: 'zh-CN', name: 'Chinese — China (Simplified)' },
  { tag: 'zh-TW', name: 'Chinese — Taiwan (Traditional)' },
  { tag: 'id-ID', name: 'Indonesian — Indonesia' },
  { tag: 'th-TH', name: 'Thai — Thailand' },
  { tag: 'vi-VN', name: 'Vietnamese — Vietnam' },
  { tag: 'pl-PL', name: 'Polish — Poland' },
  { tag: 'uk-UA', name: 'Ukrainian — Ukraine' },
  { tag: 'fa-IR', name: 'Persian — Iran' }
]

/** Human label for a tag from the registry, else the canonical tag itself. */
export function languageLabel(tag: string): string {
  const found = COMMON_LANGUAGES.find((l) => l.tag.toLowerCase() === tag.toLowerCase())
  if (found) return found.name
  try {
    const dn = new Intl.DisplayNames([tag], { type: 'language' })
    const base = tag.split('-')[0]
    const name = dn.of(base)
    return name ? `${name} (${tag})` : tag
  } catch {
    return tag
  }
}

/* ------------------------------ Defaults ------------------------------ */

/** System-derived defaults (never mutates the OS; read-only via Intl). */
export function systemRegional(): { timezone: string; locale: string } {
  let timezone = 'UTC'
  let locale = 'en-US'
  try {
    const ro = new Intl.DateTimeFormat().resolvedOptions()
    if (ro.timeZone && isValidTimeZone(ro.timeZone)) timezone = ro.timeZone
    if (ro.locale && isValidLocale(ro.locale)) locale = Intl.getCanonicalLocales(ro.locale)[0]
  } catch {
    /* keep UTC / en-US */
  }
  return { timezone, locale }
}

/** A brand-new profile inherits system defaults; formats stay 'auto'. */
export function defaultRegional(): ProfileRegionalPreferences {
  const sys = systemRegional()
  return {
    timezone: 'auto',
    locale: 'auto',
    languages: [sys.locale],
    dateFormat: 'auto',
    timeFormat: 'auto',
    weekStartsOn: 'auto',
    measurementSystem: 'auto'
  }
}

/**
 * Validate + normalize a preferences object. Returns `{ ok:false }` with the
 * `INVALID_CONFIGURATION` reason when an explicit (non-'auto') value is malformed.
 */
export function validateRegional(
  input: Partial<ProfileRegionalPreferences> | null | undefined
): { ok: true; value: ProfileRegionalPreferences } | { ok: false; reason: string } {
  const base = defaultRegional()
  const p = { ...base, ...(input || {}) }

  if (p.timezone !== 'auto' && !isValidTimeZone(p.timezone)) return { ok: false, reason: 'invalid_timezone' }
  if (p.locale !== 'auto' && !isValidLocale(p.locale)) return { ok: false, reason: 'invalid_locale' }
  const languages = normalizeLanguages(p.languages)
  if ((input?.languages?.length ?? 0) > 0 && languages.length === 0) return { ok: false, reason: 'invalid_languages' }

  const dateFormat: DateFormatPref = (['auto', 'DMY', 'MDY', 'YMD'] as const).includes(p.dateFormat) ? p.dateFormat : 'auto'
  const timeFormat: TimeFormatPref = (['auto', '12h', '24h'] as const).includes(p.timeFormat) ? p.timeFormat : 'auto'
  const weekStartsOn: WeekStartPref = p.weekStartsOn === 0 || p.weekStartsOn === 1 ? p.weekStartsOn : 'auto'
  const measurementSystem: MeasurementPref = (['auto', 'metric', 'imperial'] as const).includes(p.measurementSystem)
    ? p.measurementSystem
    : 'auto'

  return {
    ok: true,
    value: {
      timezone: p.timezone === 'auto' ? 'auto' : (canonicalTimeZone(p.timezone) as string),
      locale: p.locale === 'auto' ? 'auto' : (canonicalizeLocale(p.locale) as string),
      languages: languages.length ? languages : base.languages,
      dateFormat,
      timeFormat,
      weekStartsOn,
      measurementSystem
    }
  }
}

// IANA ids are already canonical; keep a hook for future normalization.
function canonicalTimeZone(tz: string): string {
  return tz.trim()
}

/* ---------------------------- Resolution ---------------------------- */

/** The effective locale used for formatting ('auto' → system). */
export function resolveLocale(p: ProfileRegionalPreferences): string {
  if (p.locale !== 'auto') return p.locale
  if (p.languages.length && isValidLocale(p.languages[0])) return p.languages[0]
  return systemRegional().locale
}

/** The effective time zone used for formatting ('auto' → system). */
export function resolveTimeZone(p: ProfileRegionalPreferences): string {
  return p.timezone !== 'auto' ? p.timezone : systemRegional().timezone
}

/* ---------------------------- Capability ---------------------------- */

/**
 * Honest capability report. Chromium timezone/locale are PROCESS-GLOBAL, so NEXA
 * cannot truly override them per session — those are PARTIALLY_SUPPORTED. Only the
 * Accept-Language header (real session API) and NEXA's own UI formatting are fully
 * SUPPORTED. `INVALID_CONFIGURATION` is returned when validation fails.
 */
export function capabilityReport(p: ProfileRegionalPreferences | null | undefined): RegionalCapabilityReport {
  const v = validateRegional(p)
  if (!v.ok) {
    return {
      acceptLanguage: 'INVALID_CONFIGURATION',
      locale: 'INVALID_CONFIGURATION',
      timezone: 'INVALID_CONFIGURATION',
      appFormatting: 'INVALID_CONFIGURATION',
      acceptLanguageValue: ''
    }
  }
  const acceptLanguageValue = buildAcceptLanguage(v.value.languages)
  return {
    acceptLanguage: acceptLanguageValue ? 'SUPPORTED' : 'NOT_SUPPORTED',
    locale: 'PARTIALLY_SUPPORTED',
    timezone: 'PARTIALLY_SUPPORTED',
    appFormatting: 'SUPPORTED',
    acceptLanguageValue
  }
}

/* ---------------------------- Formatting ---------------------------- */

function dateStyleOptions(p: ProfileRegionalPreferences): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = { timeZone: resolveTimeZone(p) }
  // Date portion
  if (p.dateFormat === 'auto') {
    opts.year = 'numeric'
    opts.month = 'short'
    opts.day = '2-digit'
  } else {
    opts.year = 'numeric'
    opts.month = '2-digit'
    opts.day = '2-digit'
  }
  // Time portion
  if (p.timeFormat === '12h') opts.hour12 = true
  else if (p.timeFormat === '24h') opts.hour12 = false
  return opts
}

/** Format a full date-time for NEXA-owned UI using the profile's locale/timezone. */
export function formatDateTime(date: Date | number, p: ProfileRegionalPreferences): string {
  const locale = resolveLocale(p)
  const opts = dateStyleOptions(p)
  opts.hour = '2-digit'
  opts.minute = '2-digit'
  try {
    if (p.dateFormat && p.dateFormat !== 'auto') {
      // Force explicit component order via a locale hint while keeping numeric parts.
      const hint = dateFormatLocaleHint(p.dateFormat, locale)
      return new Intl.DateTimeFormat(hint, opts).format(date)
    }
    return new Intl.DateTimeFormat(locale, opts).format(date)
  } catch {
    return new Date(date).toISOString()
  }
}

/** Date-only formatting. */
export function formatDate(date: Date | number, p: ProfileRegionalPreferences): string {
  const locale = resolveLocale(p)
  const opts = dateStyleOptions(p)
  try {
    const hint = p.dateFormat !== 'auto' ? dateFormatLocaleHint(p.dateFormat, locale) : locale
    return new Intl.DateTimeFormat(hint, opts).format(date)
  } catch {
    return new Date(date).toISOString().slice(0, 10)
  }
}

/** Time-only formatting honoring 12h/24h preference. */
export function formatTime(date: Date | number, p: ProfileRegionalPreferences): string {
  const locale = resolveLocale(p)
  const opts: Intl.DateTimeFormatOptions = { timeZone: resolveTimeZone(p), hour: '2-digit', minute: '2-digit' }
  if (p.timeFormat === '12h') opts.hour12 = true
  else if (p.timeFormat === '24h') opts.hour12 = false
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date)
  } catch {
    return new Date(date).toISOString().slice(11, 16)
  }
}

/** Locale-aware number formatting for NEXA-owned UI (NOT currency conversion). */
export function formatNumber(n: number, p: ProfileRegionalPreferences): string {
  try {
    return new Intl.NumberFormat(resolveLocale(p)).format(n)
  } catch {
    return String(n)
  }
}

// Map an explicit date-order preference to a representative locale that yields
// that numeric order, without hard-coding string templates.
function dateFormatLocaleHint(fmt: DateFormatPref, fallback: string): string {
  switch (fmt) {
    case 'DMY':
      return 'en-GB' // dd/mm/yyyy
    case 'MDY':
      return 'en-US' // mm/dd/yyyy
    case 'YMD':
      return 'en-CA' // yyyy-mm-dd
    default:
      return fallback
  }
}

/* ------------------------ Week start / measurement ------------------------ */

/** Effective first day of week (0=Sunday, 1=Monday). Derives from locale if 'auto'. */
export function weekStartFor(p: ProfileRegionalPreferences): 0 | 1 {
  if (p.weekStartsOn === 0 || p.weekStartsOn === 1) return p.weekStartsOn
  const locale = resolveLocale(p)
  try {
    const info = (new Intl.Locale(locale) as unknown as { weekInfo?: { firstDay?: number } }).weekInfo
    // weekInfo.firstDay: 1=Monday … 7=Sunday.
    if (info?.firstDay === 7) return 0
    if (typeof info?.firstDay === 'number') return 1
  } catch {
    /* fall through */
  }
  // Conservative regional heuristic when weekInfo is unavailable.
  const region = regionOf(locale)
  return ['US', 'CA', 'JP', 'BR', 'IL'].includes(region) ? 0 : 1
}

/** Effective measurement system. Derives from region if 'auto'. */
export function measurementFor(p: ProfileRegionalPreferences): 'metric' | 'imperial' {
  if (p.measurementSystem === 'metric' || p.measurementSystem === 'imperial') return p.measurementSystem
  const region = regionOf(resolveLocale(p))
  // The only countries not officially metric.
  return ['US', 'LR', 'MM'].includes(region) ? 'imperial' : 'metric'
}

function regionOf(locale: string): string {
  try {
    return new Intl.Locale(locale).maximize().region || ''
  } catch {
    const m = locale.split('-')
    return (m[1] || '').toUpperCase()
  }
}

/* ------------------------ Worker context descriptor ------------------------ */

/** Short, honest, trusted descriptor for the Worker Assistant (no secrets). */
export function describeRegional(p: ProfileRegionalPreferences | null | undefined): string {
  const v = validateRegional(p)
  if (!v.ok) return ''
  const val = v.value
  const parts = [
    `locale ${resolveLocale(val)}`,
    `timezone ${resolveTimeZone(val)}`,
    val.languages.length ? `languages ${val.languages.join(', ')}` : '',
    `week starts ${weekStartFor(val) === 0 ? 'Sunday' : 'Monday'}`,
    `measurement ${measurementFor(val)}`
  ].filter(Boolean)
  return `Regional context (for interpreting dates/numbers only; never act without user confirmation): ${parts.join('; ')}.`
}
