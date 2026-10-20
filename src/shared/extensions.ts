/**
 * STEP 13 — NEXA Extensions: pure shared core.
 *
 * Provider-agnostic, side-effect-free security + validation layer for the
 * Chromium extension runtime. No Electron, no I/O, no IPC — every function is
 * deterministic and unit-testable.
 *
 * Security posture (see NEXA_STEP_13_EXTENSION_SECURITY_AUDIT.md):
 *   - Manifest V3 only; MV2 is UNSUPPORTED (never executed).
 *   - Permissions are mapped to an explicit NEXA taxonomy; high-risk and
 *     forbidden permissions are surfaced, never auto-granted.
 *   - Host permissions are parsed/normalized; dangerous schemes are rejected
 *     (file:, chrome:, devtools:, electron:, data:, javascript:, ...).
 *   - Persisted per-profile records are treated as untrusted input.
 */

import { z } from 'zod'

/* -------------------------------- Enums ---------------------------------- */

export type ExtensionSupportState =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'BLOCKED'

/** Real per-extension lifecycle. */
export type ExtensionLifecycle =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'VALID'
  | 'INSTALLED'
  | 'ENABLED'
  | 'RUNNING'
  | 'DISABLED'
  | 'REMOVED'
  | 'INVALID'
  | 'BLOCKED'
  | 'ERROR'

export type ExtensionSource = 'LOCAL_FOLDER' | 'LOCAL_PACKAGE' | 'DEVELOPMENT_LOAD'

export type ExtensionRiskClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED'

/** Site-access mode. Only options genuinely actionable by the runtime. */
export type SiteAccessMode = 'always' | 'on_click' | 'on_selected' | 'never'

/* --------------------------- Permission taxonomy -------------------------- */

export type NexaPermission =
  | 'READ_TABS'
  | 'READ_HISTORY'
  | 'READ_BOOKMARKS'
  | 'DOWNLOADS'
  | 'STORAGE'
  | 'COOKIES'
  | 'ACTIVE_TAB'
  | 'SCRIPTING'
  | 'WEB_REQUEST'
  | 'HOST_ACCESS'
  | 'NOTIFICATIONS'
  | 'CLIPBOARD'
  | 'IDENTITY'
  | 'ALARMS'
  | 'CONTEXT_MENUS'
  | 'UNKNOWN'

/** Chrome permission string → NEXA permission. */
export const PERMISSION_MAP: Record<string, NexaPermission> = {
  tabs: 'READ_TABS',
  history: 'READ_HISTORY',
  bookmarks: 'READ_BOOKMARKS',
  downloads: 'DOWNLOADS',
  storage: 'STORAGE',
  unlimitedStorage: 'STORAGE',
  cookies: 'COOKIES',
  activeTab: 'ACTIVE_TAB',
  scripting: 'SCRIPTING',
  webRequest: 'WEB_REQUEST',
  webRequestBlocking: 'WEB_REQUEST',
  declarativeNetRequest: 'WEB_REQUEST',
  declarativeNetRequestWithHostAccess: 'WEB_REQUEST',
  declarativeNetRequestFeedback: 'WEB_REQUEST',
  notifications: 'NOTIFICATIONS',
  clipboardRead: 'CLIPBOARD',
  clipboardWrite: 'CLIPBOARD',
  identity: 'IDENTITY',
  alarms: 'ALARMS',
  contextMenus: 'CONTEXT_MENUS'
}

/** High-risk permissions requiring explicit, explained approval. */
export const HIGH_RISK_PERMISSIONS: ReadonlySet<NexaPermission> = new Set<NexaPermission>([
  'COOKIES',
  'WEB_REQUEST',
  'SCRIPTING',
  'HOST_ACCESS',
  'DOWNLOADS',
  'READ_HISTORY',
  'READ_BOOKMARKS',
  'IDENTITY'
])

/**
 * Chrome permissions NEXA refuses to run — they escalate outside the browser
 * sandbox or would let an extension subvert NEXA controls. Presence → BLOCKED.
 */
