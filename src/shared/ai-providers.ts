/**
 * STEP 12 — NEXA Multi-Provider AI: pure shared core.
 *
 * This module is the provider-agnostic heart of the AI platform. It is pure
 * (no I/O, no network, no Electron, no secrets) and fully deterministic, so the
 * routing / privacy / capability / context / cost logic is unit-testable.
 *
 * Design invariants:
 *   - Local-first, privacy-first. Cloud is opt-in and never a silent fallback.
 *   - The model never chooses the provider — routing is deterministic here.
 *   - Capability is reported honestly ('unknown' rather than a false claim).
 *   - No secrets ever appear in these types (renderer-safe metadata only).
 */

import { z } from 'zod'

/* ------------------------------- Providers -------------------------------- */

export type AIProviderId = 'nexa' | 'ollama' | 'openai' | 'anthropic'
export type AIProviderType = 'local' | 'cloud'

export const KNOWN_PROVIDER_IDS: AIProviderId[] = ['nexa', 'ollama', 'openai', 'anthropic']

export interface AIProviderMeta {
  id: AIProviderId
  name: string
  type: AIProviderType
  /** Locked HTTPS host for cloud providers (loopback for local). Never user-set. */
  endpoint: string
  /** Managed by the NEXA AI Gateway: no client-held provider key. */
  managed?: boolean
}

export const PROVIDER_META: Record<AIProviderId, AIProviderMeta> = {
  // The gateway origin is deployment configuration, resolved in the main process.
  nexa: { id: 'nexa', name: 'NEXA AI', type: 'cloud', endpoint: '', managed: true },
  ollama: { id: 'ollama', name: 'Ollama', type: 'local', endpoint: 'http://127.0.0.1:11434' },
  openai: { id: 'openai', name: 'OpenAI', type: 'cloud', endpoint: 'https://api.openai.com' },
  anthropic: { id: 'anthropic', name: 'Anthropic', type: 'cloud', endpoint: 'https://api.anthropic.com' }
}

export function isKnownProvider(id: unknown): id is AIProviderId {
  return typeof id === 'string' && (KNOWN_PROVIDER_IDS as string[]).includes(id)
}

export function providerType(id: AIProviderId): AIProviderType {
  return PROVIDER_META[id].type
}

export function isManagedProvider(id: AIProviderId): boolean {
  return !!PROVIDER_META[id].managed
}

/** Reject any endpoint that is not the locked host for the given provider. */
export function assertKnownHost(id: AIProviderId, url: string): void {
  const expected = PROVIDER_META[id].endpoint
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error('invalid_endpoint')
  }
  const e = new URL(expected)
  if (u.protocol !== e.protocol || u.host !== e.host) throw new Error('invalid_endpoint')
}

/* ------------------------------ Capabilities ------------------------------ */

export type AICapability = 'chat' | 'streaming' | 'tools' | 'vision' | 'embeddings' | 'reasoning'
export const AI_CAPABILITIES: AICapability[] = ['chat', 'streaming', 'tools', 'vision', 'embeddings', 'reasoning']

/** Honest capability support: never fabricate a positive. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown'

export type AICapabilities = Record<AICapability, CapabilitySupport>

export function emptyCapabilities(fill: CapabilitySupport = 'unknown'): AICapabilities {
  return { chat: fill, streaming: fill, tools: fill, vision: fill, embeddings: fill, reasoning: fill }
}

/* --------------------------------- Health --------------------------------- */

export type AIProviderHealthState =
  | 'CONNECTED'
  | 'CHECKING'
  | 'OFFLINE' // generic offline
  | 'LOCAL_OFFLINE' // local runtime not running
  | 'NETWORK_OFFLINE' // no internet for a cloud provider
  | 'NOT_CONFIGURED'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED'
  | 'ERROR'

export interface AIProviderHealth {
  state: AIProviderHealthState
  /** Sanitized, user-safe note. Never contains secrets. */
  note?: string
  checkedAt?: number
}

/** A provider is usable for routing only when it reports CONNECTED. */
export function isHealthy(h: AIProviderHealth | undefined): boolean {
  return h?.state === 'CONNECTED'
}

/* --------------------------------- Models --------------------------------- */

export interface AIModelCost {
  inputPerMillionTokens?: number
  outputPerMillionTokens?: number
}

export interface AIModelInfo {
  id: string
  providerId: AIProviderId
  displayName: string
  capabilities: AICapabilities
  contextWindow?: number
  maxOutputTokens?: number
  local: boolean
  /** Only present when pricing is actually known. Never invented. */
  cost?: AIModelCost
}

