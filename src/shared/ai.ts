import { z } from 'zod'
import { PROFILE_ID_RE } from './types'
import { INJECTION_GUARD, wrapUntrusted } from './page-content'
import { gatewayErrorMessage, isGatewayErrorCode } from './ai-gateway'
import { aiProviderErrorMessage, type AIErrorCode } from './ai-providers'

/**
 * NEXA Local AI — shared contract.
 *
 * Local-first policy: the ONLY backend is a local Ollama instance bound to the
 * loopback endpoint below. There is NO cloud provider and NO automatic cloud
 * fallback. Cloud is OFF by default and not implemented as a runtime fallback.
 */

/** The single allowed Ollama endpoint. Locked to loopback. */
export const OLLAMA_HOST = '127.0.0.1'
export const OLLAMA_PORT = 11434
export const OLLAMA_ENDPOINT = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`

export const DEFAULT_CHAT_MODEL = 'qwen3:8b'
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text:latest'

/** Hard limits (protect main process + keep prompts small). */
export const MAX_MESSAGE_CHARS = 60_000
export const MAX_CONTEXT_CHARS = 24_000 // page/selection text sent to the model
export const MAX_MESSAGES = 40
export const MAX_CONCURRENT_AI = 2
export const CHAT_TIMEOUT_MS = 180_000
export const EMBED_TIMEOUT_MS = 45_000
export const STATUS_TIMEOUT_MS = 4_000

/** Live connection state of the local Ollama backend. */
export type AiConnectionState = 'connected' | 'offline' | 'checking'

/** Per-request run state surfaced to the UI. */
export type AiRunState =
  | 'idle'
  | 'checking'
  | 'generating'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'ollama_offline'
  | 'model_not_installed'

export type AiRole = 'system' | 'user' | 'assistant'

export interface AiMessage {
  role: AiRole
  content: string
}

export interface AiModel {
  name: string
  family: string
  paramSize: string
  quant: string
  contextLength: number | null
  capabilities: string[]
  embedding: boolean
  /** Presentation name for non-Ollama (gateway) model refs. */
  displayName?: string
}

export interface AiLocalStatus {
  state: AiConnectionState
  endpoint: string
  chatModel: string
  embedModel: string
  models: AiModel[]
  note?: string
}

/**
 * Status of the provider that chat is currently routed to. For the local path
 * this is Ollama; for NEXA AI it is the gateway. `local` always carries the
 * Ollama runtime status for the Local AI settings.
 */
export interface AiStatus {
  state: AiConnectionState
  endpoint: string
  chatModel: string
  embedModel: string
  models: AiModel[]
  cloudEnabled: boolean
  processing: 'local-only' | 'cloud'
  /** Sanitized, user-safe message when offline/error. Never contains secrets. */
  note?: string
  providerId?: string
  providerName?: string
  /** Human label for the active model (e.g. "NEXA Free AI"). */
  modelLabel?: string
  local?: AiLocalStatus
}

export interface AiSettings {
  chatModel: string
  embedModel: string
  /** Always false — cloud AI is not implemented as a fallback. */
  cloudEnabled: false
}

/** Streaming events pushed main → renderer over the ai.event channel. */
export type AiStreamEvent =
  | { type: 'start'; requestId: string; profileId: string; model: string }
  | { type: 'delta'; requestId: string; profileId: string; delta: string }
  | {
      type: 'done'
      requestId: string
      profileId: string
      content: string
      /** Upstream model that actually answered (gateway), when known. */
      model?: string
      usage?: { inputTokens: number; outputTokens: number }
    }
  | { type: 'cancelled'; requestId: string; profileId: string }
  | { type: 'error'; requestId: string; profileId: string; code: string; message: string }

/** Browser-context AI operations. */
export type AiOp = 'ask' | 'summarize' | 'explain' | 'translate' | 'rewrite' | 'qa'

/** Controlled rewrite tones. */
export type RewriteMode = 'professional' | 'simple' | 'shorter' | 'clearer'

export const REWRITE_MODE_INSTRUCTION: Record<RewriteMode, string> = {
  professional: 'Rewrite the selected text in a polished, professional tone.',
  simple: 'Rewrite the selected text using simple, plain language anyone can understand.',
  shorter: 'Rewrite the selected text to be significantly shorter while keeping the key meaning.',
  clearer: 'Rewrite the selected text to be clearer and easier to follow.'
}

/* ----------------------------- Zod schemas ----------------------------- */

const profileIdSchema = z.string().regex(PROFILE_ID_RE, 'invalid_profile_id')
// Ollama model refs: name[:tag]; letters, digits, _, ., -, /, :
const modelNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:/-]+$/, 'invalid_model')
const requestIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/, 'invalid_request_id')

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS)
})

export const aiProfileSchema = z.object({ profileId: profileIdSchema })

export const aiChatSchema = z.object({
  profileId: profileIdSchema,
  requestId: requestIdSchema,
  model: modelNameSchema.optional(),
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  private: z.boolean().optional()
})

export const aiCancelSchema = z.object({
  profileId: profileIdSchema,
  requestId: requestIdSchema
})

export const aiEmbedSchema = z.object({
  profileId: profileIdSchema,
  model: modelNameSchema.optional(),
  input: z.union([z.string().min(1).max(MAX_MESSAGE_CHARS), z.array(z.string().min(1).max(MAX_MESSAGE_CHARS)).min(1).max(64)])
})

export const aiSelectModelSchema = z.object({
  profileId: profileIdSchema,
  chatModel: modelNameSchema.optional(),
  embedModel: modelNameSchema.optional()
})

/** P5.3 vision IPC — capability detection + a single bounded, memory-only image. */
export const MAX_VISION_IMAGE_CHARS = 8_000_000
export const aiVisionStatusSchema = z.object({
  profileId: profileIdSchema,
  model: modelNameSchema.optional()
})
export const aiVisionAnalyzeSchema = z.object({
  profileId: profileIdSchema,
  requestId: requestIdSchema.optional(),
  model: modelNameSchema.optional(),
  /** Base64 image (optionally data-uri). Bounded; never persisted or logged. */
  image: z.string().min(16).max(MAX_VISION_IMAGE_CHARS),
  prompt: z.string().min(1).max(4_000),
  system: z.string().max(4_000).optional(),
  private: z.boolean().optional()
})

export type AiChatInput = z.infer<typeof aiChatSchema>
export type AiEmbedInput = z.infer<typeof aiEmbedSchema>

/* --------------------------- Presentation ---------------------------- */

/** Human-friendly model name, derived — never a hardcoded install list. */
export function prettyModelName(name: string): string {
  const base = name.replace(/:latest$/, '')
  const map: Record<string, string> = {
    'qwen3:8b': 'Qwen3 8B',
    qwen3: 'Qwen3',
    mistral: 'Mistral',
    llama3: 'Llama 3',
    'nomic-embed-text': 'Nomic Embed Text'
  }
  if (map[name]) return map[name]
  if (map[base]) return map[base]
  // Title-case the family, keep the tag.
  const [fam, tag] = base.split(':')
  const pretty = fam
    .split(/[-_]/)
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
  return tag ? `${pretty} ${tag}` : pretty
}

/* --------------------------- Content safety --------------------------- */

/** Collapse whitespace and clamp to the context budget. Never touches secrets. */
export function clampContext(text: string, max = MAX_CONTEXT_CHARS): string {
  const clean = text.replace(/\r/g, '').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max) + '\n\n…[content truncated to fit local model context]'
}

/**
 * Build messages for a browser-context AI action. Only the minimum text needed
 * is included; callers must pass already-extracted readable text (never raw
 * HTML, cookies, tokens or credentials).
 */
export function buildActionMessages(
  op: Exclude<AiOp, 'ask'>,
  input: { title?: string; content?: string; selection?: string; question?: string; targetLang?: string; mode?: RewriteMode }
): AiMessage[] {
  const title = input.title ? `Page title: ${input.title}\n` : ''
  switch (op) {
    case 'summarize': {
      const body = wrapUntrusted(clampContext(input.content || ''))
      return [
        { role: 'system', content: `You are a concise assistant running locally. ${INJECTION_GUARD}\n\nSummarize the page content under three headings exactly: "Summary" (2-3 sentences), "Key Points" (bullets), and "Important Details" (bullets). Use only the provided content.` },
        { role: 'user', content: `${title}Summarize this page:\n\n${body}` }
      ]
    }
    case 'qa': {
      const body = wrapUntrusted(clampContext(input.content || ''))
      return [
        { role: 'system', content: `You answer questions using only the provided page content. If the answer is not present, say so plainly. You run locally on the user\u2019s machine. ${INJECTION_GUARD}` },
        { role: 'user', content: `${title}Page content:\n\n${body}\n\nQuestion: ${input.question || ''}` }
      ]
    }
    case 'explain': {
      const sel = wrapUntrusted(clampContext(input.selection || '', 8_000))
      return [
        { role: 'system', content: `Explain the selected text clearly and briefly for a general audience. Use only the provided text. ${INJECTION_GUARD}` },
        { role: 'user', content: `${title}Explain this selection:\n\n${sel}` }
      ]
    }
    case 'translate': {
      const sel = wrapUntrusted(clampContext(input.selection || '', 8_000))
      const lang = input.targetLang || 'English'
      return [
        { role: 'system', content: `Translate the selected text into ${lang}. Output only the translation, preserving meaning and tone. ${INJECTION_GUARD}` },
        { role: 'user', content: `Translate to ${lang}:\n\n${sel}` }
      ]
    }
    case 'rewrite': {
      const sel = wrapUntrusted(clampContext(input.selection || '', 8_000))
      const mode = input.mode || 'clearer'
      return [
        { role: 'system', content: `${REWRITE_MODE_INSTRUCTION[mode]} Output only the rewritten text, nothing else. ${INJECTION_GUARD}` },
        { role: 'user', content: `Rewrite this:\n\n${sel}` }
      ]
    }
  }
}

/**
 * System message carrying persistent page context for a multi-turn Page Q&A
 * conversation. The page content is untrusted and fenced; the guard forbids
 * treating it as instructions.
 */
export function pageContextSystemMessage(ctx: { title?: string; url?: string; text: string }): AiMessage {
  const head = [ctx.title ? `Title: ${ctx.title}` : '', ctx.url ? `URL: ${ctx.url}` : '']
    .filter(Boolean)
    .join('\n')
  return {
    role: 'system',
    content: `You are NEXA's local browsing assistant. Answer the user's questions about the current web page using the content below. If the answer is not in the content, say so. ${INJECTION_GUARD}\n\n${head}\n\nPage content:\n${wrapUntrusted(clampContext(ctx.text))}`
  }
}

/** Sanitized user-facing message for an AI error code. Never leaks internals. */
const PROVIDER_ERROR_CODES: AIErrorCode[] = [
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_OFFLINE',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'MODEL_NOT_FOUND',
  'CAPABILITY_UNAVAILABLE',
  'CONTEXT_LIMIT_EXCEEDED',
  'REQUEST_CANCELLED',
  'NETWORK_ERROR',
  'PRIVACY_BLOCKED'
]

export function aiErrorMessage(code: string): string {
  if (code === 'PRIVATE_LOCAL_ONLY') return 'Private tabs use Local AI only. Start Ollama to use AI in private browsing.'
  if (code === 'NETWORK_ERROR') return 'Could not reach NEXA AI. Check your internet connection.'
  if (code === 'PROVIDER_NOT_CONFIGURED') return 'No AI provider is available. NEXA AI is not configured in this build and Local AI (Ollama) is not running.'
  if (isGatewayErrorCode(code)) return gatewayErrorMessage(code)
  if ((PROVIDER_ERROR_CODES as string[]).includes(code)) return aiProviderErrorMessage(code as AIErrorCode)
  switch (code) {
    case 'ollama_offline':
      return 'Local AI unavailable — start Ollama to use Local AI.'
    case 'model_not_installed':
      return 'The selected model is not installed. Choose an installed model in AI settings.'
    case 'busy':
      return 'Too many AI requests in progress. Try again in a moment.'
    case 'timeout':
      return 'The local model took too long to respond.'
    case 'cancelled':
      return 'Generation cancelled.'
    case 'bad_response':
      return 'The local model returned an unexpected response.'
    case 'invalid_model':
    case 'invalid_request_id':
    case 'invalid_profile_id':
      return 'Invalid AI request.'
    default:
      return 'Local AI request failed.'
  }
}
