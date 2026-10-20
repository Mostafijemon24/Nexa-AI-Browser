import { z } from 'zod'

export const DOWNLOADS_VERSION = 1

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DuplicatePolicy = 'rename' | 'replace'

export interface DownloadItem {
  id: string
  profileId: string
  url: string
  filename: string
  mimeType?: string
  totalBytes?: number
  receivedBytes: number
  status: DownloadStatus
  savePath?: string
  destinationDir?: string
  startedAt?: number
  completedAt?: number
  errorCode?: string
  errorMessage?: string
  speedBytesPerSecond?: number
  etaSeconds?: number
  retryCount: number
  createdAt: number
  updatedAt: number
  private?: boolean
}

export interface DownloadStore {
  version: number
  items: DownloadItem[]
}

export interface DownloadSettings {
  askLocation: boolean
  duplicatePolicy: DuplicatePolicy
  maxConcurrent: number
  retryLimit: number
}

export function defaultDownloadSettings(): DownloadSettings {
  return { askLocation: false, duplicatePolicy: 'rename', maxConcurrent: 4, retryLimit: 3 }
}

export const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10]

/* ------------------------------------------------------------------ *
 * Persistence schema
 * ------------------------------------------------------------------ */

export const downloadItemSchema = z.object({
  id: z.string().min(1).max(80),
  profileId: z.string().min(1).max(64),
  url: z.string().max(8000),
  filename: z.string().max(512),
  mimeType: z.string().max(200).optional(),
  totalBytes: z.number().optional(),
  receivedBytes: z.number(),
  status: z.enum(['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled']),
  savePath: z.string().max(4096).optional(),
  destinationDir: z.string().max(4096).optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  errorCode: z.string().max(120).optional(),
  errorMessage: z.string().max(400).optional(),
  speedBytesPerSecond: z.number().optional(),
  etaSeconds: z.number().optional(),
  retryCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  private: z.boolean().optional()
})

export const downloadStoreSchema = z.object({
  version: z.number(),
  items: z.array(downloadItemSchema)
})

export function emptyDownloads(): DownloadStore {
  return { version: DOWNLOADS_VERSION, items: [] }
}

export function normalizeDownloads(raw: unknown): DownloadStore {
  const parsed = downloadStoreSchema.safeParse(raw)
  if (!parsed.success) return emptyDownloads()
  return { version: DOWNLOADS_VERSION, items: parsed.data.items }
}

/**
 * Restart recovery: DownloadItem objects don't survive a process restart and
 * Chromium can't resume them across launches. Non-terminal items become
 * retryable `failed` (interrupted). Terminal states are preserved.
 */
export function recoverStore(store: DownloadStore, now = Date.now()): DownloadStore {
  const items = store.items.map((it) => {
    if (it.status === 'downloading' || it.status === 'queued' || it.status === 'paused') {
      return {
        ...it,
        status: 'failed' as DownloadStatus,
        errorCode: 'interrupted',
        errorMessage: 'Interrupted — retry to restart the download',
        speedBytesPerSecond: undefined,
        etaSeconds: undefined,
        updatedAt: now
      }
    }
    return it
  })
  return { version: DOWNLOADS_VERSION, items }
}

/* ------------------------------------------------------------------ *
 * Filename sanitization + duplicate handling (pure)
 * ------------------------------------------------------------------ */

const RESERVED_WIN = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
])

/** True if the name attempts path traversal or contains separators. */
export function hasTraversal(name: string): boolean {
  return name.includes('/') || name.includes('\\') || name === '..' || name === '.'
}

/**
 * Produce a safe filesystem filename from an untrusted server-provided name.
 * Strips separators, control/invalid chars, trims dots/spaces, guards reserved
 * Windows names, caps length while preserving the extension, and never returns
 * empty.
 */
export function sanitizeFilename(input: string): string {
  let name = (input || '').trim()
  // Drop any path components a server may have injected.
  name = name.split(/[/\\]/).pop() || ''
  // Remove invalid filesystem characters and control chars.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
  // Collapse whitespace.
  name = name.replace(/\s+/g, ' ').trim()
  // Strip leading/trailing dots and spaces (Windows-hostile).
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!name) name = 'download'

  // Split extension for reserved-name + length handling.
  const dot = name.lastIndexOf('.')
  let base = dot > 0 ? name.slice(0, dot) : name
  let ext = dot > 0 ? name.slice(dot) : ''
  if (ext.length > 24) {
    // Absurdly long "extension" — treat as no extension.
    base = name
    ext = ''
  }
  if (RESERVED_WIN.has(base.toUpperCase())) base = '_' + base
  // Cap total length to a filesystem-safe bound.
  const maxBase = 255 - ext.length
  if (base.length > maxBase) base = base.slice(0, Math.max(1, maxBase))
  const out = base + ext
  return out || 'download'
}

