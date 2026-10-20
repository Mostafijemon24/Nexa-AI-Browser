/**
 * NEXA P5 STEP 5 — Worker Assistant (pure, dependency-light, unit-testable).
 *
 * This module is the DETERMINISTIC core of the Worker Assistant. It never
 * touches the DOM, IPC, files, credentials, the network, or the model. It only
 * transforms an already-bounded, already-redacted PageObservation (produced by
 * the existing P5.2 `buildObservation`) into a structured WorkerScan, builds
 * injection-safe AI messages for answer suggestions, and computes deterministic,
 * permission-aware fill decisions.
 *
 * SECURITY / SAFETY INVARIANTS (enforced + tested):
 *  - Secret/credential field VALUES never appear here (the observation already
 *    strips them; we only carry a `secret` flag). We never emit a secret value
 *    into AI context, suggestions, task history, or logs.
 *  - Page text is UNTRUSTED DATA. Suggestion prompts fence it with the existing
 *    `wrapUntrusted` + `INJECTION_GUARD`; a page can never become an instruction.
 *  - The Worker NEVER submits, sends, purchases, deletes, or clicks final action
 *    buttons. High-impact buttons are classified for display only and are never
 *    executable. Writes to sensitive fields are always confirmation-gated.
 *  - Ephemeral ids (question_N/field_N/option_group_N/button_N) are page/session
 *    scoped and are NOT persistent DOM identifiers. Field targeting uses the
 *    observation's ephemeral `eid` via the existing semantic resolver.
 */
import type { AiMessage } from './ai'
import { clampContext } from './ai'
import type { AgentMode } from './agent'
import type { ObservedElement, PageObservation } from './observation'
import { INJECTION_GUARD, wrapUntrusted } from './page-content'

/* -------------------------------- Limits -------------------------------- */

export const WORKER_MAX_QUESTIONS = 30
export const WORKER_MAX_FIELDS = 40
export const WORKER_MAX_OPTION_GROUPS = 20
export const WORKER_MAX_OPTIONS_PER_GROUP = 40
export const WORKER_MAX_BUTTONS = 20
export const WORKER_MAX_QUESTION_CHARS = 300
export const WORKER_MAX_ANSWER_CHARS = 1200
export const WORKER_MAX_CONTEXT_CHARS = 6000
export const WORKER_MAX_LABEL_CHARS = 160

/* ------------------------------- Types --------------------------------- */

export type WorkerState =
  | 'idle'
  | 'scanning'
  | 'scanned'
  | 'generating'
  | 'ready'
  | 'filling'
  | 'review'
  | 'blocked'
  | 'error'

export type WorkerFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'url'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'password'
  | 'unknown'

/** Buttons are classified for DISPLAY only; the Worker never clicks them. */
export type WorkerButtonClass =
  | 'navigation'
  | 'secondary'
  | 'save'
  | 'continue'
  | 'submit'
  | 'send'
  | 'purchase'
  | 'delete'
  | 'unknown'

export type WorkerQuestionSource = 'label' | 'legend' | 'heading' | 'placeholder' | 'aria' | 'text' | 'pattern'

export interface WorkerQuestion {
  id: string
  text: string
  source: WorkerQuestionSource
  /** The field this question maps to (if any) — used for filling. */
  fieldId?: string
}

export interface WorkerField {
  id: string
  /** Ephemeral observation element id (element_N) for semantic targeting. */
  eid: string
  type: WorkerFieldType
  label: string
  required: boolean
  /** True for credential/secret fields. The VALUE is never carried. */
  secret: boolean
  /** Current non-secret value, if any (never present for secret fields). */
  value?: string
}

export interface WorkerOption {
  eid: string
  label: string
  checked: boolean
}

export interface WorkerOptionGroup {
  id: string
  kind: 'radio' | 'checkbox' | 'select'
  label: string
  options: WorkerOption[]
}

export interface WorkerButton {
  id: string
  eid: string
  label: string
  classification: WorkerButtonClass
  /** Submit/send/purchase/delete — never auto-actioned; confirmation required. */
  highImpact: boolean
}

