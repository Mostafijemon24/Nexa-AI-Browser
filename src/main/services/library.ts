import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeProfileId } from '../../platform/types'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import {
  BOOKMARKS_VERSION,
  COLLECTIONS_VERSION,
  HISTORY_VERSION,
  ROOT_IDS,
  ROOT_OTHER,
  emptyHistory,
  newId,
  normalizeBookmarks,
  normalizeCollections,
  normalizeHistory,
  parseNetscape,
  pruneHistory,
  queryHistory,
  recordVisit,
  serializeNetscape,
  validateBookmarkUrl,
  type BookmarkItem,
  type BookmarkStore,
  type Collection,
  type CollectionStore,
  type HistoryRange,
  type HistoryStore,
  type ImportNode
} from '../../shared/library'

function ensure(cond: unknown, code: string): asserts cond {
  if (!cond) throw new Error(code)
}

export class Library {
  constructor(private persist: Persistence) {}

  private dir(profileId: string): string {
    const id = assertSafeProfileId(profileId)
    const dir = this.persist.profileDir(id)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private bmPath(id: string) {
    return join(this.dir(id), 'bookmarks.json')
  }
  private histPath(id: string) {
    return join(this.dir(id), 'history.json')
  }
  private colPath(id: string) {
    return join(this.dir(id), 'collections.json')
  }

  /* ---------------- Bookmarks ---------------- */

  loadBookmarks(profileId: string): BookmarkStore {
    return normalizeBookmarks(readJsonSafe<unknown>(this.bmPath(profileId), null))
  }

  private saveBookmarks(profileId: string, store: BookmarkStore): BookmarkStore {
    writeJsonAtomic(this.bmPath(profileId), store)
    return store
  }

  private nextIndex(items: BookmarkItem[], parentId: string | null): number {
    return items.filter((i) => i.parentId === parentId).reduce((m, i) => Math.max(m, i.index + 1), 0)
  }

  createBookmark(profileId: string, input: { title: string; url: string; parentId?: string | null }): BookmarkStore {
    const url = validateBookmarkUrl(input.url)
    ensure(url, 'invalid_url')
    const store = this.loadBookmarks(profileId)
    const parentId = this.resolveParent(store, input.parentId)
    const now = Date.now()
    store.items.push({
      id: newId('b'),
      parentId,
      type: 'bookmark',
      title: (input.title || url).slice(0, 500),
      url: url as string,
      createdAt: now,
      updatedAt: now,
      index: this.nextIndex(store.items, parentId)
    })
    return this.saveBookmarks(profileId, store)
  }

  createFolder(profileId: string, input: { title: string; parentId?: string | null }): BookmarkStore {
    const store = this.loadBookmarks(profileId)
    const parentId = this.resolveParent(store, input.parentId)
    const now = Date.now()
    store.items.push({
      id: newId('f'),
      parentId,
      type: 'folder',
      title: (input.title || 'New Folder').slice(0, 500),
      createdAt: now,
      updatedAt: now,
      index: this.nextIndex(store.items, parentId)
    })
    return this.saveBookmarks(profileId, store)
  }

  private resolveParent(store: BookmarkStore, parentId?: string | null): string | null {
    if (parentId === undefined || parentId === null) return ROOT_OTHER
    const p = store.items.find((i) => i.id === parentId && i.type === 'folder')
    ensure(p, 'not_found')
    return parentId
  }

  updateBookmark(profileId: string, input: { id: string; title?: string; url?: string }): BookmarkStore {
    const store = this.loadBookmarks(profileId)
    const item = store.items.find((i) => i.id === input.id)
    ensure(item, 'not_found')
    if (input.title !== undefined) item.title = input.title.slice(0, 500)
    if (input.url !== undefined && item.type === 'bookmark') {
      const url = validateBookmarkUrl(input.url)
      ensure(url, 'invalid_url')
      item.url = url as string
    }
    item.updatedAt = Date.now()
    return this.saveBookmarks(profileId, store)
  }

  deleteBookmark(profileId: string, id: string): BookmarkStore {
    ensure(!ROOT_IDS.includes(id), 'denied')
    const store = this.loadBookmarks(profileId)
    // Collect the node and all descendants.
    const toRemove = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const i of store.items) {
        if (i.parentId && toRemove.has(i.parentId) && !toRemove.has(i.id)) {
          toRemove.add(i.id)
          changed = true
        }
      }
    }
    store.items = store.items.filter((i) => !toRemove.has(i.id))
    return this.saveBookmarks(profileId, store)
  }

  moveBookmark(profileId: string, input: { id: string; parentId: string | null; index?: number }): BookmarkStore {
    ensure(!ROOT_IDS.includes(input.id), 'denied')
    const store = this.loadBookmarks(profileId)
    const item = store.items.find((i) => i.id === input.id)
    ensure(item, 'not_found')
    const parentId = this.resolveParent(store, input.parentId)
    // Prevent moving a folder into itself/its descendant.
    if (item.type === 'folder') {
      let cursor: string | null = parentId
      while (cursor) {
        ensure(cursor !== item.id, 'denied')
        cursor = store.items.find((i) => i.id === cursor)?.parentId ?? null
      }
    }
    item.parentId = parentId
    item.index = input.index ?? this.nextIndex(store.items, parentId)
    item.updatedAt = Date.now()
    this.reindex(store, parentId)
    return this.saveBookmarks(profileId, store)
  }

  reorderBookmark(profileId: string, input: { id: string; index: number }): BookmarkStore {
    const store = this.loadBookmarks(profileId)
    const item = store.items.find((i) => i.id === input.id)
    ensure(item, 'not_found')
    const siblings = store.items
      .filter((i) => i.parentId === item.parentId && i.id !== item.id)
      .sort((a, b) => a.index - b.index)
    const clamped = Math.max(0, Math.min(input.index, siblings.length))
    siblings.splice(clamped, 0, item)
    siblings.forEach((s, idx) => (s.index = idx))
    return this.saveBookmarks(profileId, store)
  }

  private reindex(store: BookmarkStore, parentId: string | null) {
    store.items
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => a.index - b.index)
      .forEach((i, idx) => (i.index = idx))
  }

  exportBookmarks(profileId: string): string {
    return serializeNetscape(this.loadBookmarks(profileId))
  }

  importBookmarks(profileId: string, html: string): { store: BookmarkStore; imported: number } {
    const tree = parseNetscape(html)
    const store = this.loadBookmarks(profileId)
    let imported = 0
    const now = Date.now()
    const insert = (nodes: ImportNode[], parentId: string) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const id = newId('f')
          store.items.push({
            id,
            parentId,
            type: 'folder',
            title: node.title.slice(0, 500),
            createdAt: now,
            updatedAt: now,
            index: this.nextIndex(store.items, parentId)
          })
          insert(node.children, id)
        } else {
          const url = validateBookmarkUrl(node.url)
          if (!url) continue
          store.items.push({
            id: newId('b'),
            parentId,
            type: 'bookmark',
            title: node.title.slice(0, 500),
            url: url as string,
            createdAt: now,
            updatedAt: now,
            index: this.nextIndex(store.items, parentId)
          })
          imported++
        }
      }
    }
    insert(tree, ROOT_OTHER)
    this.saveBookmarks(profileId, store)
    return { store, imported }
  }

  /* ---------------- History ---------------- */

  loadHistory(profileId: string): HistoryStore {
    return normalizeHistory(readJsonSafe<unknown>(this.histPath(profileId), null))
  }

  private saveHistory(profileId: string, store: HistoryStore): HistoryStore {
    writeJsonAtomic(this.histPath(profileId), store)
    return store
  }

  recordVisit(
    profileId: string,
    input: { url: string; title: string; private?: boolean; retentionDays?: number }
  ): HistoryStore {
    // Never record private navigation into the persistent store.
    if (input.private) return this.loadHistory(profileId)
    let store = recordVisit(this.loadHistory(profileId), input.url, input.title)
    store = pruneHistory(store, input.retentionDays ?? 0)
    return this.saveHistory(profileId, store)
  }

  queryHistory(
    profileId: string,
    opts: { search?: string; range?: HistoryRange; limit?: number; offset?: number }
  ) {
    return queryHistory(this.loadHistory(profileId), opts)
  }

  deleteHistory(profileId: string, id: string): HistoryStore {
    const store = this.loadHistory(profileId)
    store.entries = store.entries.filter((e) => e.id !== id)
    return this.saveHistory(profileId, store)
  }

  clearHistory(profileId: string, range: HistoryRange): HistoryStore {
    const store = this.loadHistory(profileId)
    if (range === 'all') {
      return this.saveHistory(profileId, emptyHistory())
    }
    const from = rangeStartLocal(range)
    store.entries = store.entries.filter((e) => e.lastVisitedAt < from)
    return this.saveHistory(profileId, store)
  }

  /* ---------------- Collections ---------------- */

  loadCollections(profileId: string): CollectionStore {
    return normalizeCollections(readJsonSafe<unknown>(this.colPath(profileId), null))
  }

  private saveCollections(profileId: string, store: CollectionStore): CollectionStore {
    writeJsonAtomic(this.colPath(profileId), store)
    return store
  }

  private find(store: CollectionStore, id: string): Collection {
    const c = store.collections.find((x) => x.id === id)
    ensure(c, 'not_found')
    return c
  }

  createCollection(profileId: string, name: string): CollectionStore {
    const store = this.loadCollections(profileId)
    const now = Date.now()
    store.collections.push({
      id: newId('c'),
      name: (name || 'New Collection').slice(0, 200),
      createdAt: now,
      updatedAt: now,
      items: []
    })
    return this.saveCollections(profileId, store)
  }

  renameCollection(profileId: string, id: string, name: string): CollectionStore {
    const store = this.loadCollections(profileId)
    const c = this.find(store, id)
    c.name = (name || c.name).slice(0, 200)
    c.updatedAt = Date.now()
    return this.saveCollections(profileId, store)
  }

  deleteCollection(profileId: string, id: string): CollectionStore {
    const store = this.loadCollections(profileId)
    store.collections = store.collections.filter((c) => c.id !== id)
    return this.saveCollections(profileId, store)
  }

  addCollectionItem(
    profileId: string,
    input: { collectionId: string; title: string; url: string; note?: string }
  ): CollectionStore {
    const url = validateBookmarkUrl(input.url)
    ensure(url, 'invalid_url')
    const store = this.loadCollections(profileId)
    const c = this.find(store, input.collectionId)
    c.items.push({
      id: newId('ci'),
      title: (input.title || url).slice(0, 500),
      url: url as string,
      note: input.note?.slice(0, 2000),
      addedAt: Date.now(),
      index: c.items.reduce((m, i) => Math.max(m, i.index + 1), 0)
    })
    c.updatedAt = Date.now()
    return this.saveCollections(profileId, store)
  }

  removeCollectionItem(profileId: string, input: { collectionId: string; itemId: string }): CollectionStore {
    const store = this.loadCollections(profileId)
    const c = this.find(store, input.collectionId)
    c.items = c.items.filter((i) => i.id !== input.itemId)
    c.items.sort((a, b) => a.index - b.index).forEach((i, idx) => (i.index = idx))
    c.updatedAt = Date.now()
    return this.saveCollections(profileId, store)
  }

  reorderCollectionItem(
    profileId: string,
    input: { collectionId: string; itemId: string; index: number }
  ): CollectionStore {
    const store = this.loadCollections(profileId)
    const c = this.find(store, input.collectionId)
    const item = c.items.find((i) => i.id === input.itemId)
    ensure(item, 'not_found')
    const rest = c.items.filter((i) => i.id !== item.id).sort((a, b) => a.index - b.index)
    const clamped = Math.max(0, Math.min(input.index, rest.length))
    rest.splice(clamped, 0, item)
    rest.forEach((i, idx) => (i.index = idx))
    c.items = rest
    c.updatedAt = Date.now()
    return this.saveCollections(profileId, store)
  }
}

function rangeStartLocal(range: HistoryRange, now = Date.now()): number {
  switch (range) {
    case 'hour':
      return now - 3600_000
    case 'day':
      return now - 86_400_000
    case 'week':
      return now - 7 * 86_400_000
    case 'month':
      return now - 30 * 86_400_000
    default:
      return 0
  }
}

export const LIBRARY_VERSIONS = { BOOKMARKS_VERSION, HISTORY_VERSION, COLLECTIONS_VERSION }
