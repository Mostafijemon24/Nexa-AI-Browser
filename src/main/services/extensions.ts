/**
 * STEP 13 — Main-process ExtensionService.
 *
 * Owns per-profile extension records (persisted, untrusted-on-read), and drives
 * the REAL Chromium runtime through Electron's `session.extensions` API, scoped
 * to the existing per-profile partitions (persist + private).
 *
 * Security:
 *   - The renderer never controls extension identity; the id comes from the
 *     Electron-loaded `Extension`. Manifests are validated before load.
 *   - Extensions load with `allowFileAccess: false` (no file:// access).
 *   - Private mode is opt-in per extension; only then is it loaded into the
 *     non-persistent private partition.
 *   - Failure is isolated: a bad extension never throws out of the service.
 *   - No secrets, page content, cookies, or paths are logged.
 */

import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import { assertSafeProfileId } from '../../platform/types'
import {
  buildExtensionRecord,
  canRunInPrivate,
  chromeToNexaPermissions,
  classifyRisk,
  HIGH_RISK_PERMISSIONS,
  isBroadHostAccess,
  isValidExtensionId,
  normalizeExtensionRecords,
  toExtensionInfo,
  validateManifest,
  type ExtensionInfo,
  type ExtensionPreview,
  type ExtensionRecord,
  type ExtensionSource,
  type NexaPermission,
  type SiteAccessMode
} from '../../shared/extensions'

/** The minimal slice of Electron's `Extensions` we depend on (fakeable). */
export interface ExtSessionLike {
  loadExtension(path: string, opts?: { allowFileAccess?: boolean }): Promise<{ id: string; name: string; version: string; manifest: unknown; path: string }>
  removeExtension(id: string): void
  getAllExtensions(): { id: string }[]
}

/** Resolves the persist/private extension sessions for a profile. */
export interface ExtensionSessionProvider {
  persist(profileId: string): ExtSessionLike
  private(profileId: string): ExtSessionLike
}

export type ExtEmit = (event: { type: 'list'; profileId: string; items: ExtensionInfo[] }) => void

/** Default provider: lazily uses Electron's real per-profile sessions. */
function defaultSessionProvider(): ExtensionSessionProvider {
  // Lazy require so unit tests (node env) never load Electron.
  const getExtensions = (partition: string): ExtSessionLike => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { session } = require('electron') as typeof import('electron')
    return session.fromPartition(partition).extensions as unknown as ExtSessionLike
  }
  return {
    persist: (id) => getExtensions(`persist:nexa-${id}`),
    private: (id) => getExtensions(`nexa-private-${id}`)
  }
}

export class ExtensionService {
  private sessions: ExtensionSessionProvider
  private readManifest: (dir: string) => unknown
  private now: () => number

  constructor(
    private persist: Persistence,
    private emit: ExtEmit = () => {},
    opts: { sessions?: ExtensionSessionProvider; readManifest?: (dir: string) => unknown; now?: () => number } = {}
  ) {
    this.sessions = opts.sessions || defaultSessionProvider()
    this.readManifest =
      opts.readManifest ||
      ((dir: string) => {
        const p = join(dir, 'manifest.json')
        return JSON.parse(readFileSync(p, 'utf8')) as unknown
      })
    this.now = opts.now || (() => Date.now())
  }

  /* ------------------------------ persistence ----------------------------- */