export interface WorkerScan {
  url: string
  title: string
  questions: WorkerQuestion[]
  fields: WorkerField[]
  optionGroups: WorkerOptionGroup[]
  buttons: WorkerButton[]
  counts: {
    questions: number
    fields: number
    optionGroups: number
    options: number
    buttons: number
  }
  truncated: boolean
}

export type WorkerAnswerSource = 'LOCAL_AI' | 'USER_CONTEXT' | 'PAGE_CONTEXT' | 'COMBINED'
export type WorkerConfidence = 'low' | 'medium' | 'high'

export interface WorkerAnswer {
  id: string
  questionId: string
  suggestedText: string
  confidence: WorkerConfidence
  source: WorkerAnswerSource
  editable: boolean
}

/** Optional, explicitly user-controlled context (never inferred from browsing). */
export interface WorkerUserContext {
  name?: string
  title?: string
  skills?: string
  experience?: string
  company?: string
  writingStyle?: string
  /** STEP 10 — short, honest regional descriptor (locale/timezone/formats). */
  regional?: string
}

/** Extra, structured raw captured by the live scanner (never page prose). */
export interface WorkerRawExtras {
  /** Radio/checkbox controls with their form-control group name for grouping. */
  choices?: { eid: string; kind: 'radio' | 'checkbox'; label: string; checked: boolean; group: string }[]
  /** Selects with their option label list. */
  selects?: { eid: string; label: string; options: string[] }[]
  /** Candidate standalone question texts (labels/legends/headings). */
  texts?: string[]
}

/** A single deterministic fill action derived from an approved answer. */
export interface WorkerFillAction {
  questionId: string
  fieldId: string
  eid: string
  type: WorkerFieldType
  value: string
  /** 'type' | 'select_option' | 'set_checkbox' — maps to an EXISTING agent tool. */
  tool: 'type' | 'select_option' | 'set_checkbox'
  /** 'auto' (execute now), 'confirm' (needs explicit user OK), 'block' (not allowed). */
  decision: 'auto' | 'confirm' | 'block'
  secret: boolean
}

/* --------------------------- Text normalization -------------------------- */

export function normalizeText(s: unknown, max = WORKER_MAX_QUESTION_CHARS): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex -- intentional control-char sanitization
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/* --------------------------- Field/button typing ------------------------- */

export function fieldTypeOf(el: ObservedElement): WorkerFieldType {
  if (el.secret || el.type === 'password') return 'password'
  const tag = (el.tag || '').toLowerCase()
  const role = (el.role || '').toLowerCase()
  const type = (el.type || '').toLowerCase()
  if (tag === 'textarea') return 'textarea'
  if (tag === 'select' || role === 'combobox') return 'select'
  if (type === 'checkbox' || role === 'checkbox') return 'checkbox'
  if (type === 'radio' || role === 'radio') return 'radio'
  if (type === 'email') return 'email'
  if (type === 'tel') return 'tel'
  if (type === 'number') return 'number'
  if (type === 'date') return 'date'
  if (type === 'url') return 'url'
  if (tag === 'input' || tag === 'textarea' || role === 'textbox' || role === 'searchbox') return 'text'
  return 'unknown'
}

const FILLABLE_TEXT_TYPES: WorkerFieldType[] = ['text', 'textarea', 'email', 'tel', 'number', 'date', 'url']

/** Which existing agent tool fills this field type (null → not fillable). */
export function toolForFieldType(t: WorkerFieldType): WorkerFillAction['tool'] | null {
  if (FILLABLE_TEXT_TYPES.includes(t)) return 'type'
  if (t === 'select') return 'select_option'
  if (t === 'checkbox' || t === 'radio') return 'set_checkbox'
  return null
}

/** High-impact = irreversible/consequential. Never auto-clicked (never clicked at all). */
export function isHighImpactButtonClass(c: WorkerButtonClass): boolean {
  return c === 'submit' || c === 'send' || c === 'purchase' || c === 'delete'
}

