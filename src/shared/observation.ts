/**
 * NEXA P5.2 — Hybrid Observation model (pure, dependency-free, unit-testable).
 *
 * The renderer captures a RAW observation from the live Chromium page using a
 * fixed, non-model script (DOM + accessibility + semantic HTML). This module
 * turns that raw capture into a BOUNDED, REDACTED, structured PageObservation
 * with an ephemeral "semantic element map" (element_1..element_N).
 *
 * Everything here is a pure string/array transform. It never executes code,
 * touches the DOM, IPC, files, or credentials. Sensitive field values are
 * NEVER carried through — only a `secret` flag survives, never the value.
 *
 * Ephemeral IDs (element_N) are:
 *   - assigned in stable DOM order,
 *   - valid ONLY for the observation that produced them,
 *   - never a permanent DOM identifier,
 *   - never trusted across navigation (a stale id resolves to NOT_FOUND).
 */

/* ------------------------------- Limits ------------------------------- */

export const OBS_MAX_ELEMENTS = 60 // interactive elements exposed to the model
export const OBS_MAX_NAME = 120
export const OBS_MAX_VALUE = 120
export const OBS_MAX_HREF = 300
export const OBS_MAX_DIALOGS = 6
export const OBS_MAX_LINKS = 200
export const OBS_MAX_TABLE_ROWS = 100
export const OBS_MAX_TABLE_COLS = 20
export const OBS_MAX_LIST_ITEMS = 100
export const OBS_MAX_WAIT_LONG_MS = 15_000

/* --------------------------- Sensitive fields --------------------------- */

/**
 * Field names / types that must NEVER expose a value to the model, and whose
 * typing always requires confirmation. Shared with the permission heuristic.
 */
export const SENSITIVE_FIELD_RE =
  /pass\s*word|passwd|\bpwd\b|\botp\b|one[-\s]?time|\btotp\b|\bcvv\b|\bcvc\b|\bpin\b|secret|security\s*code|card\s*number|credit\s*card|\bssn\b|api[-_\s]?key|auth|token|private\s*key|credential/i

export interface RawObservedElement {
  id?: string
  tag?: string
  role?: string
  name?: string
  text?: string
  label?: string
  placeholder?: string
  ariaLabel?: string
  value?: string
  href?: string
  type?: string
  autocomplete?: string
  disabled?: boolean
  checked?: boolean
  selected?: boolean
  required?: boolean
  visible?: boolean
}

export interface ObservedElement {
  /** Ephemeral, observation-scoped id (element_1..N). */
  id: string
  tag: string
  role: string
  /** Best accessible name (label/aria/text/placeholder). Bounded. */
  name: string
  /** Safe current value — OMITTED entirely for secret fields. */
  value?: string
  href?: string
  type?: string
  disabled: boolean
  checked?: boolean
  selected?: boolean
  required?: boolean
  /** True when the field looks like a credential/secret. Value is never included. */
  secret: boolean
  interactive: boolean
}

export interface PageStructure {
  hasHeader: boolean
  hasNav: boolean
  hasMain: boolean
  hasAside: boolean
  hasFooter: boolean
  hasSearch: boolean
  forms: number
  tables: number
  dialogs: number
  landmarks: string[]
}

export interface RawObservation {
  url?: string
  title?: string
  elements?: RawObservedElement[]
  structure?: Partial<PageStructure>
  dialogs?: string[]
}

export interface PageObservation {
  url: string
  title: string
  elements: ObservedElement[]
  structure: PageStructure | null
  dialogs: string[]
  /** True when more interactive elements existed than were exposed. */
  truncated: boolean
  totalElements: number
}

/* ----------------------------- Helpers ----------------------------- */

function clamp(s: unknown, max: number): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex -- intentional control-char sanitization
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select', 'summary', 'option'])
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'tab',
  'switch',
  'option',
  'slider'
])

/** Does this raw element look like a credential/secret field? */
export function isSensitiveField(el: RawObservedElement): boolean {
  const type = clamp(el.type, 40).toLowerCase()
  if (type === 'password') return true
  const auto = clamp(el.autocomplete, 60).toLowerCase()
  if (/current-password|new-password|one-time-code|cc-number|cc-csc/.test(auto)) return true
  const hay = [el.name, el.label, el.ariaLabel, el.placeholder, el.id].map((v) => clamp(v, 120)).join(' ')
  return SENSITIVE_FIELD_RE.test(hay)
}

/** Best accessible name for an element (a11y-first, then text, then placeholder). */
export function accessibleName(el: RawObservedElement): string {
  return clamp(el.ariaLabel || el.label || el.name || el.text || el.placeholder || '', OBS_MAX_NAME)
}

function isInteractive(el: RawObservedElement): boolean {
  const tag = clamp(el.tag, 20).toLowerCase()
  const role = clamp(el.role, 40).toLowerCase()
  if (INTERACTIVE_TAGS.has(tag)) return true
  if (INTERACTIVE_ROLES.has(role)) return true
  return false
}

