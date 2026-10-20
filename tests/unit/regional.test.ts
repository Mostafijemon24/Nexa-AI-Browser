import { describe, expect, it } from 'vitest'
import {
  buildAcceptLanguage,
  canonicalizeLocale,
  capabilityReport,
  defaultRegional,
  describeRegional,
  formatDate,
  formatNumber,
  isValidLocale,
  isValidTimeZone,
  listTimeZones,
  MAX_LANGUAGES,
  measurementFor,
  normalizeLanguages,
  resolveLocale,
  resolveTimeZone,
  timeZoneOffsetLabel,
  validateRegional,
  weekStartFor,
  type ProfileRegionalPreferences
} from '../../src/shared/regional'

const mk = (o: Partial<ProfileRegionalPreferences>): ProfileRegionalPreferences => ({ ...defaultRegional(), ...o })

describe('timezone validation (IANA via Intl)', () => {
  it('accepts valid IANA identifiers', () => {
    for (const tz of ['UTC', 'Asia/Dhaka', 'Europe/Berlin', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney']) {
      expect(isValidTimeZone(tz)).toBe(true)
    }
  })
  it('rejects arbitrary / malformed strings', () => {
    for (const bad of ['GMT+6', 'Dhaka Time', 'Bangladesh Time', 'foo/bar', 'invalid', '', 'auto', 42 as unknown]) {
      expect(isValidTimeZone(bad)).toBe(false)
    }
  })
  it('produces a UTC±HH:MM offset label for valid zones', () => {
    expect(timeZoneOffsetLabel('UTC')).toBe('UTC+00:00')
    expect(timeZoneOffsetLabel('foo/bar')).toBeNull()
    expect(timeZoneOffsetLabel('Asia/Dhaka')).toMatch(/^UTC[+-]\d{2}:\d{2}$/)
  })
  it('exposes a non-empty runtime timezone registry (no network)', () => {
    const list = listTimeZones()
    expect(list.length).toBeGreaterThan(0)
    expect(list).toContain('UTC')
  })
})

describe('locale validation (BCP-47)', () => {
  it('accepts valid tags', () => {
    for (const t of ['en-US', 'en-GB', 'bn-BD', 'de-DE', 'fr-FR', 'ja-JP', 'hi-IN']) {
      expect(isValidLocale(t)).toBe(true)
    }
  })
  it('rejects malformed tags', () => {
    for (const bad of ['en_US', 'english', 'e', '123', 'en US', '', 'auto', {} as unknown]) {
      expect(isValidLocale(bad)).toBe(false)
    }
  })
  it('canonicalizes case', () => {
    expect(canonicalizeLocale('en-us')).toBe('en-US')
    expect(canonicalizeLocale('BN-bd')).toBe('bn-BD')
    expect(canonicalizeLocale('nope')).toBeNull()
  })
})

describe('language ordering + Accept-Language', () => {
  it('normalizes, dedupes and bounds', () => {
    expect(normalizeLanguages(['bn-BD', 'en-US', 'BN-bd', 'garbage'])).toEqual(['bn-BD', 'en-US'])
    expect(normalizeLanguages('nope' as unknown)).toEqual([])
    expect(normalizeLanguages(Array(50).fill('en-US')).length).toBeLessThanOrEqual(MAX_LANGUAGES)
  })
  it('builds descending q-values with base fallbacks, primary first', () => {
    expect(buildAcceptLanguage(['bn-BD', 'en-US'])).toBe('bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7')
    expect(buildAcceptLanguage(['en-US'])).toBe('en-US,en;q=0.9')
    expect(buildAcceptLanguage([])).toBe('')
  })
})

describe('defaults + validation', () => {
  it('default profile inherits system defaults with auto formats', () => {
    const d = defaultRegional()
    expect(d.timezone).toBe('auto')
    expect(d.locale).toBe('auto')
    expect(d.languages.length).toBeGreaterThan(0)
    expect(d.dateFormat).toBe('auto')
  })
  it('validates + normalizes explicit values', () => {
    const v = validateRegional({ timezone: 'Asia/Dhaka', locale: 'bn-bd', languages: ['bn-BD', 'en-US'], dateFormat: 'DMY' })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.value.timezone).toBe('Asia/Dhaka')
      expect(v.value.locale).toBe('bn-BD')
      expect(v.value.dateFormat).toBe('DMY')
    }
  })
  it('rejects invalid timezone / locale as INVALID_CONFIGURATION', () => {
    expect(validateRegional({ timezone: 'GMT+6' })).toMatchObject({ ok: false, reason: 'invalid_timezone' })
    expect(validateRegional({ locale: 'en_US' })).toMatchObject({ ok: false, reason: 'invalid_locale' })
    const rep = capabilityReport({ timezone: 'foo/bar' } as ProfileRegionalPreferences)
    expect(rep.timezone).toBe('INVALID_CONFIGURATION')
  })
})

