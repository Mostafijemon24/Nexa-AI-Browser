import { describe, expect, it } from 'vitest'
import {
  emptyHistory,
  parseNetscape,
  pruneHistory,
  queryHistory,
  recordVisit,
  serializeNetscape,
  validateBookmarkUrl,
  emptyBookmarks,
  normalizeBookmarks
} from '../../src/shared/library'

describe('validateBookmarkUrl', () => {
  it('accepts http/https and normalizes bare hosts', () => {
    expect(validateBookmarkUrl('https://a.com/')).toBe('https://a.com/')
    expect(validateBookmarkUrl('example.com')).toBe('https://example.com/')
  })
  it('rejects dangerous schemes', () => {
    expect(validateBookmarkUrl('javascript:alert(1)')).toBeNull()
    expect(validateBookmarkUrl('file:///etc/passwd')).toBeNull()
    expect(validateBookmarkUrl('data:text/html,<script>')).toBeNull()
    expect(validateBookmarkUrl('')).toBeNull()
  })
})

describe('netscape import/export', () => {
  it('parses folders and bookmarks without executing content', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://news.ycombinator.com">HN</A>
    <DT><A HREF="javascript:alert(1)">evil</A>
  </DL><p>
  <DT><A HREF="https://example.com">Example</A>
</DL><p>`
    const tree = parseNetscape(html)
    const work = tree.find((n) => n.type === 'folder') as { type: 'folder'; title: string; children: unknown[] }
    expect(work.title).toBe('Work')
    // evil javascript: url filtered out
    expect(work.children).toHaveLength(1)
    expect(tree.some((n) => n.type === 'bookmark' && n.url === 'https://example.com/')).toBe(true)
  })

  it('serializes a store to importable HTML round-trip', () => {
    const store = emptyBookmarks()
    const now = Date.now()
    store.items.push({ id: 'b1', parentId: 'bar', type: 'bookmark', title: 'Example', url: 'https://example.com/', createdAt: now, updatedAt: now, index: 0 })
    const html = serializeNetscape(store)
    const reparsed = parseNetscape(html)
    // 'Bookmark Bar' folder with one child
    const bar = reparsed.find((n) => n.type === 'folder') as { children: unknown[] }
    expect(bar.children).toHaveLength(1)
  })

  it('normalizeBookmarks guarantees roots and drops bad urls', () => {
    const store = normalizeBookmarks({ version: 1, items: [{ id: 'x', parentId: 'bar', type: 'bookmark', title: 'bad', url: 'javascript:1', createdAt: 1, updatedAt: 1, index: 0 }] })
    expect(store.items.some((i) => i.id === 'bar')).toBe(true)
    expect(store.items.some((i) => i.id === 'other')).toBe(true)
    expect(store.items.some((i) => i.id === 'x')).toBe(false)
  })
})

describe('history pure ops', () => {
  it('dedupes visits and increments count', () => {
    let h = emptyHistory()
    h = recordVisit(h, 'https://a.com', 'A', 1000)
    h = recordVisit(h, 'https://a.com/', 'A2', 2000)
    expect(h.entries).toHaveLength(1)
    expect(h.entries[0].visitCount).toBe(2)
    expect(h.entries[0].lastVisitedAt).toBe(2000)
  })
  it('ignores unsafe urls', () => {
    const h = recordVisit(emptyHistory(), 'javascript:1', 'x')
    expect(h.entries).toHaveLength(0)
  })
  it('searches and filters by range', () => {
    let h = emptyHistory()
    const now = 10_000_000_000
    h = recordVisit(h, 'https://old.com', 'Old', now - 40 * 86_400_000)
    h = recordVisit(h, 'https://new.com', 'New', now - 1000)
    expect(queryHistory(h, { range: 'week', now }).map((e) => e.title)).toEqual(['New'])
    expect(queryHistory(h, { search: 'old', now }).map((e) => e.title)).toEqual(['Old'])
  })
  it('prunes by retention window', () => {
    let h = emptyHistory()
    const now = 10_000_000_000
    h = recordVisit(h, 'https://old.com', 'Old', now - 100 * 86_400_000)
    h = recordVisit(h, 'https://new.com', 'New', now - 1000)
    const pruned = pruneHistory(h, 90, now)
    expect(pruned.entries.map((e) => e.title)).toEqual(['New'])
  })
})
