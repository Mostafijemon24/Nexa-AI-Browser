import { z } from 'zod'

export const PROTECTION_VERSION = 1

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type ProtectionDecision = 'allow' | 'block'

export type ProtectionCategory = 'ad' | 'tracker' | 'annoyance' | 'malicious' | 'user-block' | 'other'

export type ProtectionRuntimeState = 'active' | 'off' | 'error' | 'not_configured'

export interface ProtectionRequest {
  url: string
  topUrl?: string
  resourceType?: string
}

export interface ProtectionResult {
  decision: ProtectionDecision
  reason?: string
  ruleId?: string
  category?: ProtectionCategory
}

export interface FilterRule {
  /** registrable/hostname pattern, e.g. "ads.example.com" */
  domain: string
  category: ProtectionCategory
  /** limit to these Electron resource types; undefined = all */
  resourceTypes?: string[]
  /** only applies to third-party requests */
  thirdPartyOnly?: boolean
  /** exception (allow) rule — @@ in adblock syntax */
  isException: boolean
  raw: string
}

export interface CompiledRules {
  /** domain -> block rules terminating at that domain */
  block: Map<string, FilterRule[]>
  /** domain -> exception rules */
  allow: Map<string, FilterRule[]>
  count: number
}

/** Per-profile persisted site rules. */
export interface SiteRules {
  version: number
  /** domains where protection is fully allowed (allowlist) */
  allow: string[]
  /** domains the user manually blocks */
  block: string[]
  /** per-site override: topHost -> protection enabled? (false = disabled on that site) */
  overrides: Record<string, boolean>
}

export function emptySiteRules(): SiteRules {
  return { version: PROTECTION_VERSION, allow: [], block: [], overrides: {} }
}

export interface ProtectionSettings {
  enabled: boolean
  /** enforced categories */
  ads: boolean
  trackers: boolean
  annoyances: boolean
}

export interface CategoryCounts {
  ad: number
  tracker: number
  annoyance: number
  malicious: number
  'user-block': number
  other: number
}

export interface ProtectionStats {
  requests: number
  blocked: number
  allowed: number
  byCategory: CategoryCounts
}

export function emptyCounts(): CategoryCounts {
  return { ad: 0, tracker: 0, annoyance: 0, malicious: 0, 'user-block': 0, other: 0 }
}

export function emptyStats(): ProtectionStats {
  return { requests: 0, blocked: 0, allowed: 0, byCategory: emptyCounts() }
}

export interface ProtectionEventRecord {
  ts: number
  decision: ProtectionDecision
  /** redacted: scheme://host/path only */
  url: string
  host: string
  resourceType?: string
  category?: ProtectionCategory
}

/* ------------------------------------------------------------------ *
 * Host helpers
 * ------------------------------------------------------------------ */

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Compact set of multi-label public suffixes (not a full PSL — documented limitation).
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'or.jp', 'ne.jp', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.cn', 'com.mx', 'co.in', 'co.kr', 'com.tr', 'com.sg', 'co.za', 'com.hk'
])

/** Best-effort registrable domain (eTLD+1). */
export function registrableDomain(host: string): string {
  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_SUFFIX.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.')
  return lastTwo
}

export function isThirdParty(reqHost: string, topHost: string): boolean {
  if (!topHost || !reqHost) return false
  return registrableDomain(reqHost) !== registrableDomain(topHost)
}

/** All parent domains including the host itself: a.b.c -> [a.b.c, b.c, c] */
export function domainChain(host: string): string[] {
  const labels = host.split('.').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < labels.length; i++) out.push(labels.slice(i).join('.'))
  return out
}

/** True if host or any parent domain is in the set. */
export function hostInSet(host: string, set: Set<string>): boolean {
  if (!host || set.size === 0) return false
  for (const d of domainChain(host)) if (set.has(d)) return true
  return false
}

