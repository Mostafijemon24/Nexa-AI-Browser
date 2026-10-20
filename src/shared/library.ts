import { z } from 'zod'

/* ------------------------------------------------------------------ *
 * Bookmarks
 * ------------------------------------------------------------------ */

export const BOOKMARKS_VERSION = 1
export const HISTORY_VERSION = 1
export const COLLECTIONS_VERSION = 1

export const ROOT_BAR = 'bar'
export const ROOT_OTHER = 'other'
export const ROOT_IDS = [ROOT_BAR, ROOT_OTHER]

export interface BookmarkItem {
  id: string
  parentId: string | null
  type: 'bookmark' | 'folder'
  title: string
  url?: string
  createdAt: number
  updatedAt: number
  index: number
}

export interface BookmarkStore {
  version: number
  items: BookmarkItem[]
}

export const bookmarkItemSchema = z.object({
  id: z.string().min(1).max(80),
  parentId: z.string().min(1).max(80).nullable(),
  type: z.enum(['bookmark', 'folder']),
  title: z.string().max(500),
  url: z.string().max(4000).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  index: z.number()
})

export const bookmarkStoreSchema = z.object({
  version: z.number(),
  items: z.array(bookmarkItemSchema)
})

export function emptyBookmarks(): BookmarkStore {
  const now = Date.now()
  return {
    version: BOOKMARKS_VERSION,
    items: [
      { id: ROOT_BAR, parentId: null, type: 'folder', title: 'Bookmark Bar', createdAt: now, updatedAt: now, index: 0 },
      { id: ROOT_OTHER, parentId: null, type: 'folder', title: 'Other Bookmarks', createdAt: now, updatedAt: now, index: 1 }
    ]
  }
}

/** Ensure the mandatory root folders exist; keep any valid saved items. */
export function normalizeBookmarks(raw: unknown): BookmarkStore {
  const parsed = bookmarkStoreSchema.safeParse(raw)
  const base = emptyBookmarks()
  if (!parsed.success) return base
  const items = parsed.data.items.filter((i) => {
    if (i.type === 'bookmark') return typeof i.url === 'string' && !!validateBookmarkUrl(i.url)
    return true
  })
  // Guarantee roots.
  for (const root of base.items) {
    if (!items.some((i) => i.id === root.id)) items.push(root)
  }
  return { version: BOOKMARKS_VERSION, items }
}

/**
 * Validate and normalize a bookmark URL. Only http(s) is permitted so that a
 * click can never hand a dangerous scheme (javascript:, file:, data:) to the
 * navigation layer. Returns the normalized URL or null when unsafe.
 */
export function validateBookmarkUrl(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw) return null
  let candidate = raw
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = 'https://' + candidate
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  return u.toString()
}

/* ---- Netscape bookmark HTML (safe, non-executing) ---- */

export type ImportNode =
  | { type: 'folder'; title: string; children: ImportNode[] }
  | { type: 'bookmark'; title: string; url: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function encodeEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Parse a Netscape bookmark file into a tree WITHOUT executing any content.
 * Purely tokenizes <DL>, </DL>, <H3>, <A HREF>. Malformed nesting is tolerated
 * and never throws.
 */
export function parseNetscape(html: string): ImportNode[] {
  const roots: ImportNode[] = []
  const levels: ImportNode[][] = [roots]
  let pendingFolder: Extract<ImportNode, { type: 'folder' }> | null = null

  const tokenRe = /<dl[^>]*>|<\/dl>|<h3[^>]*>([\s\S]*?)<\/h3>|<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = tokenRe.exec(html)) && guard++ < 100000) {
    const tag = m[0].toLowerCase()
    const top = levels[levels.length - 1]
    if (tag.startsWith('<dl')) {
      levels.push(pendingFolder ? pendingFolder.children : top)
      pendingFolder = null
    } else if (tag === '</dl>') {
      if (levels.length > 1) levels.pop()
      pendingFolder = null
    } else if (tag.startsWith('<h3')) {
      const folder: Extract<ImportNode, { type: 'folder' }> = {
        type: 'folder',
        title: decodeEntities(m[1] || 'Folder').trim() || 'Folder',
        children: []
      }
      top.push(folder)
      pendingFolder = folder
    } else if (tag.startsWith('<a')) {
      const url = validateBookmarkUrl(decodeEntities(m[2] || ''))
      if (url) {
        top.push({ type: 'bookmark', title: decodeEntities(m[3] || url).trim() || url, url })
        pendingFolder = null
      }
    }
  }
  return roots
}

function buildTree(items: BookmarkItem[], parentId: string | null): BookmarkItem[] {
  return items
    .filter((i) => i.parentId === parentId)
    .sort((a, b) => a.index - b.index)
}