export function modelCapability(model: AIModelInfo | undefined, cap: AICapability): CapabilitySupport {
  return model?.capabilities?.[cap] ?? 'unknown'
}

export function modelSupports(model: AIModelInfo | undefined, cap: AICapability): boolean {
  return modelCapability(model, cap) === 'supported'
}

/**
 * Normalized capability detection for a local (Ollama) model, from the runtime
 * `/api/show` capability list. Never assumes: unlisted → 'unknown', embedding
 * models are chat-'unsupported'.
 */
export function ollamaModelCapabilities(input: { capabilities?: string[]; embedding?: boolean; name?: string }): AICapabilities {
  const caps = (input.capabilities || []).map((c) => c.toLowerCase())
  const isEmbed = !!input.embedding || caps.includes('embedding') || /embed/i.test(input.name || '')
  const has = (c: string) => caps.includes(c)
  return {
    chat: isEmbed ? 'unsupported' : has('completion') || has('chat') ? 'supported' : 'unknown',
    streaming: isEmbed ? 'unsupported' : 'supported', // Ollama chat always streams
    tools: has('tools') ? 'supported' : 'unknown',
    vision: has('vision') ? 'supported' : caps.length ? 'unsupported' : 'unknown',
    embeddings: isEmbed ? 'supported' : 'unsupported',
    reasoning: has('thinking') || has('reasoning') ? 'supported' : 'unknown'
  }
}

/* ----------------------- Known cloud model catalog ------------------------ */
/* Capabilities/costs are published provider metadata. Pricing is USD per 1M
 * tokens as documented by the provider; omitted when not reliably known. These
 * are informational only (no billing, no telemetry). */

export const CLOUD_MODELS: AIModelInfo[] = [
  {
    id: 'gpt-4o',
    providerId: 'openai',
    displayName: 'GPT-4o',
    local: false,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { chat: 'supported', streaming: 'supported', tools: 'supported', vision: 'supported', embeddings: 'unsupported', reasoning: 'unknown' },
    cost: { inputPerMillionTokens: 2.5, outputPerMillionTokens: 10 }
  },
  {
    id: 'gpt-4o-mini',
    providerId: 'openai',
    displayName: 'GPT-4o mini',
    local: false,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { chat: 'supported', streaming: 'supported', tools: 'supported', vision: 'supported', embeddings: 'unsupported', reasoning: 'unknown' },
    cost: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6 }
  },
  {
    id: 'text-embedding-3-small',
    providerId: 'openai',
    displayName: 'Text Embedding 3 Small',
    local: false,
    capabilities: { chat: 'unsupported', streaming: 'unsupported', tools: 'unsupported', vision: 'unsupported', embeddings: 'supported', reasoning: 'unsupported' },
    cost: { inputPerMillionTokens: 0.02 }
  },
  {
    id: 'claude-3-5-sonnet-latest',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    local: false,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    capabilities: { chat: 'supported', streaming: 'supported', tools: 'supported', vision: 'supported', embeddings: 'unsupported', reasoning: 'unknown' },
    cost: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 }
  },
  {
    id: 'claude-3-5-haiku-latest',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    local: false,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    capabilities: { chat: 'supported', streaming: 'supported', tools: 'supported', vision: 'unsupported', embeddings: 'unsupported', reasoning: 'unknown' },
    cost: { inputPerMillionTokens: 0.8, outputPerMillionTokens: 4 }
  }
]

export function cloudModelsFor(id: AIProviderId): AIModelInfo[] {
  return CLOUD_MODELS.filter((m) => m.providerId === id)
}

export function defaultCloudChatModel(id: AIProviderId): string | undefined {
  if (id === 'openai') return 'gpt-4o-mini'
  if (id === 'anthropic') return 'claude-3-5-haiku-latest'
  return undefined
}

/* --------------------------- Non-secret provider -------------------------- */
/* Everything the renderer is allowed to see. Never includes API keys. */

export interface AIProviderInfo {
  id: AIProviderId
  name: string
  type: AIProviderType
  configured: boolean
  health: AIProviderHealthState
  note?: string
  defaultModel?: string
  models: AIModelInfo[]
}

/* --------------------------- Privacy & fallback --------------------------- */

export type AIPrivacyMode = 'local_only' | 'local_preferred' | 'cloud_allowed'
export type AIFallbackPolicy = 'none' | 'local_only' | 'configured_provider'

