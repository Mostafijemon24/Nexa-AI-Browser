import { describe, expect, it } from 'vitest'
import {
  OBS_MAX_ELEMENTS,
  accessibleName,
  buildObservation,
  formatObservation,
  isSensitiveField,
  resolveTarget,
  sanitizeExtractedLinks,
  visionSupported,
  type ObservedElement,
  type RawObservation
} from '../../src/shared/observation'

/* ------------------------- buildObservation ------------------------- */

describe('buildObservation — DOM/A11y normalization', () => {
  it('assigns stable ephemeral ids in DOM order and keeps a11y names', () => {
    const raw: RawObservation = {
      url: 'https://ex.com',
      title: 'Ex',
      elements: [
        { tag: 'button', ariaLabel: 'Search', visible: true },
        { tag: 'a', text: 'Home', href: 'https://ex.com/home', visible: true }
      ]
    }
    const obs = buildObservation(raw)
    expect(obs.elements.map((e) => e.id)).toEqual(['element_1', 'element_2'])
    expect(obs.elements[0].name).toBe('Search')
    expect(obs.elements[0].role).toBe('button')
    expect(obs.elements[1].role).toBe('link')
    expect(obs.elements[1].href).toBe('https://ex.com/home')
  })

  it('drops invisible elements and bounds to OBS_MAX_ELEMENTS (truncated flag)', () => {
    const elements = Array.from({ length: OBS_MAX_ELEMENTS + 15 }, (_, i) => ({ tag: 'button', text: `b${i}`, visible: true }))
    elements.push({ tag: 'button', text: 'hidden', visible: false } as never)
    const obs = buildObservation({ elements })
    expect(obs.elements.length).toBe(OBS_MAX_ELEMENTS)
    expect(obs.truncated).toBe(true)
    expect(obs.totalElements).toBe(OBS_MAX_ELEMENTS + 15) // invisible excluded
  })

  it('drops non-http(s) hrefs (javascript:/data:) from element map', () => {
    const obs = buildObservation({ elements: [{ tag: 'a', text: 'x', href: 'javascript:alert(1)', visible: true }] })
    expect(obs.elements[0].href).toBeUndefined()
  })

  it('normalizes landmark structure', () => {
    const obs = buildObservation({ structure: { hasMain: true, forms: 2, tables: 1, landmarks: ['main', 'nav'] } })
    expect(obs.structure?.hasMain).toBe(true)
    expect(obs.structure?.forms).toBe(2)
    expect(obs.structure?.landmarks).toContain('nav')
  })
})

/* ------------------------- Sensitive-field redaction ------------------------- */

describe('buildObservation — sensitive-field redaction', () => {
  it('flags password/otp/cvv/token fields and NEVER exposes their value', () => {
    const raw: RawObservation = {
      elements: [
        { tag: 'input', type: 'password', name: 'password', value: 'hunter2', visible: true },
        { tag: 'input', name: 'otp', value: '123456', visible: true },
        { tag: 'input', name: 'cardNumber', value: '4111111111111111', visible: true },
        { tag: 'input', name: 'search', value: 'laptops', visible: true }
      ]
    }
    const obs = buildObservation(raw)
    expect(obs.elements[0].secret).toBe(true)
    expect(obs.elements[0].value).toBeUndefined()
    expect(obs.elements[1].secret).toBe(true)
    expect(obs.elements[1].value).toBeUndefined()
    expect(obs.elements[2].secret).toBe(true)
    expect(obs.elements[2].value).toBeUndefined()
    // Non-secret field keeps a bounded value.
    expect(obs.elements[3].secret).toBe(false)
    expect(obs.elements[3].value).toBe('laptops')
  })

  it('a secret value never appears in the formatted observation text', () => {
    const obs = buildObservation({ elements: [{ tag: 'input', type: 'password', name: 'password', value: 'SECRETPW', visible: true }] })
    const text = formatObservation(obs)
    expect(text).not.toContain('SECRETPW')
    expect(text).toContain('[SECRET')
  })

  it('isSensitiveField detects autocomplete hints and accessibleName is bounded', () => {
    expect(isSensitiveField({ tag: 'input', autocomplete: 'current-password' })).toBe(true)
    expect(isSensitiveField({ tag: 'input', name: 'email' })).toBe(false)
    expect(accessibleName({ ariaLabel: 'A'.repeat(500) }).length).toBeLessThanOrEqual(120)
  })
})

