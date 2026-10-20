import { describe, expect, it } from 'vitest'
import {
  classifyField,
  displayOrigin,
  findLoginFields,
  hasLoginForm,
  isEligibleOrigin,
  matchCredentialOrigin,
  matchCredentials,
  type CredentialMeta,
  type VaultFieldInput
} from '../../src/shared/vault-autofill'

describe('classifyField — deterministic, multi-signal', () => {
  it('classifies password by input type and autocomplete tokens', () => {
    expect(classifyField({ id: 'element_1', tag: 'input', type: 'password' })).toBe('PASSWORD')
    expect(classifyField({ id: 'element_2', tag: 'input', type: 'text', autocomplete: 'current-password' })).toBe('PASSWORD')
    expect(classifyField({ id: 'element_3', tag: 'input', type: 'text', autocomplete: 'new-password' })).toBe('PASSWORD')
  })
  it('classifies email and username distinctly', () => {
    expect(classifyField({ id: 'element_1', type: 'email' })).toBe('EMAIL')
    expect(classifyField({ id: 'element_2', type: 'text', name: 'email' })).toBe('EMAIL')
    expect(classifyField({ id: 'element_3', type: 'text', autocomplete: 'username' })).toBe('USERNAME')
    expect(classifyField({ id: 'element_4', type: 'text', name: 'login', label: 'Username' })).toBe('USERNAME')
  })
  it('classifies OTP and security code (never as password/username)', () => {
    expect(classifyField({ id: 'element_1', type: 'text', autocomplete: 'one-time-code' })).toBe('OTP')
    expect(classifyField({ id: 'element_2', type: 'text', label: 'Verification code' })).toBe('OTP')
    expect(classifyField({ id: 'element_3', type: 'text', name: 'cvv' })).toBe('SECURITY_CODE')
  })
  it('PASSWORD ≠ USERNAME, OTP ≠ PASSWORD, SECURITY_CODE ≠ USERNAME', () => {
    expect(classifyField({ id: 'e', type: 'password' })).not.toBe('USERNAME')
    expect(classifyField({ id: 'e', autocomplete: 'one-time-code' })).not.toBe('PASSWORD')
    expect(classifyField({ id: 'e', name: 'cvv' })).not.toBe('USERNAME')
  })
  it('does not treat unknown fields as sensitive login fields', () => {
    expect(classifyField({ id: 'e', type: 'checkbox' })).toBe('UNKNOWN')
    expect(classifyField({ id: 'e', type: 'text', name: 'search' })).toBe('NON_SENSITIVE')
  })
})

describe('findLoginFields — deterministic target selection', () => {
  const form: VaultFieldInput[] = [
    { id: 'element_1', type: 'text', name: 'q' },
    { id: 'element_2', type: 'email', name: 'email', label: 'Email' },
    { id: 'element_3', type: 'password', name: 'password', label: 'Password' },
    { id: 'element_4', type: 'text', autocomplete: 'one-time-code', label: 'Code' }
  ]
  it('picks the password field and the nearest preceding username/email', () => {
    const t = findLoginFields(form)
    expect(t.passwordEid).toBe('element_3')
    expect(t.usernameEid).toBe('element_2')
    expect(t.usernameClass).toBe('EMAIL')
    expect(t.otpEid).toBe('element_4')
  })
  it('returns no password target when there is no password field', () => {
    const t = findLoginFields([{ id: 'element_1', type: 'text', name: 'search' }])
    expect(t.passwordEid).toBeUndefined()
    expect(hasLoginForm([{ id: 'element_1', type: 'text', name: 'search' }])).toBe(false)
  })
  it('falls back to the first username/email when none precedes the password', () => {
    const t = findLoginFields([
      { id: 'element_1', type: 'password' },
      { id: 'element_2', type: 'email' }
    ])
    expect(t.passwordEid).toBe('element_1')
    expect(t.usernameEid).toBe('element_2')
  })
})

describe('matchCredentialOrigin — live origin authority + phishing safety', () => {
  it('exact scheme+host+port', () => {
    const m = matchCredentialOrigin('https://example.com/login', 'https://example.com')
    expect(m.ok).toBe(true)
    expect(m.confidence).toBe('exact')
  })
  it('rejects scheme downgrade (https credential vs http live)', () => {
    const m = matchCredentialOrigin('http://example.com', 'https://example.com')
    expect(m.ok).toBe(false)
    expect(m.reason).toBe('scheme_mismatch')
  })
  it('rejects port difference', () => {
    const m = matchCredentialOrigin('https://example.com', 'https://example.com:8443')
    expect(m.ok).toBe(false)
    expect(m.reason).toBe('port_mismatch')
  })
  it('accepts same-site subdomain as domain confidence', () => {
    const m = matchCredentialOrigin('https://login.example.com', 'example.com')
    expect(m.ok).toBe(true)
    expect(m.confidence).toBe('domain')
  })
  it('rejects lookalike domains', () => {
    const m = matchCredentialOrigin('https://example-login.com', 'example.com')
    expect(m.ok).toBe(false)
    expect(m.reason).toBe('host_mismatch')
  })
  it('rejects internationalized/punycode lookalikes (distinct hosts)', () => {
    // Cyrillic "а" apple vs latin apple → different punycode host
    const m = matchCredentialOrigin('https://xn--pple-43d.com', 'apple.com')
    expect(m.ok).toBe(false)
  })
  it('rejects ineligible live schemes and invalid input', () => {
    expect(matchCredentialOrigin('about:blank', 'example.com').ok).toBe(false)
    expect(matchCredentialOrigin('file:///etc/passwd', 'example.com').ok).toBe(false)
    expect(matchCredentialOrigin('', 'example.com').ok).toBe(false)
    expect(matchCredentialOrigin('https://example.com', '').ok).toBe(false)
  })
})

describe('matchCredentials — selection metadata only', () => {
  const creds: CredentialMeta[] = [
    { id: 'c1', origin: 'https://example.com', username: 'john@example.com', title: 'Example' },
    { id: 'c2', origin: 'https://example.com', username: 'work@example.com' },
    { id: 'c3', origin: 'https://other.com', username: 'x' },
    { id: 'c4', origin: 'https://login.example.com', username: 'sub@example.com' }
  ]
  it('returns one/multiple/no matches by live origin', () => {
    expect(matchCredentials('https://other.com', creds).map((c) => c.id)).toEqual(['c3'])
    const multi = matchCredentials('https://example.com', creds).map((c) => c.id)
    expect(multi).toContain('c1')
    expect(multi).toContain('c2')
    expect(matchCredentials('https://nomatch.test', creds)).toHaveLength(0)
  })
  it('ranks exact origin before same-site subdomain', () => {
    const ids = matchCredentials('https://example.com', creds).map((c) => c.id)
    expect(ids.indexOf('c1')).toBeLessThan(ids.indexOf('c4'))
  })
  it('never exposes a password field in the selection contract', () => {
    const json = JSON.stringify(matchCredentials('https://example.com', creds))
    expect(json).not.toContain('password')
  })
})

describe('eligibility + display helpers', () => {
  it('isEligibleOrigin only for http/https with explicit scheme', () => {
    expect(isEligibleOrigin('https://example.com')).toBe(true)
    expect(isEligibleOrigin('http://localhost:3000')).toBe(true)
    expect(isEligibleOrigin('about:blank')).toBe(false)
    expect(isEligibleOrigin('example.com')).toBe(false)
  })
  it('displayOrigin returns the hostname only', () => {
    expect(displayOrigin('https://john:secret@example.com/login?x=1')).toBe('example.com')
  })
})