export interface ProfileAIConfig {
  providerId: AIProviderId
  model?: string
  embedProviderId: AIProviderId
  embedModel?: string
  privacyMode: AIPrivacyMode
  fallback: AIFallbackPolicy
  temperature?: number
  contextLimit?: number
  /** Vision preference: 'auto' uses the model if capable; 'off' disables it. */
  vision: 'auto' | 'off'
}

/**
 * Out-of-the-box: NEXA Free AI through the NEXA AI Gateway (no key, no setup),
 * falling back only to local Ollama. Embeddings stay local. Private tabs are
 * forced to local-only routing by AIService regardless of this config.
 */
export function defaultProfileAIConfig(): ProfileAIConfig {
  return {
    providerId: 'nexa',
    model: 'free',
    embedProviderId: 'ollama',
    privacyMode: 'cloud_allowed',
    fallback: 'local_only',
    vision: 'auto'
  }
}

const privacyModeSchema = z.enum(['local_only', 'local_preferred', 'cloud_allowed'])
const fallbackSchema = z.enum(['none', 'local_only', 'configured_provider'])
const providerIdSchema = z.enum(['nexa', 'ollama', 'openai', 'anthropic'])
const modelRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:/-]+$/)

export const profileAIConfigSchema = z.object({
  providerId: providerIdSchema,
  model: modelRefSchema.optional(),
  embedProviderId: providerIdSchema,
  embedModel: modelRefSchema.optional(),
  privacyMode: privacyModeSchema,
  fallback: fallbackSchema,
  temperature: z.number().min(0).max(2).optional(),
  contextLimit: z.number().int().min(256).max(1_000_000).optional(),
  vision: z.enum(['auto', 'off'])
})

/* ------------------------------ IPC schemas ------------------------------- */

const profileIdPattern = /^[a-zA-Z0-9_-]{1,64}$/
const ipcProfileId = z.string().regex(profileIdPattern, 'invalid_profile_id')

export const aiProvidersListSchema = z.object({
  profileId: ipcProfileId,
  refresh: z.boolean().optional()
})

export const aiProviderConfigureSchema = z.object({
  profileId: ipcProfileId,
  providerId: providerIdSchema,
  // The API key is validated only for shape; it is stored in SecureStorage in
  // the main process and NEVER returned, logged, or persisted to profile JSON.
  apiKey: z.string().min(8).max(400)
})

export const aiProviderRefSchema = z.object({
  profileId: ipcProfileId,
  providerId: providerIdSchema
})

/** BYOK key in transit to the NEXA AI Gateway. Never stored on the client. */
export const aiPremiumConnectSchema = z.object({
  profileId: ipcProfileId,
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(256)
    .regex(/^[\x21-\x7e]+$/, 'invalid_key_format')
})

export const aiConfigUpdateSchema = z.object({
  profileId: ipcProfileId,
  patch: profileAIConfigSchema.partial()
})

/** Validate untrusted persisted config into a safe `ProfileAIConfig`. */
export function normalizeProfileAIConfig(persisted: unknown): ProfileAIConfig {
  const base = defaultProfileAIConfig()
  if (!persisted || typeof persisted !== 'object') return base
  const p = persisted as Record<string, unknown>
  const parsed = profileAIConfigSchema.partial().safeParse(p)
  const v = parsed.success ? parsed.data : {}
  const cfg: ProfileAIConfig = {
    ...base,
    ...v,
    providerId: isKnownProvider(v.providerId) ? v.providerId : base.providerId,
    embedProviderId: isKnownProvider(v.embedProviderId) ? v.embedProviderId : base.embedProviderId,
    privacyMode: v.privacyMode ?? base.privacyMode,
    fallback: v.fallback ?? base.fallback,
    vision: v.vision ?? base.vision
  }
  // Safety: a cloud provider is meaningless under local_only — coerce to local_preferred
  // is NOT done silently; instead routing enforces privacy. Config stays as chosen.
  return cfg
}

/* ------------------------------ Error model ------------------------------- */

export type AIErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_OFFLINE'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'REQUEST_CANCELLED'
  | 'NETWORK_ERROR'
  | 'PRIVACY_BLOCKED'

/** Map an HTTP status / adapter signal to a safe normalized error code. */
export function normalizeHttpError(status: number): AIErrorCode {
  if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED'
  if (status === 404) return 'MODEL_NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'PROVIDER_OFFLINE'
  return 'NETWORK_ERROR'
}