/* ------------------------- resolveTarget ------------------------- */

const els: ObservedElement[] = [
  { id: 'element_1', tag: 'button', role: 'button', name: 'Search', disabled: false, secret: false, interactive: true },
  { id: 'element_2', tag: 'button', role: 'button', name: 'Search results', disabled: false, secret: false, interactive: true },
  { id: 'element_3', tag: 'a', role: 'link', name: 'Continue', disabled: false, secret: false, interactive: true },
  { id: 'element_4', tag: 'a', role: 'link', name: 'Continue', disabled: false, secret: false, interactive: true }
]

describe('resolveTarget — EXACT / STRONG / AMBIGUOUS / NOT_FOUND', () => {
  it('EXACT on an ephemeral eid', () => {
    const r = resolveTarget(els, { eid: 'element_3' })
    expect(r.status).toBe('EXACT')
    expect(r.element?.name).toBe('Continue')
  })

  it('NOT_FOUND on a stale eid (post-navigation)', () => {
    expect(resolveTarget(els, { eid: 'element_99' }).status).toBe('NOT_FOUND')
  })

  it('EXACT on a unique exact name match', () => {
    const r = resolveTarget(els.slice(0, 1), { name: 'Search' })
    expect(r.status).toBe('EXACT')
  })

  it('STRONG on a partial/startsWith match', () => {
    const r = resolveTarget([els[1]], { name: 'Search' }) // "Search results" startsWith "search"
    expect(r.status).toBe('STRONG')
  })

  it('AMBIGUOUS when multiple elements tie at the top score (never guesses)', () => {
    const r = resolveTarget(els, { name: 'Continue' })
    expect(r.status).toBe('AMBIGUOUS')
    expect(r.candidates.length).toBe(2)
    expect(r.element).toBeUndefined()
  })

  it('index disambiguates a tie into EXACT', () => {
    const r = resolveTarget(els, { name: 'Continue', index: 1 })
    expect(r.status).toBe('EXACT')
    expect(r.element?.id).toBe('element_4')
  })

  it('NOT_FOUND when nothing matches', () => {
    expect(resolveTarget(els, { name: 'nonexistent-xyz' }).status).toBe('NOT_FOUND')
  })

  it('role-only unique → STRONG; role-only many → AMBIGUOUS', () => {
    expect(resolveTarget([els[2]], { role: 'link' }).status).toBe('STRONG')
    expect(resolveTarget(els, { role: 'button' }).status).toBe('AMBIGUOUS')
  })
})

/* ------------------------- Link sanitization ------------------------- */

describe('sanitizeExtractedLinks — never returns executable URLs', () => {
  it('keeps http(s), drops javascript:/data:/file:/mailto:, dedupes', () => {
    const out = sanitizeExtractedLinks([
      { text: 'a', href: 'https://ex.com/1' },
      { text: 'dup', href: 'https://ex.com/1' },
      { text: 'js', href: 'javascript:alert(1)' },
      { text: 'data', href: 'data:text/html,x' },
      { text: 'file', href: 'file:///etc/passwd' },
      { text: 'mail', href: 'mailto:a@b.com' },
      { text: 'b', href: 'http://ex.com/2' }
    ])
    expect(out.map((l) => l.href)).toEqual(['https://ex.com/1', 'http://ex.com/2'])
  })
})

/* ------------------------- Vision support (honest) ------------------------- */

describe('visionSupported — honest capability check', () => {
  it('text-only models return false (no fake vision)', () => {
    expect(visionSupported('qwen3:8b')).toBe(false)
    expect(visionSupported('llama3.1:8b')).toBe(false)
    expect(visionSupported(undefined)).toBe(false)
  })
  it('known vision models return true', () => {
    expect(visionSupported('llava:13b')).toBe(true)
    expect(visionSupported('llama3.2-vision:11b')).toBe(true)
    expect(visionSupported('qwen2.5-vl:7b')).toBe(true)
  })
})