export const FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'debugger',
  'nativeMessaging',
  'proxy',
  'management',
  'privacy',
  'vpnProvider',
  'certificateProvider',
  'processes',
  'enterprise.platformKeys',
  'enterprise.deviceAttributes',
  'enterprise.hardwarePlatform',
  'enterprise.networkingAttributes',
  'system.storage',
  'system.display',
  'gcm'
])

const PERMISSION_LABELS: Record<NexaPermission, string> = {
  READ_TABS: 'Read open tabs',
  READ_HISTORY: 'Read browsing history',
  READ_BOOKMARKS: 'Read bookmarks',
  DOWNLOADS: 'Manage downloads',
  STORAGE: 'Store extension data',
  COOKIES: 'Access cookies',
  ACTIVE_TAB: 'Access the active tab (on click)',
  SCRIPTING: 'Run scripts on pages',
  WEB_REQUEST: 'Observe/modify network requests',
  HOST_ACCESS: 'Access data on specific sites',
  NOTIFICATIONS: 'Show notifications',
  CLIPBOARD: 'Read/write the clipboard',
  IDENTITY: 'Access identity / OAuth',
  ALARMS: 'Schedule background alarms',
  CONTEXT_MENUS: 'Add context-menu items',
  UNKNOWN: 'Other permission'
}

export function permissionLabel(p: NexaPermission): string {
  return PERMISSION_LABELS[p] || PERMISSION_LABELS.UNKNOWN
}

export function isHighRisk(p: NexaPermission): boolean {
  return HIGH_RISK_PERMISSIONS.has(p)
}

/** Map chrome permission strings → NEXA permissions + forbidden list. */
export function chromeToNexaPermissions(perms: unknown): { nexa: NexaPermission[]; blocked: string[]; raw: string[] } {
  const raw = Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : []
  const blocked = raw.filter((p) => FORBIDDEN_PERMISSIONS.has(p))
  const nexa = new Set<NexaPermission>()
  for (const p of raw) {
    if (FORBIDDEN_PERMISSIONS.has(p)) continue
    nexa.add(PERMISSION_MAP[p] ?? 'UNKNOWN')
  }
  return { nexa: [...nexa], blocked, raw }
}

/* -------------------------- Host permission parsing ----------------------- */

const ALLOWED_SCHEMES = new Set(['http', 'https', '*'])
/** Schemes we explicitly refuse for extension host access. */
export const FORBIDDEN_HOST_SCHEMES = ['file', 'chrome', 'chrome-extension', 'devtools', 'electron', 'data', 'javascript', 'ftp', 'ws', 'wss', 'about', 'blob']

export interface ParsedHostPattern {
  pattern: string
  valid: boolean
  allUrls: boolean
  scheme?: string
  host?: string
  path?: string
  reason?: string
}

/** Parse a single Manifest match pattern. Rejects dangerous schemes. */
export function parseHostPermission(pattern: unknown): ParsedHostPattern {
  if (typeof pattern !== 'string' || !pattern) return { pattern: String(pattern), valid: false, allUrls: false, reason: 'not_a_string' }
  if (pattern === '<all_urls>') return { pattern, valid: true, allUrls: true }
  const m = /^([a-zA-Z*]+):\/\/([^/]*)(\/.*)?$/.exec(pattern)
  if (!m) return { pattern, valid: false, allUrls: false, reason: 'malformed' }
  const scheme = m[1].toLowerCase()
  const host = m[2]
  const path = m[3] || '/'
  if (FORBIDDEN_HOST_SCHEMES.includes(scheme)) return { pattern, valid: false, allUrls: false, scheme, reason: 'forbidden_scheme' }
  if (!ALLOWED_SCHEMES.has(scheme)) return { pattern, valid: false, allUrls: false, scheme, reason: 'unsupported_scheme' }
  if (!host) return { pattern, valid: false, allUrls: false, scheme, reason: 'empty_host' }
  // host may be '*', '*.domain', or a concrete host. '*' mid-string is invalid.
  if (host !== '*' && host.includes('*') && !host.startsWith('*.')) {
    return { pattern, valid: false, allUrls: false, scheme, host, reason: 'bad_host_wildcard' }
  }
  return { pattern, valid: true, allUrls: false, scheme, host, path }
}

