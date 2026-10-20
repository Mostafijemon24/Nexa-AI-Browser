import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* --------------------------- fake electron --------------------------- */

const hoisted = vi.hoisted(() => {
  type Listener = (details: unknown, cb: (r: { cancel?: boolean }) => void) => void
  class FakeSession {
    listener: Listener | null = null
    webRequest = {
      onBeforeRequest: (_filter: unknown, listener: Listener) => {
        this.listener = listener
      }
    }
  }
  const sessions = new Map<string, FakeSession>()
  const topUrls = new Map<number, string>() // webContentsId -> top-frame URL
  return { FakeSession, sessions, topUrls }
})
const { sessions, topUrls } = hoisted

vi.mock('electron', () => ({
  session: {
    fromPartition: (name: string) => {
      if (!hoisted.sessions.has(name)) hoisted.sessions.set(name, new hoisted.FakeSession())
      return hoisted.sessions.get(name)!
    }
  },
  webContents: {
    fromId: (id: number) => {
      const url = hoisted.topUrls.get(id)
      return url === undefined ? null : { getURL: () => url }
    }
  }
}))

import { ProtectionService } from '../../src/main/services/protection'
import { Persistence } from '../../src/main/services/persistence'
import type { PlatformAdapter } from '../../src/platform/types'

let root: string
function fakePlatform(): PlatformAdapter {
  return {
    kind: 'linux',
    appDataDir: () => root,
    profileDir: (id: string) => join(root, 'profiles', id),
    downloadsDir: () => join(root, 'downloads'),
    notify: () => {},
    openPath: async () => ''
  }
}

/** Fire a request through the attached onBeforeRequest listener; returns true if blocked. */
function req(
  profileId: string,
  opts: { url: string; resourceType?: string; top?: string; isPrivate?: boolean; wcId?: number }
): boolean {
  const part = opts.isPrivate ? `nexa-private-${profileId}` : `persist:nexa-${profileId}`
  const sess = sessions.get(part)!
  const wcId = opts.wcId ?? 1
  if (opts.top !== undefined) topUrls.set(wcId, opts.top)
  else topUrls.delete(wcId)
  let cancel = false
  sess.listener!({ url: opts.url, resourceType: opts.resourceType || 'script', webContentsId: wcId }, (r) => {
    cancel = !!r.cancel
  })
  return cancel
}

