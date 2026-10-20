import { describe, expect, it } from 'vitest'
import {
  classifyNavigation,
  deriveTurboState,
  isDuplicateNavigation,
  isHttpUrl,
  isPrefetchable,
  isSensitiveNavigation,
  msLabel,
  NAV_DEDUPE_MS,
  originOf,
  preconnectTarget,
  sameOrigin,
  summarizePerf,
  turboStateLabel,
  type NavigationPerformance
} from '../../src/shared/turbo'

describe('turbo state model', () => {
  it('derives honest states', () => {
    expect(deriveTurboState({ supported: false, enabled: true })).toBe('NOT_SUPPORTED')
    expect(deriveTurboState({ supported: true, enabled: false })).toBe('OFF')
    expect(deriveTurboState({ supported: true, enabled: true })).toBe('ON')
    expect(deriveTurboState({ supported: true, enabled: true, optimizing: true })).toBe('OPTIMIZING')
  })
  it('labels states without fake claims', () => {
    expect(turboStateLabel('ON')).toBe('Turbo On')
    expect(turboStateLabel('OPTIMIZING')).toBe('Optimizing')
    expect(turboStateLabel('NOT_SUPPORTED')).toBe('Not supported')
    expect(turboStateLabel('ON')).not.toMatch(/faster|x |×/i)
  })
})

describe('URL safety', () => {
  it('accepts only http(s); rejects dangerous schemes', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://example.com/x')).toBe(true)
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'chrome://settings',
      'about:blank',
      'vbscript:x',
      'blob:https://x',
      'ftp://x'
    ]) {
      expect(isHttpUrl(bad)).toBe(false)
    }
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl(42 as unknown)).toBe(false)
  })
  it('extracts origins and compares same-origin', () => {
    expect(originOf('https://a.example.com:8443/p')).toBe('https://a.example.com:8443')
    expect(originOf('about:blank')).toBeNull()
    expect(sameOrigin('https://x.com/a', 'https://x.com/b')).toBe(true)
    expect(sameOrigin('https://x.com', 'https://y.com')).toBe(false)
  })
})

describe('sensitive navigation detection', () => {
  it('flags auth/payment/account paths, hosts and query keys', () => {
    for (const u of [
      'https://example.com/login',
      'https://example.com/user/checkout',
      'https://example.com/oauth2/authorize',
      'https://example.com/reset-password',
      'https://login.example.com/',
      'https://example.com/pay?token=abc',
      'https://bank.example.com/'
    ]) {
      expect(isSensitiveNavigation(u)).toBe(true)
    }
  })
  it('allows ordinary pages', () => {
    expect(isSensitiveNavigation('https://example.com/articles/hello')).toBe(false)
    expect(isSensitiveNavigation('https://news.site/world/2026')).toBe(false)
  })
  it('treats unparseable URLs as sensitive', () => {
    expect(isSensitiveNavigation('not a url')).toBe(true)
  })
})

describe('preconnect policy', () => {
  it('returns origin only for safe, enabled, non-private, non-sensitive http(s)', () => {
    expect(preconnectTarget('https://example.com/article', { enabled: true, privateMode: false })).toBe('https://example.com')
    expect(preconnectTarget('https://example.com/login', { enabled: true, privateMode: false })).toBeNull()
    expect(preconnectTarget('https://example.com', { enabled: false, privateMode: false })).toBeNull()
    expect(preconnectTarget('https://example.com', { enabled: true, privateMode: true })).toBeNull()
    expect(preconnectTarget('javascript:alert(1)', { enabled: true, privateMode: false })).toBeNull()
    expect(preconnectTarget('file:///x', { enabled: true, privateMode: false })).toBeNull()
  })
})

describe('prefetch policy (extremely conservative)', () => {
  const base = { enabled: true, privateMode: false, currentUrl: 'https://site.com/a' }
  it('allows same-origin, trusted, non-sensitive http(s)', () => {
    expect(isPrefetchable('https://site.com/b', { ...base, trusted: true })).toBe(true)
  })
  it('rejects cross-origin, sensitive, untrusted, private, disabled, unsafe scheme', () => {
    expect(isPrefetchable('https://other.com/b', base)).toBe(false)
    expect(isPrefetchable('https://site.com/login', base)).toBe(false)
    expect(isPrefetchable('https://site.com/b', { ...base, trusted: false })).toBe(false)
    expect(isPrefetchable('https://site.com/b', { ...base, privateMode: true })).toBe(false)
    expect(isPrefetchable('https://site.com/b', { ...base, enabled: false })).toBe(false)
    expect(isPrefetchable('javascript:alert(1)', base)).toBe(false)
    expect(isPrefetchable('file:///x', base)).toBe(false)
  })
})

describe('duplicate navigation guard', () => {
  it('suppresses identical url within the window only', () => {
    const prev = { url: 'https://x.com/', at: 1000 }
    expect(isDuplicateNavigation(prev, { url: 'https://x.com/', at: 1000 })).toBe(true)
    expect(isDuplicateNavigation(prev, { url: 'https://x.com/', at: 1000 + NAV_DEDUPE_MS - 1 })).toBe(true)
    expect(isDuplicateNavigation(prev, { url: 'https://x.com/', at: 1000 + NAV_DEDUPE_MS })).toBe(false)
    expect(isDuplicateNavigation(prev, { url: 'https://y.com/', at: 1010 })).toBe(false)
    expect(isDuplicateNavigation(null, { url: 'https://x.com/', at: 1 })).toBe(false)
  })
})

describe('navigation classification (real thresholds only)', () => {
  const perf = (o: Partial<NavigationPerformance>): NavigationPerformance => ({ navigationId: 'n', startedAt: 0, ...o })
  it('classifies by best available signal', () => {
    expect(classifyNavigation(perf({ loadEventEnd: 900 }))).toBe('Fast')
    expect(classifyNavigation(perf({ loadEventEnd: 2500 }))).toBe('Normal')
    expect(classifyNavigation(perf({ loadEventEnd: 8000 }))).toBe('Slow')
    expect(classifyNavigation(perf({ domContentLoaded: 800 }))).toBe('Fast')
    expect(classifyNavigation(perf({ responseStart: 300 }))).toBe('Fast')
  })
  it('returns Unavailable when no timing exists', () => {
    expect(classifyNavigation(perf({}))).toBe('Unavailable')
    expect(classifyNavigation(null)).toBe('Unavailable')
    expect(classifyNavigation(perf({ loadEventEnd: 0 }))).toBe('Unavailable')
  })
})

describe('perf formatting + summary', () => {
  it('formats ms/s and never fabricates missing values', () => {
    expect(msLabel(420)).toBe('420 ms')
    expect(msLabel(1800)).toBe('1.8 s')
    expect(msLabel(undefined)).toBe('Not available')
    expect(msLabel(-5)).toBe('Not available')
  })
  it('summarizes real values with classification', () => {
    const s = summarizePerf({ navigationId: 'n', startedAt: 0, responseStart: 420, domContentLoaded: 1100, loadEventEnd: 1800, fromCache: false })
    expect(s.ttfb).toBe('420 ms')
    expect(s.domContentLoaded).toBe('1.1 s')
    expect(s.load).toBe('1.8 s')
    expect(s.fromCache).toBe(false)
    expect(s.classification).toBe('Normal')
    const empty = summarizePerf(null)
    expect(empty.ttfb).toBe('Not available')
    expect(empty.classification).toBe('Unavailable')
    expect(empty.fromCache).toBeNull()
  })
})