export interface NormalizedHostPermissions {
  normalized: string[]
  rejected: { pattern: string; reason: string }[]
  broad: boolean
}

/** Normalize a host_permissions array; drop/track rejected patterns. */
export function normalizeHostPermissions(list: unknown): NormalizedHostPermissions {
  const arr = Array.isArray(list) ? list : []
  const normalized: string[] = []
  const rejected: { pattern: string; reason: string }[] = []
  let broad = false
  for (const p of arr) {
    const parsed = parseHostPermission(p)
    if (!parsed.valid) {
      rejected.push({ pattern: String(p), reason: parsed.reason || 'invalid' })
      continue
    }
    if (parsed.allUrls || parsed.host === '*' || (parsed.scheme === '*' && parsed.host === '*')) broad = true
    normalized.push(parsed.pattern)
  }
  return { normalized, rejected, broad }
}

export function isBroadHostAccess(patterns: string[]): boolean {
  return patterns.some((p) => p === '<all_urls>' || /^[a-zA-Z*]+:\/\/\*\//.test(p) || p.endsWith('://*/*'))
}

/** Compile a match pattern to a RegExp for host testing (display/decisions). */
export function hostPatternToRegex(pattern: string): RegExp | null {
  if (pattern === '<all_urls>') return /^https?:\/\/.+/i
  const parsed = parseHostPermission(pattern)
  if (!parsed.valid || parsed.allUrls) return parsed.allUrls ? /^https?:\/\/.+/i : null
  const scheme = parsed.scheme === '*' ? 'https?' : parsed.scheme
  const host = parsed.host as string
  let hostRe: string
  if (host === '*') hostRe = '[^/]+'
  else if (host.startsWith('*.')) hostRe = '(?:[^/]+\\.)?' + escapeRe(host.slice(2))
  else hostRe = escapeRe(host)
  const path = (parsed.path || '/').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${scheme}://${hostRe}${path}$`, 'i')
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** Does any granted host pattern match the URL? Pure. */
export function matchesHost(patterns: string[], url: string): boolean {
  for (const p of patterns) {
    const re = hostPatternToRegex(p)
    if (re && re.test(url)) return true
  }
  return false
}

/* --------------------------- Manifest validation -------------------------- */

export interface ExtensionContentScript {
  matches: string[]
  exclude_matches?: string[]
  include_globs?: string[]
  exclude_globs?: string[]
  js?: string[]
  css?: string[]
  run_at?: 'document_start' | 'document_end' | 'document_idle'
  all_frames?: boolean
}

export interface ExtensionManifest {
  manifest_version: number
  name: string
  version: string
  description: string
  permissions: string[]
  host_permissions: string[]
  optional_permissions: string[]
  background?: { service_worker: string; type?: 'module' }
  content_scripts: ExtensionContentScript[]
  action?: { default_title?: string; default_popup?: string }
  icons?: Record<string, string>
  web_accessible_resources?: { resources: string[]; matches: string[] }[]
  commands?: Record<string, unknown>
}

export interface ManifestValidation {
  valid: boolean
  support: ExtensionSupportState
  errors: string[]
  warnings: string[]
  manifest?: ExtensionManifest
}

const VERSION_RE = /^\d+(\.\d+){0,3}$/
const RUN_AT = new Set(['document_start', 'document_end', 'document_idle'])

/** Strict Manifest V3 validator. Never executes code; only inspects structure. */
export function validateManifest(raw: unknown): ManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { valid: false, support: 'UNSUPPORTED', errors: ['manifest_not_object'], warnings }
  }
  const m = raw as Record<string, unknown>

  // manifest_version
  if (m.manifest_version === 2) {
    return { valid: false, support: 'UNSUPPORTED', errors: ['manifest_v2_unsupported'], warnings }
  }
  if (m.manifest_version !== 3) {
    return { valid: false, support: 'UNSUPPORTED', errors: ['manifest_version_must_be_3'], warnings }
  }

  // name / version / description
  const name = typeof m.name === 'string' ? m.name.trim() : ''
  if (!name || name.length > 128) errors.push('invalid_name')
  const version = typeof m.version === 'string' ? m.version : ''
  if (!VERSION_RE.test(version)) errors.push('invalid_version')
  const description = typeof m.description === 'string' ? m.description.slice(0, 1024) : ''

  // permissions
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) errors.push('permissions_not_array')
  if (m.optional_permissions !== undefined && !Array.isArray(m.optional_permissions)) errors.push('optional_permissions_not_array')
  const permsRaw = Array.isArray(m.permissions) ? (m.permissions as unknown[]).filter((p): p is string => typeof p === 'string') : []
  const optRaw = Array.isArray(m.optional_permissions) ? (m.optional_permissions as unknown[]).filter((p): p is string => typeof p === 'string') : []

  // host permissions
  if (m.host_permissions !== undefined && !Array.isArray(m.host_permissions)) errors.push('host_permissions_not_array')
  const host = normalizeHostPermissions(m.host_permissions)
  for (const r of host.rejected) warnings.push(`host_rejected:${r.reason}`)

  // background (MV3 service worker only)
  let background: ExtensionManifest['background'] | undefined
  if (m.background !== undefined) {
    const bg = m.background as Record<string, unknown>
    if (typeof bg?.service_worker === 'string' && bg.service_worker) {
      background = { service_worker: bg.service_worker, type: bg.type === 'module' ? 'module' : undefined }
    } else if ('scripts' in (bg || {}) || 'page' in (bg || {})) {
      errors.push('mv2_background_unsupported')
    } else {
      errors.push('invalid_background')
    }
  }

  // content scripts
  const content_scripts: ExtensionContentScript[] = []
  if (m.content_scripts !== undefined) {
    if (!Array.isArray(m.content_scripts)) {
      errors.push('content_scripts_not_array')
    } else {
      for (const cs of m.content_scripts as unknown[]) {
        const c = cs as Record<string, unknown>
        const matches = Array.isArray(c?.matches) ? (c.matches as unknown[]).filter((x): x is string => typeof x === 'string') : []
        if (!matches.length) {
          errors.push('content_script_missing_matches')
          continue
        }
        const hostCheck = normalizeHostPermissions(matches)
        if (!hostCheck.normalized.length) {
          errors.push('content_script_invalid_matches')
          continue
        }
        if (c.run_at !== undefined && typeof c.run_at === 'string' && !RUN_AT.has(c.run_at)) warnings.push('content_script_bad_run_at')
        content_scripts.push({
          matches: hostCheck.normalized,
          exclude_matches: strArr(c.exclude_matches),
          include_globs: strArr(c.include_globs),
          exclude_globs: strArr(c.exclude_globs),
          js: strArr(c.js),
          css: strArr(c.css),
          run_at: RUN_AT.has(c.run_at as string) ? (c.run_at as ExtensionContentScript['run_at']) : undefined,
          all_frames: typeof c.all_frames === 'boolean' ? c.all_frames : undefined
        })
      }
    }
  }

  // action / icons / web_accessible_resources
  let action: ExtensionManifest['action'] | undefined
  if (m.action !== undefined) {
    const a = m.action as Record<string, unknown>
    action = {
      default_title: typeof a?.default_title === 'string' ? a.default_title : undefined,
      default_popup: typeof a?.default_popup === 'string' ? a.default_popup : undefined
    }
  }
  const icons = m.icons && typeof m.icons === 'object' ? (m.icons as Record<string, string>) : undefined

  let web_accessible_resources: ExtensionManifest['web_accessible_resources']
  if (Array.isArray(m.web_accessible_resources)) {
    web_accessible_resources = (m.web_accessible_resources as unknown[])
      .map((w) => {
        const o = w as Record<string, unknown>
        return { resources: strArr(o?.resources) || [], matches: normalizeHostPermissions(o?.matches).normalized }
      })
      .filter((w) => w.resources.length)
  }

  if (errors.length) return { valid: false, support: 'UNSUPPORTED', errors, warnings }

  const manifest: ExtensionManifest = {
    manifest_version: 3,
    name,
    version,
    description,
    permissions: permsRaw,
    host_permissions: host.normalized,
    optional_permissions: optRaw,
    background,
    content_scripts,
    action,
    icons,
    web_accessible_resources,
    commands: m.commands && typeof m.commands === 'object' ? (m.commands as Record<string, unknown>) : undefined
  }

  // Support state: PARTIALLY_SUPPORTED when it relies on partial-Electron APIs.
  const { blocked } = chromeToNexaPermissions(permsRaw)
  const support: ExtensionSupportState = blocked.length ? 'BLOCKED' : 'PARTIALLY_SUPPORTED'
  return { valid: support !== 'BLOCKED', support, errors, warnings, manifest }
}