describe('capability report (honest, layered)', () => {
  it('marks Accept-Language + app formatting supported; tz/locale partial', () => {
    const rep = capabilityReport(mk({ languages: ['bn-BD', 'en-US'] }))
    expect(rep.acceptLanguage).toBe('SUPPORTED')
    expect(rep.appFormatting).toBe('SUPPORTED')
    expect(rep.timezone).toBe('PARTIALLY_SUPPORTED')
    expect(rep.locale).toBe('PARTIALLY_SUPPORTED')
    expect(rep.acceptLanguageValue).toBe('bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7')
  })
})

describe('resolution + formatting (NEXA UI)', () => {
  const p = mk({ timezone: 'UTC', locale: 'en-GB', languages: ['en-GB'], dateFormat: 'DMY', timeFormat: '24h' })
  it('resolves effective locale/timezone', () => {
    expect(resolveLocale(p)).toBe('en-GB')
    expect(resolveTimeZone(p)).toBe('UTC')
  })
  it('formats date/number deterministically at a fixed instant', () => {
    const at = Date.UTC(2026, 2, 4, 9, 5) // 2026-03-04 09:05 UTC
    // en-GB DMY → 04/03/2026
    expect(formatDate(at, p)).toBe('04/03/2026')
    // MDY variant
    expect(formatDate(at, mk({ ...p, dateFormat: 'MDY' }))).toBe('03/04/2026')
    // YMD variant
    expect(formatDate(at, mk({ ...p, dateFormat: 'YMD' }))).toBe('2026-03-04')
    expect(formatNumber(1234.56, mk({ locale: 'en-US' }))).toBe('1,234.56')
    expect(formatNumber(1234.56, mk({ locale: 'de-DE' }))).toBe('1.234,56')
  })
})

describe('week start + measurement', () => {
  it('honors explicit overrides', () => {
    expect(weekStartFor(mk({ weekStartsOn: 0 }))).toBe(0)
    expect(weekStartFor(mk({ weekStartsOn: 1 }))).toBe(1)
    expect(measurementFor(mk({ measurementSystem: 'imperial' }))).toBe('imperial')
    expect(measurementFor(mk({ measurementSystem: 'metric' }))).toBe('metric')
  })
  it('derives from locale/region when auto', () => {
    expect(measurementFor(mk({ locale: 'en-US', measurementSystem: 'auto' }))).toBe('imperial')
    expect(measurementFor(mk({ locale: 'de-DE', measurementSystem: 'auto' }))).toBe('metric')
    expect([0, 1]).toContain(weekStartFor(mk({ locale: 'en-US', weekStartsOn: 'auto' })))
  })
})

describe('worker regional descriptor', () => {
  it('produces a bounded, honest, non-actionable descriptor', () => {
    const s = describeRegional(mk({ timezone: 'Asia/Dhaka', locale: 'bn-BD', languages: ['bn-BD', 'en-US'] }))
    expect(s).toContain('Asia/Dhaka')
    expect(s).toContain('bn-BD')
    expect(s).toContain('never act without user confirmation')
    expect(describeRegional({ timezone: 'foo/bar' } as ProfileRegionalPreferences)).toBe('')
  })
})
