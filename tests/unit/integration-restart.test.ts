import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Persistence } from '../../src/main/services/persistence'
import { Library } from '../../src/main/services/library'
import type { PlatformAdapter } from '../../src/platform/types'
import type { SessionState } from '../../src/shared/types'

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-int-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('restart + profile isolation (integration)', () => {
  it('persists bookmarks, history, collections and session; survives a simulated restart', () => {
    const platform = fakePlatform()
    // --- first launch ---
    let persist = new Persistence(platform)
    let lib = new Library(persist)

    lib.createBookmark('alpha', { title: 'HN', url: 'https://news.ycombinator.com', parentId: 'bar' })
    lib.recordVisit('alpha', { url: 'https://example.com', title: 'Example' })
    const col = lib.createCollection('alpha', 'Reading')
    lib.addCollectionItem('alpha', { collectionId: col.collections[0].id, title: 'A', url: 'https://a.com' })

    const session: SessionState = {
      tabs: [
        { id: 't1', title: 'HN', url: 'https://news.ycombinator.com', kind: 'web', view: 'web' },
        { id: 't2', title: 'New Tab', url: '', kind: 'chrome', view: 'newtab' }
      ],
      activeTab: 't1',
      workspaces: []
    }
    persist.saveSession('alpha', session)

    // --- simulated restart: brand new instances read from disk ---
    persist = new Persistence(platform)
    lib = new Library(persist)

    const bm = lib.loadBookmarks('alpha').items.filter((i) => i.type === 'bookmark')
    expect(bm).toHaveLength(1)
    expect(bm[0].url).toBe('https://news.ycombinator.com/')

    expect(lib.queryHistory('alpha', {})).toHaveLength(1)
    expect(lib.loadCollections('alpha').collections[0].items).toHaveLength(1)

    const restored = persist.loadSession('alpha')
    expect(restored.tabs).toHaveLength(2)
    expect(restored.activeTab).toBe('t1')
  })

  it('keeps profile A and profile B completely isolated', () => {
    const platform = fakePlatform()
    const persist = new Persistence(platform)
    const lib = new Library(persist)

    lib.createBookmark('alpha', { title: 'A', url: 'https://a.com', parentId: 'bar' })
    lib.recordVisit('alpha', { url: 'https://a-hist.com', title: 'AH' })

    lib.createBookmark('beta', { title: 'B', url: 'https://b.com', parentId: 'bar' })
    lib.recordVisit('beta', { url: 'https://b-hist.com', title: 'BH' })

    const aBm = lib.loadBookmarks('alpha').items.filter((i) => i.type === 'bookmark')
    const bBm = lib.loadBookmarks('beta').items.filter((i) => i.type === 'bookmark')
    expect(aBm.map((i) => i.title)).toEqual(['A'])
    expect(bBm.map((i) => i.title)).toEqual(['B'])

    expect(lib.queryHistory('alpha', {}).map((e) => e.title)).toEqual(['AH'])
    expect(lib.queryHistory('beta', {}).map((e) => e.title)).toEqual(['BH'])
  })

  it('recovers a clean session from corrupted session file without throwing', () => {
    const platform = fakePlatform()
    const persist = new Persistence(platform)
    // Write garbage directly.
    const dir = join(root, 'profiles', 'alpha')
    require('node:fs').mkdirSync(dir, { recursive: true })
    require('node:fs').writeFileSync(join(dir, 'session.json'), '{ this is not json')
    const s = persist.loadSession('alpha')
    expect(s.tabs.length).toBeGreaterThan(0)
  })
})