function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

/* --------------------------- Risk classification -------------------------- */

/**
 * UX risk indicator (NOT a replacement for the permission checks).
 *   BLOCKED  → forbidden permission present.
 *   HIGH     → cookies/webRequest/scripting + broad host, or identity.
 *   MEDIUM   → any high-risk permission or host access.
 *   LOW      → storage/notifications/alarms/etc.
 */
export function classifyRisk(perms: NexaPermission[], broadHost: boolean, blocked: string[] = []): ExtensionRiskClass {
  if (blocked.length) return 'BLOCKED'
  const set = new Set(perms)
  const powerful = set.has('SCRIPTING') || set.has('WEB_REQUEST') || set.has('COOKIES')
  if ((powerful && broadHost) || set.has('IDENTITY')) return 'HIGH'
  const anyHigh = perms.some((p) => HIGH_RISK_PERMISSIONS.has(p)) || broadHost
  if (anyHigh) return 'MEDIUM'
  return 'LOW'
}

/* ------------------------------ Extension record -------------------------- */

export interface ExtensionRecord {
  id: string
  name: string
  version: string
  manifestVersion: number
  description: string
  source: ExtensionSource
  path: string
  permissions: NexaPermission[]
  chromePermissions: string[]
  hostPermissions: string[]
  optionalPermissions: string[]
  blockedPermissions: string[]
  riskClass: ExtensionRiskClass
  enabled: boolean
  privateEnabled: boolean
  siteAccess: SiteAccessMode
  lifecycle: ExtensionLifecycle
  hasBackground: boolean
  hasContentScripts: boolean
  hasAction: boolean
  installedAt: number
  error?: string
}