let services: ProtectionService[] = []
function makeService(persist = new Persistence(fakePlatform())) {
  const svc = new ProtectionService(persist, () => {})
  services.push(svc)
  return svc
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-prot-'))
  sessions.clear()
  topUrls.clear()
  services = []
  mkdirSync(join(root, 'downloads'), { recursive: true })
})
afterEach(() => {
  for (const s of services) s.dispose()
  rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

const TRACKER = 'https://google-analytics.com/collect?v=1&tid=SECRET'
const AD = 'https://doubleclick.net/ad.js'

describe('ProtectionService — real request filtering', () => {
  it('blocks a known tracker and allows an unrelated asset', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])

    expect(req('alpha', { url: TRACKER, top: 'https://news.example.com/' })).toBe(true)
    expect(req('alpha', { url: 'https://cdn.example.com/app.js', top: 'https://news.example.com/' })).toBe(false)

    const snap = svc.getState('alpha')
    expect(snap.totals.blocked).toBe(1)
    expect(snap.totals.allowed).toBe(1)
    expect(snap.totals.byCategory.tracker).toBe(1)
  })

  it('blocks a known ad domain', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    expect(req('alpha', { url: AD, top: 'https://site.com/' })).toBe(true)
    expect(svc.getState('alpha').totals.byCategory.ad).toBe(1)
  })

  it('never blocks main-frame navigations (downloads/pages safe)', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    expect(req('alpha', { url: TRACKER, resourceType: 'mainFrame', top: 'https://google-analytics.com/' })).toBe(false)
  })

  it('does not block when protection is disabled', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    svc.setEnabled('alpha', false)
    expect(req('alpha', { url: TRACKER, top: 'https://site.com/' })).toBe(false)
  })

  it('applies a per-site override (disable then re-enable)', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    // baseline: blocked
    expect(req('alpha', { url: TRACKER, top: 'https://news.example.com/' })).toBe(true)
    // disable for this site
    svc.setSiteEnabled('alpha', 'news.example.com', false)
    expect(req('alpha', { url: TRACKER, top: 'https://news.example.com/' })).toBe(false)
    // a different site is unaffected
    expect(req('alpha', { url: TRACKER, top: 'https://other.com/' })).toBe(true)
    // re-enable
    svc.setSiteEnabled('alpha', 'news.example.com', true)
    expect(req('alpha', { url: TRACKER, top: 'https://news.example.com/' })).toBe(true)
  })

  it('supports allowlist and blocklist', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    svc.addAllow('alpha', 'google-analytics.com')
    expect(req('alpha', { url: TRACKER, top: 'https://site.com/' })).toBe(false)
    svc.removeAllow('alpha', 'google-analytics.com')
    expect(req('alpha', { url: TRACKER, top: 'https://site.com/' })).toBe(true)

    svc.addBlock('alpha', 'innocent.com')
    const r = req('alpha', { url: 'https://innocent.com/x.js', top: 'https://site.com/' })
    expect(r).toBe(true)
  })

  it('rejects invalid domains for site rules', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    expect(() => svc.addBlock('alpha', 'not a domain')).toThrow('invalid_domain')
  })

  it('isolates statistics and rules per profile', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha', 'beta'])
    req('alpha', { url: TRACKER, top: 'https://a.com/' })
    svc.addBlock('alpha', 'foo.com')

    expect(svc.getState('alpha').totals.blocked).toBe(1)
    expect(svc.getState('beta').totals.blocked).toBe(0)
    expect(svc.getRules('beta').block).toEqual([])
    expect(svc.getRules('alpha').block).toContain('foo.com')
  })

  it('keeps private stats separate and never records private URLs', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    req('alpha', { url: TRACKER, top: 'https://secret.example/', isPrivate: true })

    const priv = svc.getStats('alpha', true)
    const pub = svc.getStats('alpha', false)
    expect(priv.totals.blocked).toBe(1)
    expect(pub.totals.blocked).toBe(0)
    // no redacted event history is retained for private browsing
    expect(priv.recent).toHaveLength(0)
  })

  it('records redacted (no query string) recent events for normal browsing', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    req('alpha', { url: TRACKER, top: 'https://news.example.com/' })
    const rec = svc.getState('alpha').recent
    expect(rec).toHaveLength(1)
    expect(rec[0].url).toBe('https://google-analytics.com/collect')
    expect(rec[0].url).not.toContain('SECRET')
    expect(rec[0].category).toBe('tracker')
  })

  it('rejects unsafe profile ids', () => {
    const svc = makeService()
    expect(() => svc.getState('../../etc')).toThrow()
  })

  it('persists site rules across a restart, stats reset (in-memory only)', () => {
    const persist = new Persistence(fakePlatform())
    const svc = makeService(persist)
    svc.attachForProfiles(['alpha'])
    svc.addBlock('alpha', 'foo.com')
    req('alpha', { url: TRACKER, top: 'https://a.com/' })
    expect(svc.getState('alpha').totals.blocked).toBe(1)

    const svc2 = makeService(new Persistence(fakePlatform()))
    svc2.attachForProfiles(['alpha'])
    expect(svc2.getRules('alpha').block).toContain('foo.com') // persisted
    expect(svc2.getState('alpha').totals.blocked).toBe(0) // stats are in-memory
  })

  it('reports per-site blocked counts for the toolbar/popover', () => {
    const svc = makeService()
    svc.attachForProfiles(['alpha'])
    req('alpha', { url: TRACKER, top: 'https://news.example.com/' })
    req('alpha', { url: AD, top: 'https://news.example.com/' })
    const snap = svc.getState('alpha')
    expect(snap.perDomain['example.com'].blocked).toBe(2)
  })
})