export function classifyButton(label: string): WorkerButtonClass {
  const s = normalizeText(label, 80).toLowerCase()
  if (!s) return 'unknown'
  if (/\b(buy|purchase|order now|place order|checkout|check ?out|pay|payment|subscribe|donate)\b/.test(s)) return 'purchase'
  if (/\b(delete|remove|discard|trash|erase|destroy)\b/.test(s)) return 'delete'
  if (/\b(submit|apply|register|sign ?up|create account|publish|post job)\b/.test(s)) return 'submit'
  if (/\b(send|post|reply|comment|tweet|share|message)\b/.test(s)) return 'send'
  if (/\b(save|update|save changes|confirm changes)\b/.test(s)) return 'save'
  if (/\b(continue|next|proceed|step)\b/.test(s)) return 'continue'
  if (/\b(back|previous|prev|home|menu|skip|cancel|close|dismiss)\b/.test(s)) return 'navigation'
  return 'secondary'
}

/** Does a field name read like a question/prompt worth suggesting an answer for? */
function looksLikeQuestion(label: string): boolean {
  const s = label.trim()
  if (s.length < 3) return false
  if (s.endsWith('?')) return true
  return /\b(what|why|how|when|where|who|which|describe|explain|tell us|your|about|experience|reason|summary|cover letter|message|comment|bio|introduce)\b/i.test(s)
}

/* ------------------------------ Scanner --------------------------------- */

const TEXT_INPUT_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'number', 'date', 'url', 'password'])

function isFormFieldElement(el: ObservedElement): boolean {
  const t = fieldTypeOf(el)
  return TEXT_INPUT_TYPES.has(t) || t === 'select'
}

/**
 * Turn a bounded/redacted PageObservation (+ optional structured extras) into a
 * deterministic WorkerScan. Duplicate questions are removed; everything bounded.
 */