/** Sanitized, user-safe message for an AI error code. Never leaks internals. */
export function aiProviderErrorMessage(code: AIErrorCode): string {
  switch (code) {
    case 'PROVIDER_NOT_CONFIGURED':
      return 'This AI provider is not configured. Add it in AI settings.'
    case 'PROVIDER_OFFLINE':
      return 'The selected AI provider is offline. Try again later.'
    case 'AUTHENTICATION_FAILED':
      return 'Authentication failed. Check the provider API key in AI settings.'
    case 'RATE_LIMITED':
      return 'The AI provider is rate limited. Try again in a moment.'
    case 'MODEL_NOT_FOUND':
      return 'The selected model was not found for this provider.'
    case 'CAPABILITY_UNAVAILABLE':
      return 'The selected model does not support this operation.'
    case 'CONTEXT_LIMIT_EXCEEDED':
      return 'The request is larger than the model context window.'
    case 'REQUEST_CANCELLED':
      return 'AI request cancelled.'
    case 'PRIVACY_BLOCKED':
      return 'Blocked by your AI privacy mode. Cloud AI is not permitted here.'
    default:
      return 'AI request failed.'
  }
}

/* -------------------------------- Routing --------------------------------- */

export interface AIProviderRuntime {
  id: AIProviderId
  type: AIProviderType
  configured: boolean
  health: AIProviderHealth
  models: AIModelInfo[]
  defaultModel?: string
}

export type AIRouteDecision =
  | { ok: true; providerId: AIProviderId; modelId: string; usedFallback: boolean; type: AIProviderType }
  | { ok: false; error: AIErrorCode; reason: string }

interface Candidate {
  runtime: AIProviderRuntime
  isPrimary: boolean
}

function pickModel(rt: AIProviderRuntime, capability: AICapability, preferred?: string): AIModelInfo | undefined {
  if (preferred) {
    const m = rt.models.find((x) => x.id === preferred)
    if (m && modelSupports(m, capability)) return m
  }
  if (rt.defaultModel) {
    const d = rt.models.find((x) => x.id === rt.defaultModel)
    if (d && modelSupports(d, capability)) return d
  }
  return rt.models.find((m) => modelSupports(m, capability))
}

/**
 * Deterministic AI routing. Order of concerns (per STEP 12 §15):
 *   required capability → privacy policy → profile config → provider health →
 *   model capability → provider.
 *
 * Cloud is used only when the privacy mode AND fallback policy explicitly allow
 * it. Local failure NEVER silently escalates private content to the cloud.
 */
export function routeAIRequest(input: {
  capability: AICapability
  config: ProfileAIConfig
  providers: AIProviderRuntime[]
}): AIRouteDecision {
  const { capability, config, providers } = input
  const byId = new Map(providers.map((p) => [p.id, p]))
  const primary = byId.get(config.providerId)

  // Build the ordered candidate list.
  const candidates: Candidate[] = []
  if (primary) candidates.push({ runtime: primary, isPrimary: true })

  const addFallbacks = (predicate: (p: AIProviderRuntime) => boolean) => {
    for (const p of providers) {
      if (p.id === config.providerId) continue
      if (predicate(p)) candidates.push({ runtime: p, isPrimary: false })
    }
  }
  if (config.fallback === 'local_only') addFallbacks((p) => p.type === 'local')
  else if (config.fallback === 'configured_provider') {
    addFallbacks((p) => p.type === 'local' && p.configured)
    addFallbacks((p) => p.type === 'cloud' && p.configured)
  }

  // Privacy eligibility.
  const privacyAllows = (rt: AIProviderRuntime, isPrimary: boolean): boolean => {
    if (rt.type === 'local') return true
    if (config.privacyMode === 'cloud_allowed') return true
    if (config.privacyMode === 'local_preferred') return !isPrimary && config.fallback === 'configured_provider'
    return false // local_only: never cloud
  }

  let sawPrivacyBlock = false
  let sawConfigured = false
  let sawHealthy = false

  for (const c of candidates) {
    const rt = c.runtime
    if (!privacyAllows(rt, c.isPrimary)) {
      if (rt.type === 'cloud') sawPrivacyBlock = true
      continue
    }
    if (!rt.configured) continue
    sawConfigured = true
    if (!isHealthy(rt.health)) continue
    sawHealthy = true
    const model = pickModel(rt, capability, c.isPrimary ? config.model : undefined)
    if (!model) continue
    return { ok: true, providerId: rt.id, modelId: model.id, usedFallback: !c.isPrimary, type: rt.type }
  }

  // No eligible candidate — return the most informative honest error.
  if (!primary) return { ok: false, error: 'PROVIDER_NOT_CONFIGURED', reason: 'unknown_primary_provider' }
  if (primary.type === 'cloud' && !privacyAllows(primary, true)) {
    return { ok: false, error: 'PRIVACY_BLOCKED', reason: 'cloud_blocked_by_privacy_mode' }
  }
  if (!sawConfigured) return { ok: false, error: 'PROVIDER_NOT_CONFIGURED', reason: 'no_configured_provider' }
  if (!sawHealthy) return { ok: false, error: 'PROVIDER_OFFLINE', reason: 'no_healthy_provider' }
  if (sawPrivacyBlock) return { ok: false, error: 'PRIVACY_BLOCKED', reason: 'cloud_blocked_by_privacy_mode' }
  return { ok: false, error: 'CAPABILITY_UNAVAILABLE', reason: 'no_capable_model' }
}

