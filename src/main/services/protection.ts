import { session as electronSession, webContents as electronWebContents, type Session } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { assertSafeProfileId } from '../../platform/types'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import {
  cleanDomain,
  emptyStats,
  hostnameOf,
  matchRequest,
  normalizeSiteRules,
  redactRequestUrl,
  registrableDomain,
  type CompiledRules,
  type MatchContext,
  type ProtectionCategory,
  type ProtectionEventRecord,
  type ProtectionResult,
  type ProtectionRuntimeState,
  type ProtectionSettings,
  type ProtectionStats,
  type SiteRules
} from '../../shared/protection'
import { bundledCompiled, bundledListInfo } from './protection-rules'

function ensure(cond: unknown, code: string): asserts cond {
  if (!cond) throw new Error(code)
}

export interface ProtectionSnapshot {
  profileId: string
  private: boolean
  state: ProtectionRuntimeState
  settings: ProtectionSettings
  totals: ProtectionStats
  perDomain: Record<string, ProtectionStats>
  recent: ProtectionEventRecord[]
}

export interface ProtectionEmitter {
  (event: { type: 'snapshot'; snapshot: ProtectionSnapshot }): void
}

interface StatState {
  totals: ProtectionStats
  perDomain: Map<string, ProtectionStats>
  recent: ProtectionEventRecord[]
}

function newStatState(): StatState {
  return { totals: emptyStats(), perDomain: new Map(), recent: [] }
}

const PARTITION_PERSIST = (id: string) => `persist:nexa-${id}`
const PARTITION_PRIVATE = (id: string) => `nexa-private-${id}`
const MAX_RECENT = 100
const MAX_PERDOMAIN = 250
const FLUSH_MS = 750

