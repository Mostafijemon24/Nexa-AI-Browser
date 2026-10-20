/**
 * Click-to-Go — deterministic intent resolver for the NEXA address bar.
 *
 * SECURITY MODEL (STEP 4):
 * - This module is PURE and DATA-ONLY. It never holds or returns executable values
 *   (no functions, no eval targets). It maps user text to *registered intent IDs* and
 *   *validated http(s) URLs* only. The renderer executes those IDs against existing,
 *   capability-specific store actions — there is no generic execution path.
 * - URL detection reuses the same `looksLikeUrl`/`normalizeUrl` helpers the browser
 *   already uses for navigation, which only accept http(s)/bare-domain input. Any
 *   `javascript:`, `file:`, `data:`, `vbscript:`, `electron:`, `shell:` style input is
 *   NOT treated as a URL and falls through to a plain web search — never executed as a
 *   protocol.
 * - AI does NOT participate in routing. Resolution is deterministic and synchronous.
 */
import { looksLikeUrl, normalizeUrl } from './types'
import type { ChromeView } from './types'

export type IntentKind = 'url' | 'command' | 'service' | 'page_action' | 'search'
export type SuggestionGroup = 'URL' | 'NEXA' | 'SERVICES' | 'PAGE' | 'SEARCH'

/** A NEXA command reachable from Click-to-Go. Data only — execution is mapped by `id`. */
export interface NexaCommandDef {
  id: string
  aliases: string[]
  label: string
  /** Simple view navigation target (most commands). */
  view?: ChromeView
  /** Overlay to open instead of a view (e.g. 'vpn'). */
  overlay?: string
  /** Docked assistant panel to open instead of a view/overlay (e.g. 'worker'). */
  panel?: 'worker' | 'vault'
  /** Open Settings at a specific section (e.g. 'regional'). */
  settingsSection?: string
}

/** A known website. Navigation only — NO OAuth / account / "connected" semantics. */
export interface ServiceDef {
  id: string
  aliases: string[]
  label: string
  url: string
}

export type PageActionRequirement = 'page' | 'selection' | 'ai'

/** A page capability that already exists in the app (P5 / P5.2). */
export interface PageActionDef {
  id: string
  aliases: string[]
  label: string
  requires: PageActionRequirement[]
}

/** A resolved, render-ready suggestion. Execution payload is data only. */
export interface Suggestion {
  key: string
  kind: IntentKind
  group: SuggestionGroup
  label: string
  sublabel: string
  url?: string
  query?: string
  commandId?: string
  serviceId?: string
  actionId?: string
}

export interface ResolveContext {
  onWebPage: boolean
  hasSelection: boolean
  aiConnected: boolean
  /** Display-only name of the active search engine (e.g. "Google"). */
  searchEngine?: string
}

/**
 * NEXA command registry — every entry maps to a real, existing view/overlay.
 * Shared source of truth for Click-to-Go (the Command Palette calls the same
 * underlying store actions).
 */