/* --------------------------- buildObservation --------------------------- */

/**
 * Normalize a raw capture into a bounded, redacted PageObservation with a stable
 * ephemeral element map. Invisible elements are dropped; secret values redacted.
 */
export function buildObservation(raw: RawObservation, opts: { maxElements?: number } = {}): PageObservation {
  const maxElements = Math.max(1, Math.min(OBS_MAX_ELEMENTS, opts.maxElements ?? OBS_MAX_ELEMENTS))
  const rawEls = Array.isArray(raw.elements) ? raw.elements : []
  const visible = rawEls.filter((e) => e && e.visible !== false)
  const totalElements = visible.length
  const sliced = visible.slice(0, maxElements)

  const elements: ObservedElement[] = sliced.map((e, i) => {
    const secret = isSensitiveField(e)
    const tag = clamp(e.tag, 20).toLowerCase() || 'div'
    const role = clamp(e.role, 40).toLowerCase() || defaultRole(tag)
    const el: ObservedElement = {
      id: `element_${i + 1}`,
      tag,
      role,
      name: accessibleName(e),
      disabled: !!e.disabled,
      secret,
      interactive: isInteractive(e)
    }
    if (e.href) {
      const h = clamp(e.href, OBS_MAX_HREF)
      if (/^https?:\/\//i.test(h)) el.href = h
    }
    if (e.type) el.type = clamp(e.type, 40).toLowerCase()
    if (typeof e.checked === 'boolean') el.checked = e.checked
    if (typeof e.selected === 'boolean') el.selected = e.selected
    if (e.required) el.required = true
    // Only expose a value when it is NOT secret.
    if (!secret && e.value != null && e.value !== '') el.value = clamp(e.value, OBS_MAX_VALUE)
    return el
  })

  const dialogs = Array.isArray(raw.dialogs) ? raw.dialogs.map((d) => clamp(d, 160)).filter(Boolean).slice(0, OBS_MAX_DIALOGS) : []

  return {
    url: clamp(raw.url, 2048),
    title: clamp(raw.title, 300),
    elements,
    structure: raw.structure ? normalizeStructure(raw.structure) : null,
    dialogs,
    truncated: totalElements > sliced.length,
    totalElements
  }
}

function defaultRole(tag: string): string {
  switch (tag) {
    case 'a':
      return 'link'
    case 'button':
      return 'button'
    case 'select':
      return 'combobox'
    case 'textarea':
      return 'textbox'
    case 'input':
      return 'textbox'
    default:
      return tag
  }
}

function normalizeStructure(s: Partial<PageStructure>): PageStructure {
  return {
    hasHeader: !!s.hasHeader,
    hasNav: !!s.hasNav,
    hasMain: !!s.hasMain,
    hasAside: !!s.hasAside,
    hasFooter: !!s.hasFooter,
    hasSearch: !!s.hasSearch,
    forms: Math.max(0, Math.min(999, Number(s.forms) || 0)),
    tables: Math.max(0, Math.min(999, Number(s.tables) || 0)),
    dialogs: Math.max(0, Math.min(999, Number(s.dialogs) || 0)),
    landmarks: Array.isArray(s.landmarks) ? s.landmarks.map((l) => clamp(l, 40)).filter(Boolean).slice(0, 20) : []
  }
}

/* --------------------------- formatObservation --------------------------- */

/** Compact, bounded, model-facing rendering of an observation. */
export function formatObservation(obs: PageObservation, maxChars = 6000): string {
  const lines: string[] = []
  lines.push(`URL: ${obs.url || 'about:blank'}`)
  lines.push(`Title: ${obs.title || '(untitled)'}`)
  if (obs.structure) {
    const s = obs.structure
    const parts = [
      s.hasHeader && 'header',
      s.hasNav && 'nav',
      s.hasMain && 'main',
      s.hasAside && 'sidebar',
      s.hasFooter && 'footer',
      s.hasSearch && 'search'
    ].filter(Boolean)
    lines.push(`Structure: ${parts.join(', ') || 'none'} · forms:${s.forms} tables:${s.tables} dialogs:${s.dialogs}`)
  }
  if (obs.dialogs.length) lines.push(`Dialogs: ${obs.dialogs.join(' | ')}`)
  lines.push(`Interactive elements (${obs.elements.length}${obs.truncated ? ` of ${obs.totalElements}, truncated` : ''}):`)
  for (const e of obs.elements) {
    const bits = [`${e.id}`, e.role, e.name ? `"${e.name}"` : '']
    if (e.type && e.type !== e.role) bits.push(`type=${e.type}`)
    if (e.secret) bits.push('[SECRET — value hidden]')
    else if (e.value) bits.push(`value="${e.value}"`)
    if (e.disabled) bits.push('(disabled)')
    if (e.checked) bits.push('(checked)')
    if (e.required) bits.push('(required)')
    if (e.href) bits.push(`-> ${e.href}`)
    lines.push('- ' + bits.filter(Boolean).join(' '))
  }
  return lines.join('\n').slice(0, maxChars)
}

/* --------------------------- Target resolution --------------------------- */

export type ResolveStatus = 'EXACT' | 'STRONG' | 'AMBIGUOUS' | 'NOT_FOUND'

export interface ResolveTarget {
  eid?: string
  role?: string
  name?: string
  text?: string
  label?: string
  placeholder?: string
  index?: number
}

export interface ResolveResult {
  status: ResolveStatus
  element?: ObservedElement
  /** Present for AMBIGUOUS (all tied candidates) or empty otherwise. */
  candidates: ObservedElement[]
}

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Resolve a semantic target against a bounded element list. Never guesses: when
 * multiple elements tie at the top score, returns AMBIGUOUS instead of picking.
 */
export function resolveTarget(elements: ObservedElement[], target: ResolveTarget): ResolveResult {
  if (!Array.isArray(elements) || elements.length === 0) return { status: 'NOT_FOUND', candidates: [] }

  // 1) Ephemeral id is authoritative (produced by the latest observation).
  if (target.eid) {
    const el = elements.find((e) => e.id === target.eid)
    return el ? { status: 'EXACT', element: el, candidates: [] } : { status: 'NOT_FOUND', candidates: [] }
  }

  const wantRole = norm(target.role)
  let pool = elements
  if (wantRole) pool = pool.filter((e) => norm(e.role) === wantRole || norm(e.tag) === wantRole)

  const want = norm(target.name || target.text || target.label || target.placeholder || '')

  // Role-only, no text: unique → STRONG, many → AMBIGUOUS.
  if (!want) {
    if (pool.length === 0) return { status: 'NOT_FOUND', candidates: [] }
    if (typeof target.index === 'number' && pool[target.index]) return { status: 'EXACT', element: pool[target.index], candidates: [] }
    if (pool.length === 1) return { status: 'STRONG', element: pool[0], candidates: [] }
    return { status: 'AMBIGUOUS', candidates: pool.slice(0, 10) }
  }

  const scoreOf = (e: ObservedElement): number => {
    const cands = [e.name, e.value].map(norm).filter(Boolean)
    let best = 0
    for (const c of cands) {
      if (c === want) best = Math.max(best, 4)
      else if (c.startsWith(want)) best = Math.max(best, 3)
      else if (c.includes(want)) best = Math.max(best, 2)
    }
    return best
  }

  const scored = pool
    .map((e) => ({ e, s: scoreOf(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  if (scored.length === 0) return { status: 'NOT_FOUND', candidates: [] }

  if (typeof target.index === 'number' && scored[target.index]) {
    return { status: 'EXACT', element: scored[target.index].e, candidates: [] }
  }

  const top = scored[0].s
  const tied = scored.filter((x) => x.s === top)
  if (tied.length > 1) return { status: 'AMBIGUOUS', candidates: tied.map((x) => x.e).slice(0, 10) }

  return { status: top >= 4 ? 'EXACT' : 'STRONG', element: scored[0].e, candidates: [] }
}

/* --------------------------- Link sanitization --------------------------- */

/**
 * Filter/normalize extracted links: keep only http(s), drop javascript:/data:/
 * file:/unknown schemes, dedupe, bound. Never returns an executable URL.
 */
export function sanitizeExtractedLinks(
  links: { text?: string; href?: string; rel?: string; target?: string; visible?: boolean }[]
): { text: string; href: string; rel?: string; target?: string }[] {
  const seen = new Set<string>()
  const out: { text: string; href: string; rel?: string; target?: string }[] = []
  for (const l of Array.isArray(links) ? links : []) {
    const href = clamp(l?.href, OBS_MAX_HREF)
    if (!/^https?:\/\//i.test(href)) continue // blocks javascript:, data:, file:, mailto:, etc.
    if (seen.has(href)) continue
    seen.add(href)
    const rec: { text: string; href: string; rel?: string; target?: string } = { text: clamp(l?.text, 200), href }
    if (l?.rel) rec.rel = clamp(l.rel, 60)
    if (l?.target) rec.target = clamp(l.target, 40)
    out.push(rec)
    if (out.length >= OBS_MAX_LINKS) break
  }
  return out
}

/* --------------------------- Vision support --------------------------- */

/**
 * Honest capability check: which locally-installed models can interpret images.
 * Text-only models (e.g. qwen3, llama3, mistral, gemma text variants) return
 * false → the visual tool reports VISION NOT CONFIGURED instead of faking it.
 */
const VISION_CAPABLE_RE = /(llava|bakllava|llama3\.2-vision|llama-3\.2-vision|moondash|moondream|minicpm-v|qwen2?\.?5?-vl|qwen-vl|qwen2-vl|qwen3-vl|gemma3|pixtral|granite3\.2-vision|internvl)/i

export function visionSupported(model: string | undefined | null): boolean {
  if (!model) return false
  return VISION_CAPABLE_RE.test(model)
}
