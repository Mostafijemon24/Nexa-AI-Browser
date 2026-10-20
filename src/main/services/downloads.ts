import { session as electronSession, shell, type Session, type DownloadItem as EItem } from 'electron'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { assertSafeProfileId } from '../../platform/types'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import {
  DOWNLOADS_VERSION,
  activeCount,
  computeEta,
  computeSpeed,
  defaultDownloadSettings,
  isActive,
  newDownloadId,
  normalizeDownloads,
  recoverStore,
  sanitizeFilename,
  scheduleQueue,
  uniqueFilename,
  type DownloadItem,
  type DownloadSettings,
  type Sample
} from '../../shared/downloads'

function ensure(cond: unknown, code: string): asserts cond {
  if (!cond) throw new Error(code)
}

interface Live {
  item: EItem
  samples: Sample[]
  queued: boolean
  canceling: boolean
}

export interface DownloadEmitter {
  (event: { type: 'update' | 'removed' | 'list'; profileId: string; item?: DownloadItem; id?: string; items?: DownloadItem[] }): void
}

const PARTITION_PERSIST = (id: string) => `persist:nexa-${id}`
const PARTITION_PRIVATE = (id: string) => `nexa-private-${id}`

export class DownloadService {
  private data = new Map<string, DownloadItem[]>()
  private recovered = new Set<string>()
  private live = new Map<string, Live>()
  private lastEmit = new Map<string, number>()
  private attached = new Set<string>()
  /** url -> pending programmatic (retry) descriptor. */
  private pending = new Map<string, { id: string; savePath: string; profileId: string; isPrivate: boolean }>()
  private emit: DownloadEmitter

  constructor(
    private persist: Persistence,
    private notify: (title: string, body: string) => void,
    emit: DownloadEmitter
  ) {
    this.emit = emit
  }

  /* -------------------- persistence -------------------- */

  private path(profileId: string) {
    const dir = this.persist.profileDir(assertSafeProfileId(profileId))
    mkdirSync(dir, { recursive: true })
    return join(dir, 'downloads.json')
  }

  private ensureLoaded(profileId: string): DownloadItem[] {
    assertSafeProfileId(profileId)
    let items = this.data.get(profileId)
    if (items) return items
    let store = normalizeDownloads(readJsonSafe<unknown>(this.path(profileId), null))
    if (!this.recovered.has(profileId)) {
      store = recoverStore(store)
      this.recovered.add(profileId)
      writeJsonAtomic(this.path(profileId), { version: DOWNLOADS_VERSION, items: store.items.filter((i) => !i.private) })
    }
    items = store.items
    this.data.set(profileId, items)
    return items
  }

  private persistProfile(profileId: string) {
    const items = (this.data.get(profileId) || []).filter((i) => !i.private)
    writeJsonAtomic(this.path(profileId), { version: DOWNLOADS_VERSION, items })
  }

  private getSettings(profileId: string): DownloadSettings {
    try {
      const prefs = this.persist.loadProfilePrefs(profileId)
      return { ...defaultDownloadSettings(), ...(prefs.downloads || {}) }
    } catch {
      return defaultDownloadSettings()
    }
  }

