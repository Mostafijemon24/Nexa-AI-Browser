import { describe, expect, it } from 'vitest'
import {
  cleanDomain,
  compileRules,
  domainChain,
  hostInSet,
  hostnameOf,
  isThirdParty,
  matchRequest,
  normalizeSiteRules,
  parseFilterLine,
  parseFilterList,
  redactRequestUrl,
  registrableDomain,
  type MatchContext
} from '../../src/shared/protection'

const baseCtx = (over: Partial<MatchContext> = {}): MatchContext => ({
  enabled: true,
  categories: { ad: true, tracker: true, annoyance: true },
  allowHosts: new Set(),
  blockHosts: new Set(),
  siteDisabled: false,
  ...over
})

describe('host helpers', () => {
  it('parses hostnames and rejects garbage', () => {
    expect(hostnameOf('https://ads.example.com/x?y=1')).toBe('ads.example.com')
    expect(hostnameOf('not a url')).toBe('')
  })
  it('computes registrable domain incl. multi-label suffixes', () => {
    expect(registrableDomain('a.b.example.com')).toBe('example.com')
    expect(registrableDomain('example.com')).toBe('example.com')
    expect(registrableDomain('foo.bar.co.uk')).toBe('bar.co.uk')
  })
  it('detects third-party', () => {
    expect(isThirdParty('cdn.example.com', 'www.example.com')).toBe(false)
    expect(isThirdParty('tracker.evil.com', 'www.example.com')).toBe(true)
  })
  it('builds a domain chain and matches parent domains', () => {
    expect(domainChain('a.b.c')).toEqual(['a.b.c', 'b.c', 'c'])
    expect(hostInSet('sub.ads.com', new Set(['ads.com']))).toBe(true)
    expect(hostInSet('ads.com.evil.net', new Set(['ads.com']))).toBe(false)
  })
})

describe('filter parsing', () => {
  it('parses ||domain^ block rules', () => {
    const r = parseFilterLine('||ads.example.com^', 'ad')!
    expect(r.domain).toBe('ads.example.com')
    expect(r.isException).toBe(false)
    expect(r.category).toBe('ad')
  })
  it('parses exception (@@) rules', () => {
    const r = parseFilterLine('@@||safe.example.com^', 'ad')!
    expect(r.isException).toBe(true)
    expect(r.domain).toBe('safe.example.com')
  })
  it('parses resource-type and third-party options', () => {
    const r = parseFilterLine('||t.example.com^$script,image,third-party', 'tracker')!
    expect(r.resourceTypes).toEqual(['script', 'image'])
    expect(r.thirdPartyOnly).toBe(true)
  })
  it('ignores comments, cosmetic and malformed lines', () => {
    expect(parseFilterLine('! comment', 'ad')).toBeNull()
    expect(parseFilterLine('example.com##.ad-banner', 'ad')).toBeNull()
    expect(parseFilterLine('', 'ad')).toBeNull()
    expect(parseFilterLine('||not_a_domain', 'ad')).toBeNull()
  })
  it('parses a full list', () => {
    const rules = parseFilterList('! header\n||a.com^\n||b.com^$script\n@@||c.com^\n', 'tracker')
    expect(rules).toHaveLength(3)
  })
})