  private storePath(profileId: string): string {
    const dir = this.persist.profileDir(profileId)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'extensions.json')
  }

  private load(profileId: string): ExtensionRecord[] {
    assertSafeProfileId(profileId)
    return normalizeExtensionRecords(readJsonSafe<unknown>(this.storePath(profileId), []))
  }

  private save(profileId: string, records: ExtensionRecord[]): void {
    writeJsonAtomic(this.storePath(profileId), records)
    this.emit({ type: 'list', profileId, items: records.map(toExtensionInfo) })
  }

  /* -------------------------------- queries ------------------------------- */

  list(profileId: string): ExtensionInfo[] {
    return this.load(profileId).map(toExtensionInfo)
  }

  get(profileId: string, extensionId: string): ExtensionInfo | null {
    if (!isValidExtensionId(extensionId)) return null
    const rec = this.load(profileId).find((r) => r.id === extensionId)
    return rec ? toExtensionInfo(rec) : null
  }

  /**
   * Dry-run validation for the permission-review UI. Reads + validates the
   * manifest WITHOUT loading any extension code into a session.
   */
  preview(path: string): { ok: boolean; error?: string; preview?: ExtensionPreview } {
    if (typeof path !== 'string' || !path || !isAbsolute(path) || !existsSync(path)) return { ok: false, error: 'path_not_found' }
    let raw: unknown
    try {
      raw = this.readManifest(path)
    } catch {
      return { ok: false, error: 'manifest_unreadable' }
    }
    const v = validateManifest(raw)
    if (!v.manifest) return { ok: false, error: v.errors[0] || 'invalid_manifest' }
    const { nexa, blocked } = chromeToNexaPermissions(v.manifest.permissions)
    const broad = isBroadHostAccess(v.manifest.host_permissions)
    const perms = v.manifest.host_permissions.length && !nexa.includes('HOST_ACCESS') ? [...nexa, 'HOST_ACCESS' as NexaPermission] : nexa
    return {
      ok: v.support !== 'BLOCKED',
      error: v.support === 'BLOCKED' ? 'blocked_permissions' : undefined,
      preview: {
        name: v.manifest.name,
        version: v.manifest.version,
        description: v.manifest.description,
        permissions: perms,
        highRisk: perms.filter((p) => HIGH_RISK_PERMISSIONS.has(p)),
        hostPermissions: v.manifest.host_permissions,
        blockedPermissions: blocked,
        riskClass: classifyRisk(perms, broad, blocked),
        hasBackground: !!v.manifest.background,
        hasContentScripts: v.manifest.content_scripts.length > 0,
        hasAction: !!v.manifest.action
      }
    }
  }

  /* ------------------------------ installation ---------------------------- */

  /**
   * Install from a LOCAL unpacked folder. The renderer has already shown the
   * permission review + user confirmation before this is called. Validates the
   * manifest, then loads into the profile's persist session (enabled).
   */
  async install(profileId: string, path: string, source: ExtensionSource = 'LOCAL_FOLDER'): Promise<{ ok: boolean; info?: ExtensionInfo; error?: string }> {
    assertSafeProfileId(profileId)
    if (typeof path !== 'string' || !path || !isAbsolute(path) || !existsSync(path)) {
      return { ok: false, error: 'path_not_found' }
    }
    // 1. Validate manifest BEFORE any load.
    let manifestRaw: unknown
    try {
      manifestRaw = this.readManifest(path)
    } catch {
      return { ok: false, error: 'manifest_unreadable' }
    }
    const validation = validateManifest(manifestRaw)
    if (!validation.valid || !validation.manifest) {
      return { ok: false, error: validation.errors[0] || (validation.support === 'BLOCKED' ? 'blocked_permissions' : 'invalid_manifest') }
    }
    // 2. Load into the real per-profile persist session (no file access).
    let loaded: { id: string }
    try {
      loaded = await this.sessions.persist(profileId).loadExtension(path, { allowFileAccess: false })
    } catch {
      return { ok: false, error: 'load_failed' }
    }
    if (!isValidExtensionId(loaded.id)) {
      // Reject an implausible id from the runtime rather than trust it.
      try {
        this.sessions.persist(profileId).removeExtension(loaded.id)
      } catch {
        /* ignore */
      }
      return { ok: false, error: 'invalid_extension_id' }
    }
    // 3. Build + persist the record (enabled after explicit install).
    const record = buildExtensionRecord({ id: loaded.id, path, source, manifest: validation.manifest, installedAt: this.now() })
    record.enabled = true
    record.lifecycle = 'ENABLED'
    const records = this.load(profileId).filter((r) => r.id !== record.id)
    records.push(record)
    this.save(profileId, records)
    return { ok: true, info: toExtensionInfo(record) }
  }

  /* ------------------------------- mutations ------------------------------ */

  async setEnabled(profileId: string, extensionId: string, enabled: boolean): Promise<{ ok: boolean; info?: ExtensionInfo; error?: string }> {
    assertSafeProfileId(profileId)
    const records = this.load(profileId)
    const rec = records.find((r) => r.id === extensionId)
    if (!rec) return { ok: false, error: 'not_found' }
    if (rec.lifecycle === 'BLOCKED' || rec.blockedPermissions.length) return { ok: false, error: 'blocked' }
    try {
      if (enabled) {
        await this.sessions.persist(profileId).loadExtension(rec.path, { allowFileAccess: false })
        rec.enabled = true
        rec.lifecycle = 'ENABLED'
        rec.error = undefined
      } else {
        this.safeRemove(this.sessions.persist(profileId), rec.id)
        this.safeRemove(this.sessions.private(profileId), rec.id)
        rec.enabled = false
        rec.lifecycle = 'DISABLED'
      }
    } catch {
      rec.enabled = false
      rec.lifecycle = 'ERROR'
      rec.error = 'toggle_failed'
    }
    this.save(profileId, records)
    return { ok: rec.lifecycle !== 'ERROR', info: toExtensionInfo(rec), error: rec.error }
  }

  async setPrivate(profileId: string, extensionId: string, enabled: boolean): Promise<{ ok: boolean; info?: ExtensionInfo }> {
    assertSafeProfileId(profileId)
    const records = this.load(profileId)
    const rec = records.find((r) => r.id === extensionId)
    if (!rec) return { ok: false }
    rec.privateEnabled = enabled
    try {
      if (canRunInPrivate(rec)) await this.sessions.private(profileId).loadExtension(rec.path, { allowFileAccess: false })
      else this.safeRemove(this.sessions.private(profileId), rec.id)
    } catch {
      /* private load failure must not break the record */
    }
    this.save(profileId, records)
    return { ok: true, info: toExtensionInfo(rec) }
  }

  setSiteAccess(profileId: string, extensionId: string, mode: SiteAccessMode): { ok: boolean; info?: ExtensionInfo } {
    assertSafeProfileId(profileId)
    const records = this.load(profileId)
    const rec = records.find((r) => r.id === extensionId)
    if (!rec) return { ok: false }
    rec.siteAccess = mode
    this.save(profileId, records)
    return { ok: true, info: toExtensionInfo(rec) }
  }

  remove(profileId: string, extensionId: string): { ok: boolean } {
    assertSafeProfileId(profileId)
    if (!isValidExtensionId(extensionId)) return { ok: false }
    const records = this.load(profileId)
    const rec = records.find((r) => r.id === extensionId)
    if (!rec) return { ok: false }
    this.safeRemove(this.sessions.persist(profileId), rec.id)
    this.safeRemove(this.sessions.private(profileId), rec.id)
    this.save(profileId, records.filter((r) => r.id !== rec.id))
    return { ok: true }
  }

  /* --------------------------- startup reconcile -------------------------- */

  /**
   * Re-load enabled extensions for a profile (Electron requires loadExtension on
   * every boot). Lazy + failure-isolated: a broken extension is marked ERROR and
   * skipped, never blocking startup.
   */
  async applyForProfile(profileId: string): Promise<void> {
    let records: ExtensionRecord[]
    try {
      records = this.load(profileId)
    } catch {
      return
    }
    let changed = false
    for (const rec of records) {
      if (!rec.enabled || rec.lifecycle === 'BLOCKED') continue
      try {
        await this.sessions.persist(profileId).loadExtension(rec.path, { allowFileAccess: false })
        if (canRunInPrivate(rec)) await this.sessions.private(profileId).loadExtension(rec.path, { allowFileAccess: false })
        rec.lifecycle = 'ENABLED'
      } catch {
        rec.enabled = false
        rec.lifecycle = 'ERROR'
        rec.error = 'load_failed'
        changed = true
      }
    }
    if (changed) this.save(profileId, records)
  }

  applyForProfiles(profileIds: string[]): void {
    for (const id of profileIds) void this.applyForProfile(id)
  }

  private safeRemove(sess: ExtSessionLike, id: string): void {
    try {
      if (sess.getAllExtensions().some((e) => e.id === id)) sess.removeExtension(id)
    } catch {
      /* ignore */
    }
  }
}