export function scanObservation(obs: PageObservation, extras: WorkerRawExtras = {}): WorkerScan {
  const elements = Array.isArray(obs?.elements) ? obs.elements : []

  /* Fields (text-like + selects). */
  const fields: WorkerField[] = []
  for (const el of elements) {
    if (fields.length >= WORKER_MAX_FIELDS) break
    if (!isFormFieldElement(el)) continue
    const type = fieldTypeOf(el)
    const f: WorkerField = {
      id: `field_${fields.length + 1}`,
      eid: el.id,
      type,
      label: normalizeText(el.name, WORKER_MAX_LABEL_CHARS),
      required: !!el.required,
      secret: !!el.secret
    }
    if (!el.secret && el.value) f.value = normalizeText(el.value, WORKER_MAX_LABEL_CHARS)
    fields.push(f)
  }

  /* Questions: from field labels that read like prompts + provided candidate texts. */
  const questions: WorkerQuestion[] = []
  const seen = new Set<string>()
  const pushQuestion = (text: string, source: WorkerQuestionSource, fieldId?: string) => {
    if (questions.length >= WORKER_MAX_QUESTIONS) return
    const t = normalizeText(text, WORKER_MAX_QUESTION_CHARS)
    if (t.length < 3) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    questions.push({ id: `question_${questions.length + 1}`, text: t, source, ...(fieldId ? { fieldId } : {}) })
  }
  for (const f of fields) {
    if (f.secret) continue
    if (f.label && looksLikeQuestion(f.label)) pushQuestion(f.label, 'label', f.id)
  }
  for (const raw of extras.texts || []) {
    const t = normalizeText(raw, WORKER_MAX_QUESTION_CHARS)
    if (looksLikeQuestion(t)) pushQuestion(t, 'text')
  }

  /* Option groups: radios/checkboxes grouped by form-control name (from extras),
     falling back to observation elements grouped by kind. Selects from extras. */
  const optionGroups: WorkerOptionGroup[] = []
  const choices = extras.choices
  if (choices && choices.length) {
    const byGroup = new Map<string, { kind: 'radio' | 'checkbox'; label: string; opts: WorkerOption[] }>()
    for (const c of choices) {
      const gkey = `${c.kind}:${normalizeText(c.group, 80).toLowerCase() || '(ungrouped)'}`
      let g = byGroup.get(gkey)
      if (!g) {
        g = { kind: c.kind, label: normalizeText(c.group, WORKER_MAX_LABEL_CHARS) || (c.kind === 'radio' ? 'Options' : 'Checkboxes'), opts: [] }
        byGroup.set(gkey, g)
      }
      if (g.opts.length < WORKER_MAX_OPTIONS_PER_GROUP) g.opts.push({ eid: c.eid, label: normalizeText(c.label, WORKER_MAX_LABEL_CHARS), checked: !!c.checked })
    }
    for (const g of byGroup.values()) {
      if (optionGroups.length >= WORKER_MAX_OPTION_GROUPS) break
      optionGroups.push({ id: `option_group_${optionGroups.length + 1}`, kind: g.kind, label: g.label, options: g.opts })
    }
  } else {
    const radios = elements.filter((e) => fieldTypeOf(e) === 'radio')
    const checks = elements.filter((e) => fieldTypeOf(e) === 'checkbox')
    if (radios.length) optionGroups.push({ id: `option_group_${optionGroups.length + 1}`, kind: 'radio', label: 'Options', options: radios.slice(0, WORKER_MAX_OPTIONS_PER_GROUP).map((e) => ({ eid: e.id, label: normalizeText(e.name, WORKER_MAX_LABEL_CHARS), checked: !!e.checked })) })
    if (checks.length) optionGroups.push({ id: `option_group_${optionGroups.length + 1}`, kind: 'checkbox', label: 'Checkboxes', options: checks.slice(0, WORKER_MAX_OPTIONS_PER_GROUP).map((e) => ({ eid: e.id, label: normalizeText(e.name, WORKER_MAX_LABEL_CHARS), checked: !!e.checked })) })
  }
  for (const s of extras.selects || []) {
    if (optionGroups.length >= WORKER_MAX_OPTION_GROUPS) break
    optionGroups.push({
      id: `option_group_${optionGroups.length + 1}`,
      kind: 'select',
      label: normalizeText(s.label, WORKER_MAX_LABEL_CHARS) || 'Select',
      options: (s.options || []).slice(0, WORKER_MAX_OPTIONS_PER_GROUP).map((o) => ({ eid: s.eid, label: normalizeText(o, WORKER_MAX_LABEL_CHARS), checked: false }))
    })
  }

  /* Buttons: classification for display only. */
  const buttons: WorkerButton[] = []
  for (const el of elements) {
    if (buttons.length >= WORKER_MAX_BUTTONS) break
    const role = (el.role || '').toLowerCase()
    const tag = (el.tag || '').toLowerCase()
    const isBtn = tag === 'button' || role === 'button' || (tag === 'input' && (el.type === 'submit' || el.type === 'button')) || role === 'link' || tag === 'a'
    if (!isBtn) continue
    const label = normalizeText(el.name, WORKER_MAX_LABEL_CHARS)
    if (!label) continue
    const classification = classifyButton(label)
    buttons.push({ id: `button_${buttons.length + 1}`, eid: el.id, label, classification, highImpact: isHighImpactButtonClass(classification) })
  }

  const options = optionGroups.reduce((n, g) => n + g.options.length, 0)
  return {
    url: obs?.url || '',
    title: obs?.title || '',
    questions,
    fields,
    optionGroups,
    buttons,
    counts: { questions: questions.length, fields: fields.length, optionGroups: optionGroups.length, options, buttons: buttons.length },
    truncated: !!obs?.truncated
  }
}

/* --------------------------- Answer suggestion --------------------------- */

export const WORKER_SUGGEST_SYSTEM = [
  "You are NEXA's local Worker Assistant. You help the user draft answers to a form question on the current web page.",
  'Write a single, concise, ready-to-use answer in the first person where appropriate. Output ONLY the answer text — no preamble, no quotes, no markdown headings, no explanation.',
  'Use the provided user context when relevant and truthful; never invent credentials, employers, dates, or personal facts that were not provided.',
  INJECTION_GUARD
].join(' ')

function userContextBlock(ctx?: WorkerUserContext): string {
  if (!ctx) return ''
  const parts = [
    ctx.name && `Name: ${ctx.name}`,
    ctx.title && `Title: ${ctx.title}`,
    ctx.company && `Company: ${ctx.company}`,
    ctx.skills && `Skills: ${ctx.skills}`,
    ctx.experience && `Experience: ${ctx.experience}`,
    ctx.writingStyle && `Preferred writing style: ${ctx.writingStyle}`,
    ctx.regional && ctx.regional
  ]
    .filter(Boolean)
    .map((l) => normalizeText(l, 400))
  return parts.length ? `User-provided context (trusted, use if relevant):\n${parts.join('\n')}\n\n` : ''
}