describe('matchRequest', () => {
  const compiled = compileRules([
    ...parseFilterList('||ads.com^\n||track.com^$third-party\n||script-only.com^$script\n@@||track.com^$image', 'ad')
  ])

  it('blocks an exact/subdomain match', () => {
    expect(matchRequest(compiled, { url: 'https://ads.com/a.js', resourceType: 'script' }, baseCtx()).decision).toBe('block')
    expect(matchRequest(compiled, { url: 'https://sub.ads.com/a.js', resourceType: 'script' }, baseCtx()).decision).toBe('block')
  })
  it('never blocks main-frame navigation', () => {
    expect(matchRequest(compiled, { url: 'https://ads.com/', resourceType: 'mainFrame' }, baseCtx()).decision).toBe('allow')
  })
  it('respects resource-type restrictions', () => {
    expect(matchRequest(compiled, { url: 'https://script-only.com/x.js', resourceType: 'script' }, baseCtx()).decision).toBe('block')
    expect(matchRequest(compiled, { url: 'https://script-only.com/x.png', resourceType: 'image' }, baseCtx()).decision).toBe('allow')
  })
  it('respects third-party option', () => {
    // first-party -> allowed
    expect(matchRequest(compiled, { url: 'https://track.com/p.js', topUrl: 'https://track.com/', resourceType: 'script' }, baseCtx()).decision).toBe('allow')
    // third-party -> blocked
    expect(matchRequest(compiled, { url: 'https://track.com/p.js', topUrl: 'https://site.com/', resourceType: 'script' }, baseCtx()).decision).toBe('block')
  })
  it('honors exception rules over block', () => {
    expect(matchRequest(compiled, { url: 'https://track.com/p.png', topUrl: 'https://site.com/', resourceType: 'image' }, baseCtx()).decision).toBe('allow')
  })
  it('allows when category disabled', () => {
    const r = matchRequest(compiled, { url: 'https://ads.com/a.js', resourceType: 'script' }, baseCtx({ categories: { ad: false, tracker: true, annoyance: true } }))
    expect(r.decision).toBe('allow')
  })
  it('allows everything when protection off or site disabled', () => {
    expect(matchRequest(compiled, { url: 'https://ads.com/a.js', resourceType: 'script' }, baseCtx({ enabled: false })).decision).toBe('allow')
    expect(matchRequest(compiled, { url: 'https://ads.com/a.js', resourceType: 'script' }, baseCtx({ siteDisabled: true })).decision).toBe('allow')
  })
  it('applies user blocklist and allowlist', () => {
    expect(matchRequest(compiled, { url: 'https://safe.io/x.js', resourceType: 'script' }, baseCtx({ blockHosts: new Set(['safe.io']) })).category).toBe('user-block')
    // allowlisted request domain overrides a block rule
    expect(matchRequest(compiled, { url: 'https://ads.com/a.js', resourceType: 'script' }, baseCtx({ allowHosts: new Set(['ads.com']) })).decision).toBe('allow')
    // allowlisted top site allows all
    expect(matchRequest(compiled, { url: 'https://ads.com/a.js', topUrl: 'https://mysite.com/', resourceType: 'script' }, baseCtx({ allowHosts: new Set(['mysite.com']) })).reason).toBe('allowlist-site')
  })
  it('handles malformed request URLs safely', () => {
    expect(matchRequest(compiled, { url: 'javascript:void(0)', resourceType: 'script' }, baseCtx()).decision).toBe('allow')
  })
})

describe('domain + persistence helpers', () => {
  it('cleans user-supplied domains', () => {
    expect(cleanDomain('  https://Example.com/path  ')).toBe('example.com')
    expect(cleanDomain('*.ads.com')).toBe('ads.com')
    expect(cleanDomain('example.com:8080')).toBe('example.com')
    expect(cleanDomain('not a domain')).toBeNull()
    expect(cleanDomain('localhost')).toBeNull()
  })
  it('normalizes site rules and rejects junk', () => {
    const r = normalizeSiteRules({ version: 1, allow: ['a.com'], block: ['b.com'], overrides: { 'c.com': false } })
    expect(r.allow).toEqual(['a.com'])
    expect(normalizeSiteRules('garbage').allow).toEqual([])
    expect(normalizeSiteRules({ allow: 'x' }).block).toEqual([])
  })
})

describe('privacy redaction', () => {
  it('drops query strings and secrets', () => {
    expect(redactRequestUrl('https://t.com/pixel?token=SECRET&u=1')).toBe('https://t.com/pixel')
    expect(redactRequestUrl('https://user:pass@t.com/p?x=1')).not.toContain('pass')
    expect(redactRequestUrl('not-a-url')).toBe('[unparseable-url]')
  })
})