/* ------------------------------------------------------------------ *
 * Filter parsing (Adblock-subset syntax)
 * Supported:
 *   ! comment            -> ignored
 *   ||domain^            -> block domain + subdomains
 *   ||domain^$script,image,third-party  -> resource-type / third-party options
 *   @@||domain^          -> exception (allow)
 *   plain.domain.com     -> block domain + subdomains
 * ------------------------------------------------------------------ */

const RESOURCE_OPTION_MAP: Record<string, string> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  font: 'font',
  media: 'media',
  object: 'object',
  xmlhttprequest: 'xhr',
  xhr: 'xhr',
  subdocument: 'subFrame',
  ping: 'ping',
  websocket: 'webSocket',
  other: 'other'
}

export function parseFilterLine(line: string, category: ProtectionCategory): FilterRule | null {
  const raw = line.trim()
  if (!raw || raw.startsWith('!') || raw.startsWith('#') || raw.startsWith('[')) return null

  let rest = raw
  const isException = rest.startsWith('@@')
  if (isException) rest = rest.slice(2)

  // Split options after '$'
  let options = ''
  const dollar = rest.indexOf('$')
  if (dollar >= 0) {
    options = rest.slice(dollar + 1)
    rest = rest.slice(0, dollar)
  }

  // Extract a clean domain from ||domain^ or plain domain.
  let domain = rest
  if (domain.startsWith('||')) domain = domain.slice(2)
  domain = domain.replace(/^https?:\/\//, '')
  domain = domain.replace(/[\^/*|].*$/, '') // stop at separator/path/wildcard
  domain = domain.replace(/\.$/, '').toLowerCase().trim()
  // Reject anything that isn't a plain hostname (no cosmetic '##', no regex).
  if (!domain || domain.includes('#') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null

  let resourceTypes: string[] | undefined
  let thirdPartyOnly = false
  if (options) {
    const parts = options.split(',').map((p) => p.trim().toLowerCase())
    const types: string[] = []
    for (const p of parts) {
      if (p === 'third-party' || p === '3p') thirdPartyOnly = true
      else if (RESOURCE_OPTION_MAP[p]) types.push(RESOURCE_OPTION_MAP[p])
    }
    if (types.length) resourceTypes = types
  }

  return { domain, category, resourceTypes, thirdPartyOnly, isException, raw }
}

export function parseFilterList(text: string, category: ProtectionCategory): FilterRule[] {
  const out: FilterRule[] = []
  for (const line of text.split(/\r?\n/)) {
    const rule = parseFilterLine(line, category)
    if (rule) out.push(rule)
  }
  return out
}

export function compileRules(rules: FilterRule[]): CompiledRules {
  const block = new Map<string, FilterRule[]>()
  const allow = new Map<string, FilterRule[]>()
  for (const r of rules) {
    const map = r.isException ? allow : block
    const list = map.get(r.domain)
    if (list) list.push(r)
    else map.set(r.domain, [r])
  }
  return { block, allow, count: rules.length }
}

function ruleApplies(rule: FilterRule, resourceType: string | undefined, thirdParty: boolean): boolean {
  if (rule.thirdPartyOnly && !thirdParty) return false
  if (rule.resourceTypes && resourceType && !rule.resourceTypes.includes(resourceType)) return false
  if (rule.resourceTypes && !resourceType) return false
  return true
}

function firstMatch(map: Map<string, FilterRule[]>, host: string, resourceType: string | undefined, thirdParty: boolean): FilterRule | null {
  for (const d of domainChain(host)) {
    const list = map.get(d)
    if (!list) continue
    for (const r of list) if (ruleApplies(r, resourceType, thirdParty)) return r
  }
  return null
}

export interface MatchContext {
  enabled: boolean
  categories: { ad: boolean; tracker: boolean; annoyance: boolean }
  /** user allowlist domains */
  allowHosts: Set<string>
  /** user blocklist domains */
  blockHosts: Set<string>
  /** true if the top site has protection disabled via per-site override */
  siteDisabled: boolean
}

function categoryEnabled(cat: ProtectionCategory, ctx: MatchContext): boolean {
  if (cat === 'ad') return ctx.categories.ad
  if (cat === 'tracker') return ctx.categories.tracker
  if (cat === 'annoyance') return ctx.categories.annoyance
  // malicious/other rules from lists still block; user-block handled separately
  return true
}

/**
 * The authoritative decision (pure). Called on the hot path with precomputed ctx.
 */
export function matchRequest(compiled: CompiledRules, req: ProtectionRequest, ctx: MatchContext): ProtectionResult {
  if (!ctx.enabled || ctx.siteDisabled) return { decision: 'allow', reason: ctx.siteDisabled ? 'site-disabled' : 'protection-off' }

  // Never block top-level navigations (avoids breaking pages/downloads).
  if (req.resourceType === 'mainFrame') return { decision: 'allow', reason: 'main-frame' }

  const reqHost = hostnameOf(req.url)
  if (!reqHost) return { decision: 'allow', reason: 'no-host' }
  const topHost = req.topUrl ? hostnameOf(req.topUrl) : ''
  const thirdParty = topHost ? isThirdParty(reqHost, topHost) : true

  // Site allowlisted (top host) -> allow everything on it.
  if (topHost && hostInSet(topHost, ctx.allowHosts)) return { decision: 'allow', reason: 'allowlist-site' }

  // User blocklist wins over lists (but respects allowlist above for the site itself).
  if (hostInSet(reqHost, ctx.blockHosts)) {
    return { decision: 'block', reason: 'user-blocklist', category: 'user-block' }
  }

  // Request-domain allowlisted -> allow.
  if (hostInSet(reqHost, ctx.allowHosts)) return { decision: 'allow', reason: 'allowlist-domain' }

  // Exception rules from filter lists.
  const exception = firstMatch(compiled.allow, reqHost, req.resourceType, thirdParty)
  if (exception) return { decision: 'allow', reason: 'exception', ruleId: exception.raw }

  // Block rules.
  const blockRule = firstMatch(compiled.block, reqHost, req.resourceType, thirdParty)
  if (blockRule && categoryEnabled(blockRule.category, ctx)) {
    return { decision: 'block', reason: 'filter', ruleId: blockRule.raw, category: blockRule.category }
  }

  return { decision: 'allow', reason: 'no-match' }
}

/* ------------------------------------------------------------------ *
 * Privacy: redact a URL to scheme://host/path (drops query + secrets)
 * ------------------------------------------------------------------ */

export function redactRequestUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '[unparseable-url]'
  }
}

/* ------------------------------------------------------------------ *
 * Persistence schema + IPC payloads
 * ------------------------------------------------------------------ */

export const siteRulesSchema = z.object({
  version: z.number(),
  allow: z.array(z.string().max(255)),
  block: z.array(z.string().max(255)),
  overrides: z.record(z.boolean())
})

export function normalizeSiteRules(raw: unknown): SiteRules {
  const parsed = siteRulesSchema.safeParse(raw)
  if (!parsed.success) return emptySiteRules()
  return { version: PROTECTION_VERSION, allow: parsed.data.allow, block: parsed.data.block, overrides: parsed.data.overrides }
}

/** Validate + normalize a user-supplied domain (no scheme, no path, no wildcard). */
export function cleanDomain(input: string): string | null {
  let d = (input || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null
  if (d.length > 255) return null
  return d
}

export const domainPayloadSchema = z.object({ profileId: z.string().min(1).max(64), domain: z.string().min(1).max(255) })
export const siteEnabledSchema = z.object({
  profileId: z.string().min(1).max(64),
  domain: z.string().min(1).max(255),
  enabled: z.boolean()
})
export const protectionSettingsSchema = z.object({
  profileId: z.string().min(1).max(64),
  enabled: z.boolean(),
  ads: z.boolean(),
  trackers: z.boolean(),
  annoyances: z.boolean()
})