/* --------------------------- Context budgeting ---------------------------- */

const DEFAULT_CONTEXT_WINDOW = 8_192
const DEFAULT_OUTPUT_RESERVE = 1_024
const PROMPT_OVERHEAD_TOKENS = 256

/** Rough token estimate (~4 chars/token). Deterministic, provider-agnostic. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export interface ContextSource {
  label: string
  text: string
}

export interface BudgetedSource {
  label: string
  text: string
  truncated: boolean
}

export interface ContextBudgetResult {
  included: BudgetedSource[]
  truncatedAny: boolean
  usedTokens: number
  budgetTokens: number
}

/**
 * Budget an ordered (highest-priority-first) list of context sources against a
 * model's context window. High-priority sources are preserved; lower-priority
 * content is truncated or dropped, and truncation is always reported.
 */
export function planContextBudget(
  sources: ContextSource[],
  opts: { contextWindow?: number; maxOutputTokens?: number; contextLimit?: number } = {}
): ContextBudgetResult {
  const window = Math.max(
    256,
    Math.min(opts.contextLimit ?? Infinity, opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW)
  )
  const reserve = Math.min(opts.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE, Math.floor(window / 2))
  const budgetTokens = Math.max(0, window - reserve - PROMPT_OVERHEAD_TOKENS)

  const included: BudgetedSource[] = []
  let used = 0
  let truncatedAny = false

  for (const src of sources) {
    if (used >= budgetTokens) {
      truncatedAny = true
      break
    }
    const need = estimateTokens(src.text)
    if (used + need <= budgetTokens) {
      included.push({ label: src.label, text: src.text, truncated: false })
      used += need
    } else {
      const remainingTokens = budgetTokens - used
      const chars = Math.max(0, remainingTokens * 4)
      const clipped = src.text.slice(0, chars)
      if (clipped) {
        included.push({ label: src.label, text: clipped, truncated: true })
        used += estimateTokens(clipped)
      }
      truncatedAny = true
      break
    }
  }

  return { included, truncatedAny, usedTokens: used, budgetTokens }
}

/* ------------------------------- Cost model ------------------------------- */

/** Estimated USD cost, or null when pricing is not known (never invented). */
export function estimateCost(model: AIModelInfo | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!model?.cost) return null
  const { inputPerMillionTokens, outputPerMillionTokens } = model.cost
  if (inputPerMillionTokens == null && outputPerMillionTokens == null) return null
  const inCost = ((inputPerMillionTokens ?? 0) * inputTokens) / 1_000_000
  const outCost = ((outputPerMillionTokens ?? 0) * outputTokens) / 1_000_000
  return inCost + outCost
}

/** Human-facing cost label. Local → 'Free'; cloud → estimate or 'Cost unknown'. */
export function formatCostLabel(model: AIModelInfo | undefined): string {
  if (!model) return 'Cost unknown'
  if (model.local) return 'Free'
  if (!model.cost || (model.cost.inputPerMillionTokens == null && model.cost.outputPerMillionTokens == null)) {
    return 'Cost unknown'
  }
  const parts: string[] = []
  if (model.cost.inputPerMillionTokens != null) parts.push(`in $${model.cost.inputPerMillionTokens}/1M`)
  if (model.cost.outputPerMillionTokens != null) parts.push(`out $${model.cost.outputPerMillionTokens}/1M`)
  return parts.join(' · ')
}