export class ProtectionService {
  private compiled: CompiledRules
  private state: ProtectionRuntimeState = 'active'
  private attached = new Set<string>()
  private rulesCache = new Map<string, SiteRules>()
  private settingsCache = new Map<string, ProtectionSettings>()
  private pub = new Map<string, StatState>()
  private priv = new Map<string, StatState>()
  private dirty = new Set<string>() // `${profileId}:${'p'|'n'}`
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private persist: Persistence,
    private emit: ProtectionEmitter
  ) {
    try {
      this.compiled = bundledCompiled()
      if (this.compiled.count === 0) this.state = 'not_configured'
    } catch {
      this.compiled = { block: new Map(), allow: new Map(), count: 0 }
      this.state = 'error'
    }
  }

  /* -------------------- persistence -------------------- */

  private path(profileId: string) {
    const dir = this.persist.profileDir(assertSafeProfileId(profileId))
    mkdirSync(dir, { recursive: true })
    return join(dir, 'protection.json')
  }

  private siteRules(profileId: string): SiteRules {
    let r = this.rulesCache.get(profileId)
    if (r) return r
    r = normalizeSiteRules(readJsonSafe<unknown>(this.path(profileId), null))
    this.rulesCache.set(profileId, r)
    return r
  }

  private persistSiteRules(profileId: string) {
    const r = this.siteRules(profileId)
    writeJsonAtomic(this.path(profileId), r)
  }

  private settings(profileId: string): ProtectionSettings {
    let s = this.settingsCache.get(profileId)
    if (s) return s
    try {
      const prefs = this.persist.loadProfilePrefs(profileId)
      s = {
        enabled: !!prefs.adOn,
        ads: prefs.adCats?.ads ?? true,
        trackers: prefs.adCats?.trackers ?? true,
        annoyances: prefs.adCats?.annoyances ?? true
      }
    } catch {
      s = { enabled: true, ads: true, trackers: true, annoyances: true }
    }
    this.settingsCache.set(profileId, s)
    return s
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
      this.settings(id)
      this.siteRules(id)
    }
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), FLUSH_MS)
  }

  private attach(sess: Session, profileId: string, isPrivate: boolean) {
    const key = `${profileId}:${isPrivate ? 'p' : 'n'}`
    if (this.attached.has(key)) return
    try {
      sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        try {
          const cancel = this.decide(profileId, isPrivate, details)
          callback({ cancel })
        } catch {
          // Fail open so browsing never breaks; engine stays usable.
          callback({ cancel: false })
        }
      })
      this.attached.add(key)
    } catch {
      this.state = 'error'
    }
  }

  /* -------------------- decision + stats (hot path) -------------------- */

  private decide(profileId: string, isPrivate: boolean, details: Electron.OnBeforeRequestListenerDetails): boolean {
    const settings = this.settings(profileId)
    let topUrl: string | undefined
    if (typeof details.webContentsId === 'number') {
      try {
        topUrl = electronWebContents.fromId(details.webContentsId)?.getURL() || undefined
      } catch {
        topUrl = undefined
      }
    }
    const rules = this.siteRules(profileId)
    const topHost = topUrl ? hostnameOf(topUrl) : ''
    const override = topHost ? rules.overrides[registrableDomain(topHost)] ?? rules.overrides[topHost] : undefined
    const ctx: MatchContext = {
      enabled: settings.enabled,
      categories: { ad: settings.ads, tracker: settings.trackers, annoyance: settings.annoyances },
      allowHosts: new Set(rules.allow),
      blockHosts: new Set(rules.block),
      siteDisabled: override === false
    }
    const result = matchRequest(this.compiled, { url: details.url, topUrl, resourceType: details.resourceType }, ctx)
    this.record(profileId, isPrivate, details, topHost, result)
    return result.decision === 'block'
  }

  private record(
    profileId: string,
    isPrivate: boolean,
    details: Electron.OnBeforeRequestListenerDetails,
    topHost: string,
    result: ProtectionResult
  ) {
    const map = isPrivate ? this.priv : this.pub
    let st = map.get(profileId)
    if (!st) {
      st = newStatState()
      map.set(profileId, st)
    }
    st.totals.requests++
    const blocked = result.decision === 'block'
    if (blocked) {
      st.totals.blocked++
      const cat = (result.category || 'other') as ProtectionCategory
      st.totals.byCategory[cat]++
    } else {
      st.totals.allowed++
    }

    // Per top-frame domain counters (both profiles) — key by registrable domain.
    const domain = topHost ? registrableDomain(topHost) : '(unknown)'
    let ds = st.perDomain.get(domain)
    if (!ds) {
      if (st.perDomain.size >= MAX_PERDOMAIN) {
        // Evict oldest inserted domain to bound memory.
        const firstKey = st.perDomain.keys().next().value
        if (firstKey) st.perDomain.delete(firstKey)
      }
      ds = emptyStats()
      st.perDomain.set(domain, ds)
    }
    ds.requests++
    if (blocked) {
      ds.blocked++
      ds.byCategory[(result.category || 'other') as ProtectionCategory]++
    } else ds.allowed++

    // Recent activity ring — PUBLIC profiles only, redacted, blocked events only.
    if (!isPrivate && blocked) {
      st.recent.unshift({
        ts: Date.now(),
        decision: 'block',
        url: redactRequestUrl(details.url),
        host: hostnameOf(details.url),
        resourceType: details.resourceType,
        category: result.category
      })
      if (st.recent.length > MAX_RECENT) st.recent.length = MAX_RECENT
    }

    this.dirty.add(`${profileId}:${isPrivate ? 'p' : 'n'}`)
  }

  /* -------------------- emit -------------------- */

  private snapshot(profileId: string, isPrivate: boolean): ProtectionSnapshot {
    const st = (isPrivate ? this.priv : this.pub).get(profileId) || newStatState()
    const perDomain: Record<string, ProtectionStats> = {}
    for (const [k, v] of st.perDomain) perDomain[k] = v
    return {
      profileId,
      private: isPrivate,
      state: this.state,
      settings: this.settings(profileId),
      totals: st.totals,
      perDomain,
      recent: st.recent.slice(0, MAX_RECENT)
    }
  }

  private flush() {
    if (this.dirty.size === 0) return
    const keys = Array.from(this.dirty)
    this.dirty.clear()
    for (const key of keys) {
      const [profileId, pk] = key.split(':')
      this.emit({ type: 'snapshot', snapshot: this.snapshot(profileId, pk === 'p') })
    }
  }

  private emitNow(profileId: string) {
    this.emit({ type: 'snapshot', snapshot: this.snapshot(profileId, false) })
    if (this.priv.has(profileId)) this.emit({ type: 'snapshot', snapshot: this.snapshot(profileId, true) })
  }

  /* -------------------- commands -------------------- */

  getState(profileId: string): ProtectionSnapshot {
    assertSafeProfileId(profileId)
    return this.snapshot(profileId, false)
  }

  getStats(profileId: string, isPrivate = false): ProtectionSnapshot {
    assertSafeProfileId(profileId)
    return this.snapshot(profileId, isPrivate)
  }

  getSettings(profileId: string): ProtectionSettings {
    return this.settings(profileId)
  }

  saveSettings(profileId: string, next: ProtectionSettings) {
    assertSafeProfileId(profileId)
    const prefs = this.persist.loadProfilePrefs(profileId)
    prefs.adOn = next.enabled
    prefs.adCats = { ...prefs.adCats, ads: next.ads, trackers: next.trackers, annoyances: next.annoyances }
    this.persist.saveProfilePrefs(profileId, prefs)
    this.settingsCache.set(profileId, { ...next })
    this.emitNow(profileId)
    return next
  }

  setEnabled(profileId: string, enabled: boolean) {
    const s = this.settings(profileId)
    return this.saveSettings(profileId, { ...s, enabled })
  }

  getSiteState(profileId: string, domainInput: string) {
    assertSafeProfileId(profileId)
    const domain = cleanDomain(domainInput)
    const rules = this.siteRules(profileId)
    const settings = this.settings(profileId)
    if (!domain) {
      return { domain: domainInput, applicable: false, enabled: settings.enabled, allowlisted: false, blocklisted: false }
    }
    const reg = registrableDomain(domain)
    const override = rules.overrides[reg] ?? rules.overrides[domain]
    const allowlisted = rules.allow.includes(reg) || rules.allow.includes(domain)
    const enabled = settings.enabled && override !== false && !allowlisted
    return {
      domain: reg,
      applicable: true,
      enabled,
      allowlisted,
      blocklisted: rules.block.includes(reg) || rules.block.includes(domain),
      override: override ?? null
    }
  }

  setSiteEnabled(profileId: string, domainInput: string, enabled: boolean) {
    assertSafeProfileId(profileId)
    const domain = cleanDomain(domainInput)
    ensure(domain, 'invalid_domain')
    const rules = this.siteRules(profileId)
    const reg = registrableDomain(domain!)
    rules.overrides[reg] = enabled
    // Disabling on-site clears any allowlist duplicate confusion; keep explicit.
    this.persistSiteRules(profileId)
    this.emitNow(profileId)
    return this.getSiteState(profileId, reg)
  }

  addAllow(profileId: string, domainInput: string) {
    return this.mutateList(profileId, domainInput, 'allow', true)
  }
  removeAllow(profileId: string, domainInput: string) {
    return this.mutateList(profileId, domainInput, 'allow', false)
  }
  addBlock(profileId: string, domainInput: string) {
    return this.mutateList(profileId, domainInput, 'block', true)
  }
  removeBlock(profileId: string, domainInput: string) {
    return this.mutateList(profileId, domainInput, 'block', false)
  }

  private mutateList(profileId: string, domainInput: string, list: 'allow' | 'block', add: boolean) {
    assertSafeProfileId(profileId)
    const rules = this.siteRules(profileId)
    if (add) {
      const domain = cleanDomain(domainInput)
      ensure(domain, 'invalid_domain')
      const arr = rules[list]
      if (!arr.includes(domain!)) arr.push(domain!)
      // Keep the lists mutually exclusive.
      const other = list === 'allow' ? 'block' : 'allow'
      rules[other] = rules[other].filter((d) => d !== domain)
    } else {
      const domain = cleanDomain(domainInput) || domainInput
      rules[list] = rules[list].filter((d) => d !== domain)
    }
    this.persistSiteRules(profileId)
    this.emitNow(profileId)
    return { allow: rules.allow.slice(), block: rules.block.slice(), overrides: { ...rules.overrides } }
  }

  getRules(profileId: string) {
    const rules = this.siteRules(profileId)
    return {
      allow: rules.allow.slice(),
      block: rules.block.slice(),
      overrides: { ...rules.overrides },
      lists: bundledListInfo(),
      totalRules: this.compiled.count
    }
  }

  resetStats(profileId: string, isPrivate = false) {
    assertSafeProfileId(profileId)
    ;(isPrivate ? this.priv : this.pub).set(profileId, newStatState())
    this.emitNow(profileId)
    return true
  }

  /** Drop private, session-scoped stats (called when a private context ends). */
  clearPrivate(profileId: string) {
    this.priv.delete(profileId)
  }

  dispose() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}