/**
 * Build injection-safe AI messages to suggest an answer for one question. Page
 * text is fenced as untrusted data. Only the minimum context is included — never
 * secrets, cookies, tokens, or unrelated private page data.
 */
export function buildWorkerSuggestionMessages(input: {
  question: string
  fieldType?: WorkerFieldType
  pageTitle?: string
  pageContext?: string
  nearbyContext?: string
  userContext?: WorkerUserContext
}): AiMessage[] {
  const question = normalizeText(input.question, WORKER_MAX_QUESTION_CHARS)
  const fieldHint = input.fieldType && input.fieldType !== 'unknown' ? `Field type: ${input.fieldType}.\n` : ''
  const title = input.pageTitle ? `Page: ${normalizeText(input.pageTitle, 200)}\n` : ''
  const nearby = input.nearbyContext ? `Nearby context: ${normalizeText(input.nearbyContext, 600)}\n` : ''
  const page = input.pageContext ? `Relevant page content (untrusted):\n${wrapUntrusted(clampContext(input.pageContext, WORKER_MAX_CONTEXT_CHARS))}\n\n` : ''
  const uctx = userContextBlock(input.userContext)
  return [
    { role: 'system', content: WORKER_SUGGEST_SYSTEM },
    { role: 'user', content: `${uctx}${title}${fieldHint}${nearby}${page}Question to answer:\n${question}\n\nWrite the answer:` }
  ]
}

/**
 * Sanitize a model suggestion into a safe, bounded, ready-to-use answer. Strips
 * fence markers, surrounding quotes, and obvious preamble; clamps length.
 */
export function sanitizeSuggestion(raw: string): string {
  let s = String(raw ?? '')
    .replace(/<<<\s*(END_)?NEXA_UNTRUSTED_PAGE_CONTENT\s*>>>/gi, '')
    // eslint-disable-next-line no-control-regex -- intentional control-char sanitization
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
  // Drop a single common preamble line like "Answer:" / "Here is ...:".
  s = s.replace(/^(sure[,!.]?\s*)?(here('|’)s|here is|answer|response)\b[^\n:]*:\s*/i, '').trim()
  // Strip wrapping quotes.
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim()
  }
  return s.slice(0, WORKER_MAX_ANSWER_CHARS)
}

/* ---------------------- Permission-aware fill model ---------------------- */

/**
 * Deterministic write decision for a field, mirroring the existing agent
 * permission model (ASK read-only; ASSIST confirm every write; AGENT auto for
 * low-risk, confirm for sensitive). NEVER 'auto' for secret fields.
 */
export function workerFillDecision(mode: AgentMode, field: Pick<WorkerField, 'secret' | 'type'>): 'auto' | 'confirm' | 'block' {
  if (mode === 'ask') return 'block' // read-only
  if (field.secret || field.type === 'password') return 'confirm' // never auto
  if (mode === 'assist') return 'confirm' // every modification confirmation-gated
  return 'auto' // agent mode, non-sensitive
}

/**
 * Build the deterministic fill plan for a set of approved answers. Each action
 * maps to an EXISTING agent tool (type/select_option/set_checkbox) targeted by
 * the field's ephemeral eid. Never produces a submit/click action.
 */
export function buildFillPlan(
  mode: AgentMode,
  fields: WorkerField[],
  approved: { fieldId: string; questionId: string; value: string }[]
): WorkerFillAction[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const out: WorkerFillAction[] = []
  for (const a of approved) {
    const field = byId.get(a.fieldId)
    if (!field) continue
    const tool = toolForFieldType(field.type)
    if (!tool) continue
    const value = tool === 'set_checkbox' ? String(a.value) : normalizeText(a.value, WORKER_MAX_ANSWER_CHARS)
    out.push({
      questionId: a.questionId,
      fieldId: field.id,
      eid: field.eid,
      type: field.type,
      value,
      tool,
      decision: workerFillDecision(mode, field),
      secret: field.secret
    })
  }
  return out
}