export const NEXA_COMMANDS: NexaCommandDef[] = [
  { id: 'dashboard', aliases: ['dashboard', 'home', 'new tab', 'newtab'], label: 'Dashboard', view: 'newtab' },
  { id: 'downloads', aliases: ['downloads', 'download manager', 'downloads folder'], label: 'Downloads', view: 'downloads' },
  { id: 'history', aliases: ['history', 'browsing history'], label: 'History', view: 'history' },
  { id: 'bookmarks', aliases: ['bookmarks', 'favorites'], label: 'Bookmarks', view: 'bookmarks' },
  { id: 'collections', aliases: ['collections'], label: 'Collections', view: 'collections' },
  { id: 'cloud', aliases: ['cloud', 'cloud transfer', 'transfers'], label: 'Cloud Transfer', view: 'cloud' },
  { id: 'protection', aliases: ['protection', 'adblock', 'ad blocker', 'shield'], label: 'Protection', view: 'protection' },
  {
    id: 'privacy',
    aliases: [
      'privacy',
      'privacy center',
      'privacy scan',
      'check privacy',
      'ip check',
      'dns check',
      'webrtc check',
      'fingerprint check',
      'privacy diagnostics'
    ],
    label: 'Privacy Center',
    view: 'privacy'
  },
  {
    id: 'drive',
    aliases: ['drive', 'google drive', 'connect drive', 'open drive', 'my drive', 'gdrive', 'cloud drive'],
    label: 'Google Drive',
    view: 'drive'
  },
  { id: 'settings', aliases: ['settings', 'preferences', 'options'], label: 'Settings', view: 'settings' },
  {
    id: 'ai-settings',
    // STEP 12 — jump to AI settings (providers/models/privacy). Deterministic;
    // never executes a provider action, just opens the settings section.
    aliases: ['ai', 'ai settings', 'ai models', 'ai provider', 'ai providers', 'ollama', 'local ai', 'cloud ai'],
    label: 'AI Settings',
    settingsSection: 'ai'
  },
  {
    id: 'extensions',
    // STEP 13 — jump to the Extensions manager. Never executes an extension
    // action; only opens the settings section.
    aliases: ['extensions', 'extension', 'extension settings', 'extension manager', 'manage extensions', 'add-ons', 'addons'],
    label: 'Extensions',
    settingsSection: 'extensions'
  },
  {
    id: 'regional',
    aliases: ['regional', 'regional settings', 'timezone', 'time zone', 'locale', 'language', 'languages', 'region'],
    label: 'Language & Region',
    settingsSection: 'regional'
  },
  { id: 'turbo', aliases: ['turbo', 'turbo mode', 'performance', 'speed', 'fast'], label: 'Turbo Mode', overlay: 'turbo' },
  { id: 'vpn', aliases: ['vpn'], label: 'VPN', overlay: 'vpn' },
  { id: 'worker', aliases: ['worker', 'worker assistant', 'assistant'], label: 'Worker Assistant', panel: 'worker' },
  { id: 'vault', aliases: ['vault', 'passwords', 'saved passwords', 'saved logins', 'fill login', 'autofill'], label: 'Saved Logins', panel: 'vault' }
]

/** Known-service registry — plain https navigation only. */
export const KNOWN_SERVICES: ServiceDef[] = [
  { id: 'gmail', aliases: ['gmail', 'mail', 'google mail'], label: 'Gmail', url: 'https://mail.google.com/' },
  { id: 'drive', aliases: ['drive', 'google drive', 'gdrive'], label: 'Google Drive', url: 'https://drive.google.com/' },
  { id: 'youtube', aliases: ['youtube', 'yt'], label: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'github', aliases: ['github', 'gh'], label: 'GitHub', url: 'https://github.com/' },
  { id: 'chatgpt', aliases: ['chatgpt', 'openai'], label: 'ChatGPT', url: 'https://chat.openai.com/' },
  { id: 'maps', aliases: ['maps', 'google maps'], label: 'Google Maps', url: 'https://maps.google.com/' },
  { id: 'calendar', aliases: ['calendar', 'google calendar', 'gcal'], label: 'Google Calendar', url: 'https://calendar.google.com/' },
  { id: 'wikipedia', aliases: ['wikipedia', 'wiki'], label: 'Wikipedia', url: 'https://www.wikipedia.org/' }
]

/**
 * Page actions — only capabilities that genuinely exist today (P5 summarize/ask,
 * P5.2 observe/scan). Selection-only ops are intentionally excluded here (they remain
 * in the AI panel / palette) so Click-to-Go never offers an action it cannot honor.
 */
export const PAGE_ACTIONS: PageActionDef[] = [
  { id: 'summarize', aliases: ['summarize page', 'summarise page', 'summarize', 'tldr'], label: 'Summarize Page', requires: ['page', 'ai'] },
  { id: 'ask', aliases: ['ask about page', 'ask page', 'ask ai about page'], label: 'Ask About This Page', requires: ['page', 'ai'] },
  { id: 'scan', aliases: ['scan page', 'scan current page', 'observe page'], label: 'Scan Current Page', requires: ['page', 'ai'] },
  { id: 'answer', aliases: ['answer page', 'answer questions', 'worker answer', 'fill form'], label: 'Answer Page Questions', requires: ['page', 'ai'] }
]

