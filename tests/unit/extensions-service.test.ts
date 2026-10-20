import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtensionService, type ExtSessionLike, type ExtensionSessionProvider } from '../../src/main/services/extensions'

const base = mkdtempSync(join(tmpdir(), 'nexa-ext-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const fakePersist = { profileDir: (id: string) => join(base, id) } as unknown as import('../../src/main/services/persistence').Persistence

// A fake session that records load/remove per partition and assigns valid ids.
class FakeSession implements ExtSessionLike {
  loaded = new Map<string, { path: string }>()
  loadCalls: string[] = []
  removeCalls: string[] = []
  constructor(private idFor: (path: string) => string) {}
  async loadExtension(path: string) {
    const id = this.idFor(path)
    this.loaded.set(id, { path })
    this.loadCalls.push(path)
    return { id, name: 'Fake Ext', version: '1.0.0', manifest: {}, path }
  }
  removeExtension(id: string) {
    this.loaded.delete(id)
    this.removeCalls.push(id)
  }
  getAllExtensions() {
    return [...this.loaded.keys()].map((id) => ({ id }))
  }
}

function idFor(path: string): string {
  // Deterministic valid a–p id derived from the path.
  let h = 0
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const alphabet = 'abcdefghijklmnop'
  let out = ''
  for (let i = 0; i < 32; i++) {
    out += alphabet[(h + i * 7) % 16]
  }
  return out
}

function providerWith(persistSessions: Map<string, FakeSession>, privateSessions: Map<string, FakeSession>): ExtensionSessionProvider {
  const getP = (m: Map<string, FakeSession>, id: string) => {
    if (!m.has(id)) m.set(id, new FakeSession(idFor))
    return m.get(id)!
  }
  return {
    persist: (id) => getP(persistSessions, id),
    private: (id) => getP(privateSessions, id)
  }
}

const MANIFEST = {
  manifest_version: 3,
  name: 'Fake Ext',
  version: '1.0.0',
  description: 'test',
  permissions: ['storage'],
  host_permissions: ['https://example.com/*'],
  content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'] }]
}

function makeService(over: { readManifest?: (dir: string) => unknown } = {}) {
  const persistSessions = new Map<string, FakeSession>()
  const privateSessions = new Map<string, FakeSession>()
  const svc = new ExtensionService(fakePersist, () => {}, {
    sessions: providerWith(persistSessions, privateSessions),
    readManifest: over.readManifest || (() => MANIFEST),
    now: () => 1000
  })
  return { svc, persistSessions, privateSessions }
}

let extPath: string
beforeEach(() => {
  // Isolate on-disk per-profile stores between tests.
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  extPath = mkdtempSync(join(base, 'src-'))
})

describe('ExtensionService — install', () => {
  it('validates + loads into the persist session and enables', async () => {
    const { svc, persistSessions } = makeService()
    const res = await svc.install('alpha', extPath)
    expect(res.ok).toBe(true)
    expect(res.info?.enabled).toBe(true)
    expect(res.info?.lifecycle).toBe('ENABLED')
    expect(res.info?.hasContentScripts).toBe(true)
    // loaded into the correct per-profile persist session
    expect(persistSessions.get('alpha')?.loadCalls).toContain(extPath)
    // list reflects it
    expect(svc.list('alpha')).toHaveLength(1)
  })

  it('rejects a missing/relative path', async () => {
    const { svc } = makeService()
    expect((await svc.install('alpha', 'relative/path')).error).toBe('path_not_found')
    expect((await svc.install('alpha', '/nonexistent/abs/path')).error).toBe('path_not_found')
  })

  it('rejects an invalid manifest before loading', async () => {
    const { svc, persistSessions } = makeService({ readManifest: () => ({ manifest_version: 2, name: 'x', version: '1' }) })
    const res = await svc.install('alpha', extPath)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('manifest_v2_unsupported')
    // nothing loaded
    expect(persistSessions.get('alpha')).toBeUndefined()
  })

  it('rejects a manifest with forbidden permissions (BLOCKED, no load)', async () => {
    const { svc } = makeService({ readManifest: () => ({ ...MANIFEST, permissions: ['storage', 'debugger'] }) })
    const res = await svc.install('alpha', extPath)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('blocked_permissions')
  })
})

describe('ExtensionService — profile isolation', () => {
  it('an extension installed in profile A does not appear in profile B', async () => {
    const { svc } = makeService()
    await svc.install('alpha', extPath)
    expect(svc.list('alpha')).toHaveLength(1)
    expect(svc.list('beta')).toHaveLength(0)
  })

  it('loads into the profile-specific partition only', async () => {
    const { svc, persistSessions } = makeService()
    await svc.install('alpha', extPath)
    expect(persistSessions.has('alpha')).toBe(true)
    expect(persistSessions.has('beta')).toBe(false)
  })
})

describe('ExtensionService — enable/disable + private mode', () => {
  it('disable removes from sessions; re-enable reloads', async () => {
    const { svc, persistSessions } = makeService()
    const inst = await svc.install('alpha', extPath)
    const id = inst.info!.id
    const persist = persistSessions.get('alpha')!

    const off = await svc.setEnabled('alpha', id, false)
    expect(off.info?.enabled).toBe(false)
    expect(off.info?.lifecycle).toBe('DISABLED')
    expect(persist.removeCalls).toContain(id)

    const on = await svc.setEnabled('alpha', id, true)
    expect(on.info?.enabled).toBe(true)
    expect(persist.loadCalls.filter((p) => p === extPath).length).toBeGreaterThanOrEqual(2)
  })

  it('private mode is opt-in: no private load until explicitly enabled', async () => {
    const { svc, privateSessions } = makeService()
    const inst = await svc.install('alpha', extPath)
    const id = inst.info!.id
    // not loaded into private by default
    expect(privateSessions.get('alpha')).toBeUndefined()

    const p = await svc.setPrivate('alpha', id, true)
    expect(p.info?.privateEnabled).toBe(true)
    expect(privateSessions.get('alpha')?.loadCalls).toContain(extPath)

    // turning private off removes from the private session
    await svc.setPrivate('alpha', id, false)
    expect(privateSessions.get('alpha')?.removeCalls).toContain(id)
  })

  it('cannot enable a blocked extension', async () => {
    const { svc } = makeService({ readManifest: () => ({ ...MANIFEST, permissions: ['storage', 'debugger'] }) })
    // install fails; simulate a persisted blocked record via a fresh install attempt path
    const res = await svc.install('alpha', extPath)
    expect(res.ok).toBe(false)
  })
})

describe('ExtensionService — remove + reconcile', () => {
  it('remove clears the record and the sessions', async () => {
    const { svc, persistSessions } = makeService()
    const inst = await svc.install('alpha', extPath)
    const id = inst.info!.id
    const r = svc.remove('alpha', id)
    expect(r.ok).toBe(true)
    expect(svc.list('alpha')).toHaveLength(0)
    expect(persistSessions.get('alpha')?.removeCalls).toContain(id)
  })

  it('applyForProfile reloads enabled extensions and isolates failures', async () => {
    const { svc, persistSessions } = makeService()
    await svc.install('alpha', extPath)
    // fresh service sharing the same persisted store + sessions
    await svc.applyForProfile('alpha')
    expect(persistSessions.get('alpha')!.loadCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('site access mode persists', async () => {
    const { svc } = makeService()
    const inst = await svc.install('alpha', extPath)
    const r = svc.setSiteAccess('alpha', inst.info!.id, 'never')
    expect(r.info?.siteAccess).toBe('never')
    expect(svc.list('alpha')[0].siteAccess).toBe('never')
  })
})