/** Chrome/Electron extension id format: 32 chars a–p. */
export const EXTENSION_ID_RE = /^[a-p]{32}$/
export function isValidExtensionId(id: unknown): id is string {
  return typeof id === 'string' && EXTENSION_ID_RE.test(id)
}

/** Build a record from a validated manifest + resolved (main-side) identity. */
export function buildExtensionRecord(input: {
  id: string
  path: string
  source: ExtensionSource
  manifest: ExtensionManifest
  installedAt: number
}): ExtensionRecord {
  const { nexa, blocked } = chromeToNexaPermissions(input.manifest.permissions)
  const broad = isBroadHostAccess(input.manifest.host_permissions)
  const hasHost = input.manifest.host_permissions.length > 0
  const perms = hasHost && !nexa.includes('HOST_ACCESS') ? [...nexa, 'HOST_ACCESS' as NexaPermission] : nexa
  return {
    id: input.id,
    name: input.manifest.name,
    version: input.manifest.version,
    manifestVersion: input.manifest.manifest_version,
    description: input.manifest.description,
    source: input.source,
    path: input.path,
    permissions: perms,
    chromePermissions: input.manifest.permissions,
    hostPermissions: input.manifest.host_permissions,
    optionalPermissions: input.manifest.optional_permissions,
    blockedPermissions: blocked,
    riskClass: classifyRisk(perms, broad, blocked),
    enabled: false,
    privateEnabled: false,
    siteAccess: broad ? 'always' : 'on_click',
    lifecycle: blocked.length ? 'BLOCKED' : 'INSTALLED',
    hasBackground: !!input.manifest.background,
    hasContentScripts: input.manifest.content_scripts.length > 0,
    hasAction: !!input.manifest.action,
    installedAt: input.installedAt
  }
}

