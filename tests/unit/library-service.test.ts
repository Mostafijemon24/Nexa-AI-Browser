import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../../src/main/services/library'
import type { Persistence } from '../../src/main/services/persistence'

let root: string
function makeLibrary() {
  // Minimal Persistence stub — Library only uses profileDir().
  const stub = { profileDir: (id: string) => join(root, id) } as unknown as Persistence
  return new Library(stub)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-lib-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('bookmarks service', () => {
  it('creates, edits, deletes and persists across reloads', () => {
    const lib = makeLibrary()
    let store = lib.createBookmark('alpha', { title: 'Ex', url: 'example.com', parentId: 'bar' })
    const b = store.items.find((i) => i.type === 'bookmark')!
    expect(b.url).toBe('https://example.com/')

    lib.updateBookmark('alpha', { id: b.id, title: 'Renamed' })
    // New instance reads from disk -> persistence verified
    const reloaded = makeLibrary().loadBookmarks('alpha')
    expect(reloaded.items.find((i) => i.id === b.id)?.title).toBe('Renamed')

    store = lib.deleteBookmark('alpha', b.id)
    expect(store.items.some((i) => i.id === b.id)).toBe(false)
  })

  it('rejects invalid urls', () => {
    const lib = makeLibrary()
    expect(() => lib.createBookmark('alpha', { title: 'x', url: 'javascript:1' })).toThrow('invalid_url')
  })

  it('supports nested folders and prevents moving a folder into itself', () => {
    const lib = makeLibrary()
    const s1 = lib.createFolder('alpha', { title: 'Parent', parentId: 'bar' })
    const parent = s1.items.find((i) => i.title === 'Parent')!
    const s2 = lib.createFolder('alpha', { title: 'Child', parentId: parent.id })
    const child = s2.items.find((i) => i.title === 'Child')!
    expect(() => lib.moveBookmark('alpha', { id: parent.id, parentId: child.id })).toThrow('denied')
  })

  it('reorders siblings', () => {
    const lib = makeLibrary()
    lib.createBookmark('alpha', { title: 'A', url: 'a.com', parentId: 'bar' })
    const s = lib.createBookmark('alpha', { title: 'B', url: 'b.com', parentId: 'bar' })
    const b = s.items.find((i) => i.title === 'B')!
    const out = lib.reorderBookmark('alpha', { id: b.id, index: 0 })
    const barKids = out.items.filter((i) => i.parentId === 'bar').sort((x, y) => x.index - y.index)
    expect(barKids[0].title).toBe('B')
  })

  it('import parses html and export round-trips', () => {
    const lib = makeLibrary()
    const html = '<DL><p><DT><A HREF="https://a.com">A</A><DT><A HREF="https://b.com">B</A></DL><p>'
    const { imported } = lib.importBookmarks('alpha', html)
    expect(imported).toBe(2)
    const exported = lib.exportBookmarks('alpha')
    expect(exported).toContain('https://a.com/')
  })

  it('isolates bookmarks per profile', () => {
    const lib = makeLibrary()
    lib.createBookmark('alpha', { title: 'A', url: 'a.com', parentId: 'bar' })
    lib.createBookmark('beta', { title: 'B', url: 'b.com', parentId: 'bar' })
    const a = lib.loadBookmarks('alpha').items.filter((i) => i.type === 'bookmark')
    const b = lib.loadBookmarks('beta').items.filter((i) => i.type === 'bookmark')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].title).toBe('A')
    expect(b[0].title).toBe('B')
  })
})

describe('history service', () => {
  it('records, excludes private, and clears', () => {
    const lib = makeLibrary()
    lib.recordVisit('alpha', { url: 'https://a.com', title: 'A' })
    lib.recordVisit('alpha', { url: 'https://secret.com', title: 'S', private: true })
    expect(lib.queryHistory('alpha', {})).toHaveLength(1)
    lib.clearHistory('alpha', 'all')
    expect(lib.queryHistory('alpha', {})).toHaveLength(0)
  })

  it('deletes a single entry', () => {
    const lib = makeLibrary()
    lib.recordVisit('alpha', { url: 'https://a.com', title: 'A' })
    const list = lib.queryHistory('alpha', {})
    lib.deleteHistory('alpha', list[0].id)
    expect(lib.queryHistory('alpha', {})).toHaveLength(0)
  })
})

describe('collections service', () => {
  it('creates, adds items, reorders, removes and deletes', () => {
    const lib = makeLibrary()
    let s = lib.createCollection('alpha', 'Research')
    const c = s.collections[0]
    lib.addCollectionItem('alpha', { collectionId: c.id, title: 'A', url: 'a.com' })
    s = lib.addCollectionItem('alpha', { collectionId: c.id, title: 'B', url: 'b.com' })
    const items = s.collections[0].items
    expect(items).toHaveLength(2)
    const bItem = items.find((i) => i.title === 'B')!
    s = lib.reorderCollectionItem('alpha', { collectionId: c.id, itemId: bItem.id, index: 0 })
    expect(s.collections[0].items[0].title).toBe('B')
    s = lib.removeCollectionItem('alpha', { collectionId: c.id, itemId: bItem.id })
    expect(s.collections[0].items).toHaveLength(1)
    s = lib.deleteCollection('alpha', c.id)
    expect(s.collections).toHaveLength(0)
  })

  it('rejects invalid item urls', () => {
    const lib = makeLibrary()
    const s = lib.createCollection('alpha', 'X')
    expect(() => lib.addCollectionItem('alpha', { collectionId: s.collections[0].id, title: 'x', url: 'javascript:1' })).toThrow('invalid_url')
  })
})