/** Serialize a bookmark store to Netscape HTML (real, importable data). */
export function serializeNetscape(store: BookmarkStore): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ]
  const walk = (parentId: string | null, depth: number) => {
    const pad = '    '.repeat(depth)
    for (const node of buildTree(store.items, parentId)) {
      if (node.type === 'folder') {
        lines.push(`${pad}<DT><H3>${encodeEntities(node.title)}</H3>`)
        lines.push(`${pad}<DL><p>`)
        walk(node.id, depth + 1)
        lines.push(`${pad}</DL><p>`)
      } else if (node.url) {
        lines.push(`${pad}<DT><A HREF="${encodeEntities(node.url)}">${encodeEntities(node.title)}</A>`)
      }
    }
  }
  walk(null, 1)
  lines.push('</DL><p>')
  return lines.join('\n') + '\n'
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitCount: number
  firstVisitedAt: number
  lastVisitedAt: number
}

export interface HistoryStore {
  version: number
  entries: HistoryEntry[]
}

export const historyEntrySchema = z.object({
  id: z.string().min(1).max(80),
  url: z.string().max(4000),
  title: z.string().max(500),
  visitCount: z.number(),
  firstVisitedAt: z.number(),
  lastVisitedAt: z.number()
})

export const historyStoreSchema = z.object({
  version: z.number(),
  entries: z.array(historyEntrySchema)
})

export function emptyHistory(): HistoryStore {
  return { version: HISTORY_VERSION, entries: [] }
}

export function normalizeHistory(raw: unknown): HistoryStore {
  const parsed = historyStoreSchema.safeParse(raw)
  if (!parsed.success) return emptyHistory()
  return { version: HISTORY_VERSION, entries: parsed.data.entries }
}

export type HistoryRange = 'hour' | 'day' | 'week' | 'month' | 'all'

export function rangeStart(range: HistoryRange, now = Date.now()): number {
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

export function queryHistory(
  store: HistoryStore,
  opts: { search?: string; range?: HistoryRange; limit?: number; offset?: number; now?: number } = {}
): HistoryEntry[] {
  const now = opts.now ?? Date.now()
  const q = (opts.search || '').trim().toLowerCase()
  const from = rangeStart(opts.range || 'all', now)
  let rows = store.entries.filter((e) => e.lastVisitedAt >= from)
  if (q) rows = rows.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
  rows = rows.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? 500
  return rows.slice(offset, offset + limit)
}

/** Record a visit (dedupe by URL, increment count). Pure — returns new store. */
export function recordVisit(store: HistoryStore, url: string, title: string, now = Date.now()): HistoryStore {
  const safe = validateBookmarkUrl(url)
  if (!safe) return store
  const entries = store.entries.slice()
  const idx = entries.findIndex((e) => e.url === safe)
  if (idx >= 0) {
    const e = entries[idx]
    entries[idx] = { ...e, title: title || e.title, visitCount: e.visitCount + 1, lastVisitedAt: now }
  } else {
    entries.push({
      id: 'h' + now.toString(36) + Math.random().toString(36).slice(2, 8),
      url: safe,
      title: title || safe,
      visitCount: 1,
      firstVisitedAt: now,
      lastVisitedAt: now
    })
  }
  return { version: HISTORY_VERSION, entries }
}

/** Drop entries older than the retention window (0 = keep forever). */
export function pruneHistory(store: HistoryStore, retentionDays: number, now = Date.now()): HistoryStore {
  if (!retentionDays || retentionDays <= 0) return store
  const cutoff = now - retentionDays * 86_400_000
  return { version: HISTORY_VERSION, entries: store.entries.filter((e) => e.lastVisitedAt >= cutoff) }
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

export interface CollectionItem {
  id: string
  title: string
  url: string
  note?: string
  addedAt: number
  index: number
}

export interface Collection {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  items: CollectionItem[]
}

export interface CollectionStore {
  version: number
  collections: Collection[]
}

export const collectionItemSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(500),
  url: z.string().max(4000),
  note: z.string().max(2000).optional(),
  addedAt: z.number(),
  index: z.number()
})

export const collectionSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(200),
  createdAt: z.number(),
  updatedAt: z.number(),
  items: z.array(collectionItemSchema)
})

export const collectionStoreSchema = z.object({
  version: z.number(),
  collections: z.array(collectionSchema)
})

export function emptyCollections(): CollectionStore {
  return { version: COLLECTIONS_VERSION, collections: [] }
}

export function normalizeCollections(raw: unknown): CollectionStore {
  const parsed = collectionStoreSchema.safeParse(raw)
  if (!parsed.success) return emptyCollections()
  return { version: COLLECTIONS_VERSION, collections: parsed.data.collections }
}

/* ---- id helper ---- */
export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