/* -------------------------- Lifecycle transitions ------------------------- */

const TRANSITIONS: Record<ExtensionLifecycle, ExtensionLifecycle[]> = {
  DISCOVERED: ['VALIDATING', 'INVALID', 'BLOCKED', 'ERROR'],
  VALIDATING: ['VALID', 'INVALID', 'BLOCKED', 'ERROR'],
  VALID: ['INSTALLED', 'ERROR'],
  INSTALLED: ['ENABLED', 'REMOVED', 'DISABLED', 'ERROR'],
  ENABLED: ['RUNNING', 'DISABLED', 'REMOVED', 'ERROR'],
  RUNNING: ['DISABLED', 'REMOVED', 'ERROR'],
  DISABLED: ['ENABLED', 'REMOVED', 'ERROR'],
  REMOVED: [],
  INVALID: ['REMOVED'],
  BLOCKED: ['REMOVED'],
  ERROR: ['DISABLED', 'REMOVED']
}

export function canTransition(from: ExtensionLifecycle, to: ExtensionLifecycle): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/* ------------------------- Private-mode + site access --------------------- */

/**
 * Whether an extension may load into the private (incognito) partition.
 * Default policy: extensions are disabled in private mode unless the user has
 * explicitly enabled per-extension private access AND it is otherwise enabled.
 */
export function canRunInPrivate(rec: Pick<ExtensionRecord, 'enabled' | 'privateEnabled' | 'lifecycle'>): boolean {
  return rec.enabled && rec.privateEnabled && rec.lifecycle !== 'BLOCKED' && rec.lifecycle !== 'INVALID'
}

export const SITE_ACCESS_MODES: SiteAccessMode[] = ['always', 'on_click', 'on_selected', 'never']

/* ----------------------------- Store validation --------------------------- */

/** Validate an untrusted persisted record array into safe records. */
export function normalizeExtensionRecords(persisted: unknown): ExtensionRecord[] {
  if (!Array.isArray(persisted)) return []
  const out: ExtensionRecord[] = []
  const seen = new Set<string>()
  for (const raw of persisted) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (!isValidExtensionId(r.id) || seen.has(r.id as string)) continue
    seen.add(r.id as string)
    const perms = Array.isArray(r.permissions) ? (r.permissions as NexaPermission[]).filter((p) => typeof p === 'string') : []
    const hostPermissions = Array.isArray(r.hostPermissions) ? (r.hostPermissions as string[]).filter((p) => typeof p === 'string') : []
    const blocked = Array.isArray(r.blockedPermissions) ? (r.blockedPermissions as string[]).filter((p) => typeof p === 'string') : []
    out.push({
      id: r.id as string,
      name: typeof r.name === 'string' ? r.name : r.id as string,
      version: typeof r.version === 'string' ? r.version : '0.0.0',
      manifestVersion: 3,
      description: typeof r.description === 'string' ? r.description : '',
      source: (['LOCAL_FOLDER', 'LOCAL_PACKAGE', 'DEVELOPMENT_LOAD'] as ExtensionSource[]).includes(r.source as ExtensionSource) ? (r.source as ExtensionSource) : 'LOCAL_FOLDER',
      path: typeof r.path === 'string' ? r.path : '',
      permissions: perms,
      chromePermissions: Array.isArray(r.chromePermissions) ? (r.chromePermissions as string[]).filter((p) => typeof p === 'string') : [],
      hostPermissions,
      optionalPermissions: Array.isArray(r.optionalPermissions) ? (r.optionalPermissions as string[]).filter((p) => typeof p === 'string') : [],
      blockedPermissions: blocked,
      riskClass: (['LOW', 'MEDIUM', 'HIGH', 'BLOCKED'] as ExtensionRiskClass[]).includes(r.riskClass as ExtensionRiskClass) ? (r.riskClass as ExtensionRiskClass) : classifyRisk(perms, isBroadHostAccess(hostPermissions), blocked),
      enabled: r.enabled === true && !blocked.length,
      privateEnabled: r.privateEnabled === true,
      siteAccess: (SITE_ACCESS_MODES as string[]).includes(r.siteAccess as string) ? (r.siteAccess as SiteAccessMode) : 'on_click',
      lifecycle: blocked.length ? 'BLOCKED' : r.enabled === true ? 'ENABLED' : 'DISABLED',
      hasBackground: r.hasBackground === true,
      hasContentScripts: r.hasContentScripts === true,
      hasAction: r.hasAction === true,
      installedAt: typeof r.installedAt === 'number' ? r.installedAt : 0,
      error: typeof r.error === 'string' ? r.error : undefined
    })
  }
  return out
}