  private destinationDir(profileId: string): string {
    let dir: string
    try {
      const prefs = this.persist.loadProfilePrefs(profileId)
      const folder = prefs.sv?.dlFolder
      dir = folder && folder !== 'Downloads' && isAbsolute(folder) ? folder : this.persist.downloadsDir()
    } catch {
      dir = this.persist.downloadsDir()
    }
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /* -------------------- session attachment -------------------- */

  attachForProfiles(profileIds: string[]) {
    for (const id of profileIds) {
      try {
        assertSafeProfileId(id)
      } catch {
        continue
      }
      this.attach(electronSession.fromPartition(PARTITION_PERSIST(id)), id, false)
      this.attach(electronSession.fromPartition(PARTITION_PRIVATE(id)), id, true)
      // Load persisted (+ recover) so lists are ready and events flow.
      this.ensureLoaded(id)
    }
  }

  private attach(sess: Session, profileId: string, isPrivate: boolean) {
    const key = `${profileId}:${isPrivate ? 'p' : 'n'}`
    if (this.attached.has(key)) return
    this.attached.add(key)
    sess.on('will-download', (_e, item) => this.handleWillDownload(item, profileId, isPrivate))
  }

  /* -------------------- detection -------------------- */

  private handleWillDownload(item: EItem, profileId: string, isPrivate: boolean) {
    const url = item.getURL()
    const pending = this.pending.get(url)
    let record: DownloadItem
    const now = Date.now()
    const items = this.ensureLoaded(profileId)

    let forcedActive = false
    if (pending && pending.profileId === profileId) {
      // Retry / programmatic start: reuse the existing record + destination.
      this.pending.delete(url)
      const existing = items.find((i) => i.id === pending.id)
      try {
        item.setSavePath(pending.savePath)
      } catch {
        /* ignore */
      }
      record =
        existing ||
        this.blank(pending.id, profileId, url, sanitizeFilename(basename(pending.savePath)), isPrivate, now)
      record.savePath = pending.savePath
      record.destinationDir = dirname(pending.savePath)
      forcedActive = true
    } else {
      const settings = this.getSettings(profileId)
      const rawName = item.getFilename() || 'download'
      const filename = sanitizeFilename(rawName)
      record = this.blank(newDownloadId(now), profileId, url, filename, isPrivate, now)
      record.mimeType = item.getMimeType() || undefined
      if (!settings.askLocation) {
        const dir = this.destinationDir(profileId)
        const finalName = this.resolveUniqueName(dir, filename, settings.duplicatePolicy, profileId)
        const savePath = resolve(dir, finalName)
        // Path-traversal guard: the resolved path must stay inside dir.
        if (dirname(savePath) !== resolve(dir)) {
          item.cancel()
          return
        }
        record.filename = finalName
        record.savePath = savePath
        record.destinationDir = dir
        item.setSavePath(savePath)
      }
      // askLocation: leave Electron to show its native save dialog.
    }

    const total = item.getTotalBytes()
    record.totalBytes = total > 0 ? total : undefined
    record.startedAt = now
    record.receivedBytes = item.getReceivedBytes()

    // Concurrency: pause + queue when no free slot (unless this is a retry the user asked for).
    const settings = this.getSettings(profileId)
    const running = activeCount(items.filter((i) => i.id !== record.id))
    const queued = !forcedActive && running >= settings.maxConcurrent
    const liveEntry: Live = { item, samples: [{ t: now, bytes: record.receivedBytes }], queued, canceling: false }
    this.live.set(record.id, liveEntry)

    if (queued) {
      record.status = 'queued'
      try {
        item.pause()
      } catch {
        /* some items cannot pause pre-start; leave downloading */
        record.status = 'downloading'
        liveEntry.queued = false
      }
    } else {
      record.status = 'downloading'
    }

    // Upsert record.
    const idx = items.findIndex((i) => i.id === record.id)
    if (idx >= 0) items[idx] = record
    else items.unshift(record)
    if (!record.private) this.persistProfile(profileId)
    this.pushUpdate(profileId, record)

    item.on('updated', (_ev, state) => this.onUpdated(profileId, record.id, state))
    item.on('done', (_ev, state) => this.onDone(profileId, record.id, state))
  }

  private blank(id: string, profileId: string, url: string, filename: string, isPrivate: boolean, now: number): DownloadItem {
    return {
      id,
      profileId,
      url,
      filename,
      receivedBytes: 0,
      status: 'queued',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      private: isPrivate || undefined
    }
  }

  private resolveUniqueName(dir: string, filename: string, policy: 'rename' | 'replace', profileId: string): string {
    const onDisk = existsSync(dir) ? readdirSync(dir) : []
    // Also avoid clashing with in-flight downloads targeting the same dir.
    const inFlight = (this.data.get(profileId) || [])
      .filter((i) => i.destinationDir && resolve(i.destinationDir) === resolve(dir) && isActive(i.status) && i.savePath)
      .map((i) => basename(i.savePath as string))
    return uniqueFilename([...onDisk, ...inFlight], filename, policy)
  }

  /* -------------------- live events -------------------- */

  private onUpdated(profileId: string, id: string, state: 'progressing' | 'interrupted') {
    const live = this.live.get(id)
    const rec = this.find(profileId, id)
    if (!live || !rec) return
    const now = Date.now()
    rec.receivedBytes = live.item.getReceivedBytes()
    const total = live.item.getTotalBytes()
    if (total > 0) rec.totalBytes = total
    live.samples.push({ t: now, bytes: rec.receivedBytes })
    if (live.samples.length > 40) live.samples.shift()

    if (state === 'interrupted') {
      rec.status = live.item.canResume() ? 'paused' : rec.status
      rec.speedBytesPerSecond = undefined
      rec.etaSeconds = undefined
    } else if (live.item.isPaused()) {
      rec.status = live.queued ? 'queued' : 'paused'
      rec.speedBytesPerSecond = 0
      rec.etaSeconds = undefined
    } else {
      rec.status = 'downloading'
      const speed = computeSpeed(live.samples)
      rec.speedBytesPerSecond = speed
      rec.etaSeconds = computeEta(rec.totalBytes, rec.receivedBytes, speed)
    }
    rec.updatedAt = now
    this.throttledUpdate(profileId, rec)
  }

  private onDone(profileId: string, id: string, state: 'completed' | 'cancelled' | 'interrupted') {
    const live = this.live.get(id)
    const rec = this.find(profileId, id)
    this.live.delete(id)
    this.lastEmit.delete(id)
    if (!rec) return
    const now = Date.now()
    rec.speedBytesPerSecond = undefined
    rec.etaSeconds = undefined
    rec.updatedAt = now
    if (live) {
      const rb = live.item.getReceivedBytes()
      if (rb > rec.receivedBytes) rec.receivedBytes = rb
    }
    if (state === 'completed') {
      rec.savePath = live?.item.getSavePath() || rec.savePath
      if (rec.savePath) {
        rec.filename = basename(rec.savePath)
        rec.destinationDir = dirname(rec.savePath)
      }
      // Only mark completed if the file actually exists.
      if (rec.savePath && existsSync(rec.savePath)) {
        rec.status = 'completed'
        rec.completedAt = now
        if (rec.totalBytes === undefined) rec.totalBytes = rec.receivedBytes
        if (!rec.private) this.notify('Download complete', rec.filename)
      } else {
        rec.status = 'failed'
        rec.errorCode = 'file_missing'
        rec.errorMessage = 'The downloaded file could not be found'
        if (!rec.private) this.notify('Download failed', rec.filename)
      }
    } else if (state === 'cancelled') {
      rec.status = 'cancelled'
    } else {
      rec.status = 'failed'
      rec.errorCode = 'interrupted'
      rec.errorMessage = 'The download was interrupted'
      if (!rec.private) this.notify('Download failed', rec.filename)
    }
    if (!rec.private) this.persistProfile(profileId)
    this.pushUpdate(profileId, rec)
    // A slot freed — promote the next queued item.
    this.pump(profileId)
  }

  /** Promote queued items into free concurrency slots. */
  private pump(profileId: string) {
    const items = this.ensureLoaded(profileId)
    const settings = this.getSettings(profileId)
    const toStart = scheduleQueue(items, settings.maxConcurrent)
    for (const id of toStart) {
      const live = this.live.get(id)
      const rec = items.find((i) => i.id === id)
      if (!rec) continue
      if (live && live.item.canResume()) {
        live.queued = false
        try {
          live.item.resume()
          rec.status = 'downloading'
        } catch {
          rec.status = 'failed'
          rec.errorCode = 'resume_failed'
          rec.errorMessage = 'Could not start the queued download'
        }
      } else if (live) {
        // Cannot resume a paused-pre-start item: restart it via a fresh request.
        live.queued = false
        this.restart(rec)
      }
      this.pushUpdate(profileId, rec)
    }
    if (toStart.length && !items.every((i) => i.private)) this.persistProfile(profileId)
  }

  /* -------------------- commands -------------------- */

  list(profileId: string): DownloadItem[] {
    return this.ensureLoaded(profileId).slice()
  }

  get(profileId: string, id: string): DownloadItem | undefined {
    return this.find(profileId, id)
  }

  private find(profileId: string, id: string): DownloadItem | undefined {
    return this.ensureLoaded(profileId).find((i) => i.id === id)
  }

  pause(profileId: string, id: string) {
    const live = this.live.get(id)
    const rec = this.find(profileId, id)
    ensure(rec, 'not_found')
    if (live && !live.item.isPaused()) live.item.pause()
    if (live) live.queued = false
    rec!.status = 'paused'
    rec!.speedBytesPerSecond = 0
    rec!.etaSeconds = undefined
    rec!.updatedAt = Date.now()
    if (!rec!.private) this.persistProfile(profileId)
    this.pushUpdate(profileId, rec!)
    return rec!
  }

  resume(profileId: string, id: string) {
    const live = this.live.get(id)
    const rec = this.find(profileId, id)
    ensure(rec, 'not_found')
    if (live && live.item.canResume()) {
      live.item.resume()
      rec!.status = 'downloading'
      rec!.updatedAt = Date.now()
      if (!rec!.private) this.persistProfile(profileId)
      this.pushUpdate(profileId, rec!)
    } else {
      // Underlying transfer can't resume — restart it honestly.
      this.restart(rec!)
    }
    return rec!
  }

  cancel(profileId: string, id: string) {
    const live = this.live.get(id)
    const rec = this.find(profileId, id)
    ensure(rec, 'not_found')
    if (live) {
      live.canceling = true
      try {
        live.item.cancel()
      } catch {
        /* ignore */
      }
    }
    rec!.status = 'cancelled'
    rec!.speedBytesPerSecond = undefined
    rec!.etaSeconds = undefined
    rec!.updatedAt = Date.now()
    if (!rec!.private) this.persistProfile(profileId)
    this.pushUpdate(profileId, rec!)
    this.pump(profileId)
    return rec!
  }

  retry(profileId: string, id: string) {
    const rec = this.find(profileId, id)
    ensure(rec, 'not_found')
    const settings = this.getSettings(profileId)
    ensure(rec!.retryCount < settings.retryLimit, 'retry_limit')
    rec!.retryCount += 1
    rec!.receivedBytes = 0
    rec!.errorCode = undefined
    rec!.errorMessage = undefined
    rec!.status = 'queued'
    rec!.updatedAt = Date.now()
    if (!rec!.private) this.persistProfile(profileId)
    this.pushUpdate(profileId, rec!)
    this.restart(rec!)
    return rec!
  }

  /** Re-initiate a transfer via the profile's session, reusing the destination. */
  private restart(rec: DownloadItem) {
    const dir = rec.destinationDir || this.destinationDir(rec.profileId)
    mkdirSync(dir, { recursive: true })
    // Re-sanitize the persisted name and re-apply the traversal guard: values
    // loaded from downloads.json are untrusted (a tampered file could carry
    // `../` or an absolute path that the retry path would otherwise honor).
    const safeName = sanitizeFilename(rec.filename || 'download')
    const savePath = rec.savePath && resolve(dirname(rec.savePath)) === resolve(dir) ? rec.savePath : resolve(dir, safeName)
    if (dirname(savePath) !== resolve(dir)) {
      rec.status = 'failed'
      rec.errorCode = 'restart_failed'
      rec.errorMessage = 'Invalid download destination'
      this.pushUpdate(rec.profileId, rec)
      return
    }
    this.pending.set(rec.url, { id: rec.id, savePath, profileId: rec.profileId, isPrivate: !!rec.private })
    const part = rec.private ? PARTITION_PRIVATE(rec.profileId) : PARTITION_PERSIST(rec.profileId)
    try {
      electronSession.fromPartition(part).downloadURL(rec.url)
    } catch {
      this.pending.delete(rec.url)
      rec.status = 'failed'
      rec.errorCode = 'restart_failed'
      rec.errorMessage = 'Could not start the download'
      this.pushUpdate(rec.profileId, rec)
    }
  }

  /**
   * Provider handoff (e.g. Google Drive) into the EXISTING P2 pipeline. This is
   * NOT a second download engine: it registers a pending record and starts the
   * transfer through the profile session's `downloadURL`, so progress, pause/
   * resume/cancel/retry, concurrency, destination, sanitization and the Downloads
   * UI are all owned by P2. Optional `headers` (e.g. an Authorization bearer for a
   * Drive `alt=media`/export request) are attached in MAIN only, never persisted,
   * never returned to the renderer. Destination + filename go through the same P2
   * safety (sanitizeFilename + uniqueFilename + traversal guard).
   */
  enqueueUrl(args: {
    profileId: string
    url: string
    filename: string
    isPrivate?: boolean
    headers?: Record<string, string>
  }): { id: string } {
    assertSafeProfileId(args.profileId)
    const now = Date.now()
    const id = newDownloadId(now)
    const settings = this.getSettings(args.profileId)
    const dir = this.destinationDir(args.profileId)
    const safeName = this.resolveUniqueName(
      dir,
      sanitizeFilename(args.filename || 'download'),
      settings.duplicatePolicy,
      args.profileId
    )
    const savePath = resolve(dir, safeName)
    // Path-traversal guard: the resolved path must stay inside the download dir.
    if (dirname(savePath) !== resolve(dir)) throw new Error('unsafe_path')
    this.pending.set(args.url, { id, savePath, profileId: args.profileId, isPrivate: !!args.isPrivate })
    const part = args.isPrivate ? PARTITION_PRIVATE(args.profileId) : PARTITION_PERSIST(args.profileId)
    try {
      const sess = electronSession.fromPartition(part)
      sess.downloadURL(args.url, args.headers ? { headers: args.headers } : undefined)
    } catch {
      this.pending.delete(args.url)
      throw new Error('download_start_failed')
    }
    return { id }
  }

  remove(profileId: string, id: string) {
    const items = this.ensureLoaded(profileId)
    const rec = items.find((i) => i.id === id)
    ensure(rec, 'not_found')
    const live = this.live.get(id)
    if (live && isActive(rec!.status)) {
      live.canceling = true
      try {
        live.item.cancel()
      } catch {
        /* ignore */
      }
      this.live.delete(id)
    }
    // Removing from the list never deletes the downloaded file.
    this.data.set(profileId, items.filter((i) => i.id !== id))
    if (!rec!.private) this.persistProfile(profileId)
    this.emit({ type: 'removed', profileId, id })
    this.pump(profileId)
    return true
  }

  clear(profileId: string, which: 'completed' | 'failed') {
    const items = this.ensureLoaded(profileId)
    const keep = items.filter((i) =>
      which === 'completed' ? i.status !== 'completed' : !(i.status === 'failed' || i.status === 'cancelled')
    )
    this.data.set(profileId, keep)
    this.persistProfile(profileId)
    this.emit({ type: 'list', profileId, items: keep.slice() })
    return keep.slice()
  }

  pauseAll(profileId: string) {
    for (const rec of this.ensureLoaded(profileId)) {
      if (rec.status === 'downloading') this.pause(profileId, rec.id)
    }
  }

  resumeAll(profileId: string) {
    for (const rec of this.ensureLoaded(profileId)) {
      if (rec.status === 'paused') this.resume(profileId, rec.id)
    }
  }

  open(profileId: string, id: string) {
    const rec = this.find(profileId, id)
    ensure(rec && rec.status === 'completed' && rec.savePath && existsSync(rec.savePath), 'not_found')
    shell.openPath(rec!.savePath as string)
    return true
  }

  showInFolder(profileId: string, id: string) {
    const rec = this.find(profileId, id)
    ensure(rec && rec.savePath && existsSync(rec.savePath), 'not_found')
    shell.showItemInFolder(rec!.savePath as string)
    return true
  }

  copyUrl(profileId: string, id: string): string {
    const rec = this.find(profileId, id)
    ensure(rec, 'not_found')
    return rec!.url
  }

  openDownloadsFolder(profileId: string) {
    const dir = this.destinationDir(profileId)
    shell.openPath(dir)
    return true
  }

  getSettingsPublic(profileId: string): DownloadSettings {
    return this.getSettings(profileId)
  }

  saveSettings(profileId: string, settings: DownloadSettings) {
    const prefs = this.persist.loadProfilePrefs(profileId)
    prefs.downloads = settings
    this.persist.saveProfilePrefs(profileId, prefs)
    // Concurrency may have increased — try to promote queued items.
    this.pump(profileId)
    return settings
  }

  /* -------------------- emit helpers -------------------- */

  private pushUpdate(profileId: string, rec: DownloadItem) {
    this.emit({ type: 'update', profileId, item: { ...rec } })
  }

  private throttledUpdate(profileId: string, rec: DownloadItem) {
    const now = Date.now()
    const last = this.lastEmit.get(rec.id) || 0
    if (now - last < 350) return
    this.lastEmit.set(rec.id, now)
    this.pushUpdate(profileId, rec)
  }
}
