import { describe, expect, it } from 'vitest'
import {
  KNOWN_SERVICES,
  NEXA_COMMANDS,
  PAGE_ACTIONS,
  resolveClickToGo,
  toSafeHttpUrl,
  type ResolveContext,
  type Suggestion
} from '../../src/shared/click-to-go'

const CTX: ResolveContext = { onWebPage: true, hasSelection: false, aiConnected: true, searchEngine: 'Google' }
const NO_PAGE: ResolveContext = { onWebPage: false, hasSelection: false, aiConnected: false }

const first = (s: Suggestion[]) => s[0]
const kinds = (s: Suggestion[]) => s.map((x) => x.kind)
const has = (s: Suggestion[], kind: string, match?: (x: Suggestion) => boolean) =>
  s.some((x) => x.kind === kind && (match ? match(x) : true))

describe('toSafeHttpUrl', () => {
  it('accepts http/https and bare domains (normalized to https)', () => {
    expect(toSafeHttpUrl('https://example.com')).toBe('https://example.com')
    expect(toSafeHttpUrl('http://example.com')).toBe('http://example.com')
    expect(toSafeHttpUrl('https://www.example.com/path')).toBe('https://www.example.com/path')
    expect(toSafeHttpUrl('example.com')).toBe('https://example.com')
  })

  it('rejects dangerous / non-http protocols (they are never treated as URLs)', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'vbscript:x', 'electron:open', 'shell:cmd']) {
      expect(toSafeHttpUrl(bad)).toBeNull()
    }
  })
})

describe('resolveClickToGo — URL', () => {
  it('classifies a URL first and offers it for navigation', () => {
    const r = resolveClickToGo('https://example.com', CTX)
    expect(first(r).kind).toBe('url')
    expect(first(r).url).toBe('https://example.com')
  })

  it('never emits a url intent for dangerous protocols — only search', () => {
    const r = resolveClickToGo('javascript:alert(1)', CTX)
    expect(has(r, 'url')).toBe(false)
    expect(has(r, 'search')).toBe(true)
    // and the search suggestion carries the raw text as a query, not an executable
    expect(first(r).kind).toBe('search')
  })
})

describe('resolveClickToGo — commands', () => {
  it('resolves a NEXA command exactly and ranks it first', () => {
    const r = resolveClickToGo('downloads', CTX)
    expect(first(r).kind).toBe('command')
    expect(first(r).commandId).toBe('downloads')
  })

  it('every command id maps to a real view, overlay, panel, or settings section', () => {
    for (const c of NEXA_COMMANDS) expect(Boolean(c.view || c.overlay || c.panel || c.settingsSection)).toBe(true)
  })

  it('settings / bookmarks / history resolve to their commands', () => {
    expect(first(resolveClickToGo('settings', CTX)).commandId).toBe('settings')
    expect(first(resolveClickToGo('bookmarks', CTX)).commandId).toBe('bookmarks')
    expect(first(resolveClickToGo('history', CTX)).commandId).toBe('history')
  })
})

describe('resolveClickToGo — services', () => {
  it('resolves a known service', () => {
    const r = resolveClickToGo('gmail', CTX)
    expect(has(r, 'service', (x) => x.serviceId === 'gmail')).toBe(true)
  })

  it('resolves service aliases (mail → Gmail)', () => {
    const r = resolveClickToGo('mail', CTX)
    expect(has(r, 'service', (x) => x.serviceId === 'gmail')).toBe(true)
  })

  it('service suggestions carry an https url and no executable payload', () => {
    const r = resolveClickToGo('youtube', CTX)
    const svc = r.find((x) => x.kind === 'service')!
    expect(svc.url?.startsWith('https://')).toBe(true)
    expect(Object.values(svc).every((v) => typeof v !== 'function')).toBe(true)
  })

  it('drive service is navigation-only (no connected/oauth semantics)', () => {
    const drive = KNOWN_SERVICES.find((s) => s.id === 'drive')!
    expect(drive.url).toBe('https://drive.google.com/')
  })
})

describe('resolveClickToGo — page actions (capability-gated)', () => {
  it('offers scan/summarize only when on a web page AND ai connected', () => {
    const r = resolveClickToGo('scan page', CTX)
    expect(has(r, 'page_action', (x) => x.actionId === 'scan')).toBe(true)
  })

  it('hides page actions when not on a web page or ai offline → falls back to search', () => {
    const r = resolveClickToGo('scan page', NO_PAGE)
    expect(has(r, 'page_action')).toBe(false)
    expect(has(r, 'search')).toBe(true)
  })

  it('all page actions require a page and ai (never offered blindly)', () => {
    for (const p of PAGE_ACTIONS) {
      expect(p.requires.includes('page')).toBe(true)
      expect(p.requires.includes('ai')).toBe(true)
    }
  })
})

describe('resolveClickToGo — search + empty', () => {
  it('treats unknown text as a web search', () => {
    const r = resolveClickToGo('wordpress tutorial', CTX)
    expect(kinds(r)).toContain('search')
    expect(has(r, 'command')).toBe(false)
    expect(has(r, 'service')).toBe(false)
    expect(first(r).kind).toBe('search')
  })

  it('empty input yields no executable intent', () => {
    expect(resolveClickToGo('', CTX)).toEqual([])
    expect(resolveClickToGo('   ', CTX)).toEqual([])
  })

  it('always ends with exactly one search fallback', () => {
    const r = resolveClickToGo('gmail', CTX)
    expect(r.filter((x) => x.kind === 'search').length).toBe(1)
    expect(r[r.length - 1].kind).toBe('search')
  })

  it('produces stable deterministic ordering (URL → NEXA → SERVICES → PAGE → SEARCH)', () => {
    const r = resolveClickToGo('example.com', CTX)
    expect(r[0].group).toBe('URL')
    expect(r[r.length - 1].group).toBe('SEARCH')
  })
})