/** Public, renderer-safe view of an extension (no source paths beyond folder). */
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  source: ExtensionSource
  permissions: NexaPermission[]
  hostPermissions: string[]
  blockedPermissions: string[]
  riskClass: ExtensionRiskClass
  enabled: boolean
  privateEnabled: boolean
  siteAccess: SiteAccessMode
  lifecycle: ExtensionLifecycle
  hasBackground: boolean
  hasContentScripts: boolean
  hasAction: boolean
  highRisk: NexaPermission[]
  error?: string
}

/** Renderer-facing permission review (dry-run; produced before any load). */
export interface ExtensionPreview {
  name: string
  version: string
  description: string
  permissions: NexaPermission[]
  highRisk: NexaPermission[]
  hostPermissions: string[]
  blockedPermissions: string[]
  riskClass: ExtensionRiskClass
  hasBackground: boolean
  hasContentScripts: boolean
  hasAction: boolean
}

export function toExtensionInfo(rec: ExtensionRecord): ExtensionInfo {
  return {
    id: rec.id,
    name: rec.name,
    version: rec.version,
    description: rec.description,
    source: rec.source,
    permissions: rec.permissions,
    hostPermissions: rec.hostPermissions,
    blockedPermissions: rec.blockedPermissions,
    riskClass: rec.riskClass,
    enabled: rec.enabled,
    privateEnabled: rec.privateEnabled,
    siteAccess: rec.siteAccess,
    lifecycle: rec.lifecycle,
    hasBackground: rec.hasBackground,
    hasContentScripts: rec.hasContentScripts,
    hasAction: rec.hasAction,
    highRisk: rec.permissions.filter((p) => HIGH_RISK_PERMISSIONS.has(p)),
    error: rec.error
  }
}

/* ------------------------------- IPC schemas ------------------------------ */

const profileIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'invalid_profile_id')
const extensionIdSchema = z.string().regex(EXTENSION_ID_RE, 'invalid_extension_id')

export const extListSchema = z.object({ profileId: profileIdSchema })
export const extInstallSchema = z.object({ profileId: profileIdSchema, path: z.string().min(1).max(4096) })
export const extRefSchema = z.object({ profileId: profileIdSchema, extensionId: extensionIdSchema })
export const extEnableSchema = z.object({ profileId: profileIdSchema, extensionId: extensionIdSchema, enabled: z.boolean() })
export const extPrivateSchema = z.object({ profileId: profileIdSchema, extensionId: extensionIdSchema, enabled: z.boolean() })
export const extSiteAccessSchema = z.object({ profileId: profileIdSchema, extensionId: extensionIdSchema, mode: z.enum(['always', 'on_click', 'on_selected', 'never']) })