/**
 * Given the filenames already present in a directory, return a unique filename
 * per the policy. `replace` keeps the name; `rename` appends " (n)" before the
 * extension. Pure — the caller supplies the existing set.
 */
export function uniqueFilename(existing: Iterable<string>, filename: string, policy: DuplicatePolicy): string {
  const set = new Set(Array.from(existing))
  if (policy === 'replace' || !set.has(filename)) return filename
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let n = 1
  let candidate = `${base} (${n})${ext}`
  while (set.has(candidate)) {
    n++
    candidate = `${base} (${n})${ext}`
  }
  return candidate
}

/* ------------------------------------------------------------------ *
 * Speed / ETA (pure)
 * ------------------------------------------------------------------ */

export interface Sample {
  t: number
  bytes: number
}

/** Rolling-window average speed (bytes/sec). Smooths instantaneous spikes. */
export function computeSpeed(samples: Sample[], windowMs = 3000): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const cutoff = last.t - windowMs
  // Oldest sample within the window (or the first sample).
  let first = samples[0]
  for (const s of samples) {
    if (s.t >= cutoff) {
      first = s
      break
    }
  }
  const dt = (last.t - first.t) / 1000
  const db = last.bytes - first.bytes
  if (dt <= 0 || db < 0) return 0
  return db / dt
}

/** ETA in seconds, only when total is known and speed is meaningful. */
export function computeEta(totalBytes: number | undefined, receivedBytes: number, speed: number): number | undefined {
  if (!totalBytes || totalBytes <= 0) return undefined
  if (speed <= 0) return undefined
  const remaining = totalBytes - receivedBytes
  if (remaining <= 0) return 0
  return remaining / speed
}

/* ------------------------------------------------------------------ *
 * Queue scheduling / concurrency (pure)
 * ------------------------------------------------------------------ */

export function activeCount(items: DownloadItem[]): number {
  return items.filter((i) => i.status === 'downloading').length
}

/**
 * Given the current items and a concurrency limit, return the IDs of queued
 * items that should be promoted to active (oldest first), respecting the
 * number of free slots.
 */
export function scheduleQueue(items: DownloadItem[], maxConcurrent: number): string[] {
  const free = Math.max(0, maxConcurrent - activeCount(items))
  if (free === 0) return []
  return items
    .filter((i) => i.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, free)
    .map((i) => i.id)
}

export function canRetry(item: DownloadItem, retryLimit: number): boolean {
  if (item.status !== 'failed' && item.status !== 'cancelled') return false
  return item.retryCount < retryLimit
}

export function isActive(status: DownloadStatus): boolean {
  return status === 'downloading' || status === 'paused' || status === 'queued'
}

export function isTerminal(status: DownloadStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export interface DownloadSummary {
  active: number
  queued: number
  paused: number
  completed: number
  failed: number
  total: number
}

export function summarize(items: DownloadItem[]): DownloadSummary {
  const s: DownloadSummary = { active: 0, queued: 0, paused: 0, completed: 0, failed: 0, total: items.length }
  for (const i of items) {
    if (i.status === 'downloading') s.active++
    else if (i.status === 'queued') s.queued++
    else if (i.status === 'paused') s.paused++
    else if (i.status === 'completed') s.completed++
    else if (i.status === 'failed' || i.status === 'cancelled') s.failed++
  }
  return s
}

/** Strip obvious secrets from a URL for safe logging (never persisted/logged raw). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    const secretKeys = [/token/i, /signature/i, /access_token/i, /^x-amz-/i, /sig$/i, /key$/i, /password/i]
    for (const k of Array.from(u.searchParams.keys())) {
      if (secretKeys.some((re) => re.test(k))) u.searchParams.set(k, '…')
    }
    return u.origin + u.pathname + (u.search ? u.search : '')
  } catch {
    return '[unparseable-url]'
  }
}

export function newDownloadId(now = Date.now()): string {
  return 'd' + now.toString(36) + Math.random().toString(36).slice(2, 8)
}

/* ---- IPC payload schemas ---- */
export const downloadSettingsSchema = z.object({
  askLocation: z.boolean(),
  duplicatePolicy: z.enum(['rename', 'replace']),
  maxConcurrent: z.number().int().min(1).max(10),
  retryLimit: z.number().int().min(0).max(20)
})