/** http(s)-only URL guard on top of the shared navigation helpers. */
export function toSafeHttpUrl(input: string): string | null {
  const t = input.trim()
  if (!t || !looksLikeUrl(t)) return null
  const url = normalizeUrl(t)
  return /^https?:\/\//i.test(url) ? url : null
}

/** alias match score: 0 exact · 1 prefix · 2 substring · null none (lower = better). */
function scoreAliases(aliases: string[], q: string): number | null {
  let best: number | null = null
  for (const a of aliases) {
    if (a === q) return 0
    if (a.startsWith(q)) best = Math.min(best ?? 9, 1)
    else if (a.includes(q)) best = Math.min(best ?? 9, 2)
  }
  return best
}

function requirementsMet(reqs: PageActionRequirement[], ctx: ResolveContext): boolean {
  return reqs.every((r) => (r === 'page' ? ctx.onWebPage : r === 'selection' ? ctx.hasSelection : ctx.aiConnected))
}

const MAX_PER_GROUP = 4

/**
 * Deterministic resolver. Precedence (highest first): explicit http(s) URL → NEXA
 * command → known service → page action → web search. Returns a flat, display-ordered
 * list (URL, NEXA, SERVICES, PAGE, SEARCH); the first item is the default selection.
 */
export function resolveClickToGo(input: string, ctx: ResolveContext): Suggestion[] {
  const q = input.trim()
  if (!q) return []
  const lower = q.toLowerCase()
  const out: Suggestion[] = []

  // 1. Explicit / bare-domain URL (http(s) only).
  const url = toSafeHttpUrl(q)
  if (url) {
    out.push({ key: 'url', kind: 'url', group: 'URL', label: url, sublabel: 'Open URL', url })
  }

  // 2. NEXA commands.
  NEXA_COMMANDS.map((c) => ({ c, s: scoreAliases([...c.aliases, c.label.toLowerCase()], lower) }))
    .filter((x): x is { c: NexaCommandDef; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label))
    .slice(0, MAX_PER_GROUP)
    .forEach(({ c }) =>
      out.push({ key: `cmd:${c.id}`, kind: 'command', group: 'NEXA', label: c.label, sublabel: 'NEXA command', commandId: c.id })
    )

  // 3. Known services.
  KNOWN_SERVICES.map((sv) => ({ sv, s: scoreAliases([...sv.aliases, sv.label.toLowerCase()], lower) }))
    .filter((x): x is { sv: ServiceDef; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.sv.label.localeCompare(b.sv.label))
    .slice(0, MAX_PER_GROUP)
    .forEach(({ sv }) =>
      out.push({ key: `svc:${sv.id}`, kind: 'service', group: 'SERVICES', label: `Open ${sv.label}`, sublabel: 'Service', serviceId: sv.id, url: sv.url })
    )

  // 4. Page actions (only when their capability requirements are met).
  PAGE_ACTIONS.filter((p) => requirementsMet(p.requires, ctx))
    .map((p) => ({ p, s: scoreAliases(p.aliases, lower) }))
    .filter((x): x is { p: PageActionDef; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.p.label.localeCompare(b.p.label))
    .slice(0, MAX_PER_GROUP)
    .forEach(({ p }) =>
      out.push({ key: `page:${p.id}`, kind: 'page_action', group: 'PAGE', label: p.label, sublabel: 'NEXA AI', actionId: p.id })
    )

  // 5. Web search — always offered last (deterministic fallback).
  out.push({
    key: 'search',
    kind: 'search',
    group: 'SEARCH',
    label: `Search “${q}”`,
    sublabel: ctx.searchEngine ? `${ctx.searchEngine} search` : 'Web search',
    query: q
  })

  return out
}
