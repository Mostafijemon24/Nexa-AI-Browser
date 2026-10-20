/**
 * STEP 12 — Main-process AI provider adapters.
 *
 * Each adapter implements the internal `AIProviderAdapter` contract. Consumers
 * NEVER touch these directly — they go through `AIService` → `AIProviderRegistry`
 * → router → adapter (one unified AI service).
 *
 * Security:
 *   - Cloud endpoints are locked to their known HTTPS host (`assertKnownHost`).
 *   - API keys are passed per-call and NEVER stored on the adapter, logged, or
 *     returned to the renderer. They live only in OS SecureStorage.
 *   - Page content stays untrusted; adapters do not add authority.
 */

import type { AiMessage } from '../../shared/ai'
import {
  PROVIDER_META,
  assertKnownHost,
  cloudModelsFor,
  normalizeHttpError,
  ollamaModelCapabilities,
  type AICapabilities,
  type AIModelInfo,
  type AIProviderHealth,
  type AIProviderId,
  type AIProviderType
} from '../../shared/ai-providers'
import { OllamaClient, type OllamaError } from './ollama'
import { GatewayClient, GatewayClientError } from './ai-gateway-client'
import { modelRef, parseModelRef } from '../../shared/ai-gateway'

export interface ProviderChatParams {
  model: string
  messages: AiMessage[]
  images?: string[]
  signal?: AbortSignal
  timeoutMs?: number
  temperature?: number
  maxOutputTokens?: number
  onDelta: (delta: string) => void
  /** Resolved upstream model + token usage, when the provider reports them. */
  onMeta?: (meta: { model?: string; usage?: { inputTokens: number; outputTokens: number } }) => void
}

export interface ProviderEmbedParams {
  model: string
  input: string | string[]
  signal?: AbortSignal
  timeoutMs?: number
}

export interface AIProviderAdapter {
  id: AIProviderId
  type: AIProviderType
  /** Health check. Cloud adapters require `apiKey`; local ignores it. */
  health(opts: { apiKey?: string | null; signal?: AbortSignal; timeoutMs?: number }): Promise<AIProviderHealth>
  /** Discover models (normalized). Cloud returns the known catalog when authed. */
  listModels(opts: { apiKey?: string | null; timeoutMs?: number }): Promise<AIModelInfo[]>
  /** Streaming chat. Resolves with the full text; calls onDelta per token. */
  chat(params: ProviderChatParams & { apiKey?: string | null }): Promise<string>
  embed?(params: ProviderEmbedParams & { apiKey?: string | null }): Promise<number[][]>
  /** Honest per-model capabilities (used for vision detection etc.). */
  capabilities?(model: string, opts: { apiKey?: string | null; timeoutMs?: number }): Promise<AICapabilities>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function getFetch(): FetchLike {
  const f = globalThis.fetch as FetchLike | undefined
  if (!f) throw new Error('fetch_unavailable')
  return f
}

/** Merge an external abort signal with a timeout (real cancellation). */
function withTimeout(ms: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms)
  const onAbort = () => ctrl.abort(external?.reason)
  if (external) {
    if (external.aborted) ctrl.abort(external.reason)
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    }
  }
}

class CloudError extends Error {
  constructor(public state: AIProviderHealth['state']) {
    super(state)
  }
}

function healthFromStatus(status: number): AIProviderHealth['state'] {
  const code = normalizeHttpError(status)
  if (code === 'AUTHENTICATION_FAILED') return 'AUTH_ERROR'
  if (code === 'RATE_LIMITED') return 'RATE_LIMITED'
  if (code === 'PROVIDER_OFFLINE') return 'OFFLINE'
  return 'ERROR'
}

/* --------------------------------- Ollama --------------------------------- */

export class OllamaProviderAdapter implements AIProviderAdapter {
  id: AIProviderId = 'ollama'
  type: AIProviderType = 'local'
  constructor(private client: OllamaClient) {}

  async health(opts: { timeoutMs?: number } = {}): Promise<AIProviderHealth> {
    const ok = await this.client.ping(opts.timeoutMs ?? 3000)
    return ok ? { state: 'CONNECTED', checkedAt: Date.now() } : { state: 'LOCAL_OFFLINE', note: 'Start Ollama to use Local AI.', checkedAt: Date.now() }
  }

  async listModels(opts: { timeoutMs?: number } = {}): Promise<AIModelInfo[]> {
    const models = await this.client.listModels({ timeoutMs: opts.timeoutMs ?? 4000 })
    return models.map((m) => ({
      id: m.name,
      providerId: 'ollama' as const,
      displayName: m.name,
      local: true,
      contextWindow: m.contextLength ?? undefined,
      capabilities: ollamaModelCapabilities({ capabilities: m.capabilities, embedding: m.embedding, name: m.name })
    }))
  }

  async chat(params: ProviderChatParams): Promise<string> {
    return this.client.chat({
      model: params.model,
      messages: params.messages,
      images: params.images,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
      onDelta: params.onDelta
    })
  }

  async embed(params: ProviderEmbedParams): Promise<number[][]> {
    return this.client.embed({ model: params.model, input: params.input, signal: params.signal, timeoutMs: params.timeoutMs })
  }

  async capabilities(model: string, opts: { timeoutMs?: number } = {}): Promise<AICapabilities> {
    const info = await this.client.show(model, { timeoutMs: opts.timeoutMs ?? 4000 })
    return ollamaModelCapabilities({ capabilities: info.capabilities, name: model })
  }
}

/* --------------------------------- OpenAI --------------------------------- */

/** OpenAI content part for multimodal (image) messages. */
type OpenAIContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export class OpenAIProviderAdapter implements AIProviderAdapter {
  id: AIProviderId = 'openai'
  type: AIProviderType = 'cloud'
  private base = PROVIDER_META.openai.endpoint
  constructor(private fetchImpl: FetchLike = getFetch()) {}

  async health(opts: { apiKey?: string | null; timeoutMs?: number } = {}): Promise<AIProviderHealth> {
    if (!opts.apiKey) return { state: 'NOT_CONFIGURED', checkedAt: Date.now() }
    const url = `${this.base}/v1/models`
    assertKnownHost('openai', url)
    const { signal, cancel } = withTimeout(opts.timeoutMs ?? 6000)
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${opts.apiKey}` }, signal })
      if (res.ok) return { state: 'CONNECTED', checkedAt: Date.now() }
      return { state: healthFromStatus(res.status), checkedAt: Date.now() }
    } catch {
      return { state: 'NETWORK_OFFLINE', note: 'Could not reach OpenAI.', checkedAt: Date.now() }
    } finally {
      cancel()
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    // Use the curated, capability-annotated catalog (honest metadata + cost).
    return cloudModelsFor('openai')
  }

  async chat(params: ProviderChatParams & { apiKey?: string | null }): Promise<string> {
    if (!params.apiKey) throw new CloudError('NOT_CONFIGURED')
    const url = `${this.base}/v1/chat/completions`
    assertKnownHost('openai', url)
    const messages = params.messages.map((m, i) => {
      const isLastUser = m.role === 'user' && i === lastUserIndex(params.messages)
      if (isLastUser && params.images && params.images.length) {
        const content: OpenAIContent = [
          { type: 'text', text: m.content },
          ...params.images.map((b64) => ({ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${stripDataUri(b64)}` } }))
        ]
        return { role: m.role, content }
      }
      return { role: m.role, content: m.content }
    })
    const { signal, cancel } = withTimeout(params.timeoutMs ?? 180_000, params.signal)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: true,
          ...(params.temperature != null ? { temperature: params.temperature } : {}),
          ...(params.maxOutputTokens != null ? { max_tokens: params.maxOutputTokens } : {})
        }),
        signal
      })
    } catch (e) {
      cancel()
      if (params.signal?.aborted) throw new CloudError('OFFLINE')
      throw new CloudError('NETWORK_OFFLINE')
    }
    if (!res.ok || !res.body) {
      cancel()
      throw new CloudError(healthFromStatus(res.status))
    }
    try {
      return await readSSE(res.body as ReadableStream<Uint8Array>, (json) => {
        const delta = json?.choices?.[0]?.delta?.content
        return typeof delta === 'string' ? delta : ''
      }, params.onDelta)
    } finally {
      cancel()
    }
  }

  async embed(params: ProviderEmbedParams & { apiKey?: string | null }): Promise<number[][]> {
    if (!params.apiKey) throw new CloudError('NOT_CONFIGURED')
    const url = `${this.base}/v1/embeddings`
    assertKnownHost('openai', url)
    const { signal, cancel } = withTimeout(params.timeoutMs ?? 45_000, params.signal)
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
        body: JSON.stringify({ model: params.model, input: params.input }),
        signal
      })
      if (!res.ok) throw new CloudError(healthFromStatus(res.status))
      const data = (await res.json()) as { data?: { embedding: number[] }[] }
      return Array.isArray(data.data) ? data.data.map((d) => d.embedding) : []
    } finally {
      cancel()
    }
  }
}

/* ------------------------------- Anthropic -------------------------------- */

export class AnthropicProviderAdapter implements AIProviderAdapter {
  id: AIProviderId = 'anthropic'
  type: AIProviderType = 'cloud'
  private base = PROVIDER_META.anthropic.endpoint
  private version = '2023-06-01'
  constructor(private fetchImpl: FetchLike = getFetch()) {}

  private headers(apiKey: string): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': this.version }
  }

  async health(opts: { apiKey?: string | null; timeoutMs?: number } = {}): Promise<AIProviderHealth> {
    if (!opts.apiKey) return { state: 'NOT_CONFIGURED', checkedAt: Date.now() }
    const url = `${this.base}/v1/models`
    assertKnownHost('anthropic', url)
    const { signal, cancel } = withTimeout(opts.timeoutMs ?? 6000)
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers(opts.apiKey), signal })
      if (res.ok) return { state: 'CONNECTED', checkedAt: Date.now() }
      return { state: healthFromStatus(res.status), checkedAt: Date.now() }
    } catch {
      return { state: 'NETWORK_OFFLINE', note: 'Could not reach Anthropic.', checkedAt: Date.now() }
    } finally {
      cancel()
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    return cloudModelsFor('anthropic')
  }

  async chat(params: ProviderChatParams & { apiKey?: string | null }): Promise<string> {
    if (!params.apiKey) throw new CloudError('NOT_CONFIGURED')
    const url = `${this.base}/v1/messages`
    assertKnownHost('anthropic', url)
    // Anthropic separates the system prompt from the message list.
    const system = params.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const convo = params.messages.filter((m) => m.role !== 'system')
    const lastUser = lastUserIndex(convo)
    const messages = convo.map((m, i) => {
      if (m.role === 'user' && i === lastUser && params.images && params.images.length) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            ...params.images.map((b64) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: stripDataUri(b64) } }))
          ]
        }
      }
      return { role: m.role, content: m.content }
    })
    const { signal, cancel } = withTimeout(params.timeoutMs ?? 180_000, params.signal)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(params.apiKey),
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.maxOutputTokens ?? 4096,
          ...(system ? { system } : {}),
          ...(params.temperature != null ? { temperature: params.temperature } : {}),
          messages,
          stream: true
        }),
        signal
      })
    } catch (e) {
      cancel()
      if (params.signal?.aborted) throw new CloudError('OFFLINE')
      throw new CloudError('NETWORK_OFFLINE')
    }
    if (!res.ok || !res.body) {
      cancel()
      throw new CloudError(healthFromStatus(res.status))
    }
    try {
      return await readSSE(res.body as ReadableStream<Uint8Array>, (json) => {
        if (json?.type === 'content_block_delta') {
          const t = json?.delta?.text
          return typeof t === 'string' ? t : ''
        }
        return ''
      }, params.onDelta)
    } finally {
      cancel()
    }
  }
}

/* ------------------------------ NEXA Gateway ------------------------------ */

const GATEWAY_CHAT_CAPS: AICapabilities = {
  chat: 'supported',
  streaming: 'supported',
  tools: 'unknown',
  vision: 'unsupported',
  embeddings: 'unsupported',
  reasoning: 'unknown'
}

/**
 * NEXA AI Gateway adapter. Holds no provider credential: the gateway decides
 * the upstream model and pays with its server key (Free) or the user's
 * server-side encrypted BYOK key (Premium). Model ids are logical refs
 * ('free', 'premium', 'free:<id>', 'premium:<id>').
 */
export class NexaGatewayAdapter implements AIProviderAdapter {
  id: AIProviderId = 'nexa'
  type: AIProviderType = 'cloud'
  constructor(private client: GatewayClient) {}

  get gateway(): GatewayClient {
    return this.client
  }

  async health(): Promise<AIProviderHealth> {
    if (!this.client.configured) return { state: 'NOT_CONFIGURED', note: 'NEXA AI gateway is not configured in this build.', checkedAt: Date.now() }
    try {
      const h = await this.client.health()
      if (!h.configured) return { state: 'ERROR', note: 'NEXA AI is not configured on the server.', checkedAt: Date.now() }
      // Proves an authenticated session works (registers the device on first use).
      await this.client.providers()
      return { state: 'CONNECTED', checkedAt: Date.now() }
    } catch (e) {
      const code = e instanceof GatewayClientError ? e.code : 'NETWORK_ERROR'
      if (code === 'NETWORK_ERROR') return { state: 'NETWORK_OFFLINE', note: 'Could not reach NEXA AI.', checkedAt: Date.now() }
      if (code === 'RATE_LIMITED') return { state: 'RATE_LIMITED', checkedAt: Date.now() }
      if (code === 'AUTH_REQUIRED' || code === 'FORBIDDEN') return { state: 'AUTH_ERROR', checkedAt: Date.now() }
      return { state: 'OFFLINE', note: 'NEXA AI is temporarily unavailable.', checkedAt: Date.now() }
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    if (!this.client.configured) return []
    const m = await this.client.models()
    const entry = (id: string, displayName: string, contextWindow: number | null): AIModelInfo => ({
      id,
      providerId: 'nexa',
      displayName,
      local: false,
      ...(contextWindow ? { contextWindow } : {}),
      capabilities: GATEWAY_CHAT_CAPS
    })
    const out: AIModelInfo[] = [entry('free', 'NEXA Free AI', null)]
    for (const f of m.free) if (f.id !== m.defaults.free) out.push(entry(modelRef('free', f.id), `${f.name} · Free`, f.contextLength))
    if (m.premiumAvailable) {
      out.push(entry('premium', 'Premium · Auto', null))
      for (const p of m.premium) if (p.id !== m.defaults.premium) out.push(entry(modelRef('premium', p.id), `${p.name} · Premium`, p.contextLength))
    }
    return out
  }

  async chat(params: ProviderChatParams): Promise<string> {
    if (params.images?.length) throw new CloudError('UNSUPPORTED')
    const { mode, model } = parseModelRef(params.model)
    const result = await this.client.stream(
      {
        mode,
        ...(model ? { model } : {}),
        messages: params.messages,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.maxOutputTokens != null ? { maxOutputTokens: params.maxOutputTokens } : {})
      },
      { signal: params.signal, onDelta: params.onDelta, timeoutMs: params.timeoutMs }
    )
    params.onMeta?.({ model: result.model, ...(result.usage ? { usage: result.usage } : {}) })
    return result.content
  }
}

/* -------------------------------- helpers --------------------------------- */

function lastUserIndex(messages: AiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i
  return -1
}

function stripDataUri(b64: string): string {
  return b64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
}

/** Map a CloudError / OllamaError to a safe normalized code string. */
export function providerErrorCode(e: unknown): string {
  if (e instanceof GatewayClientError) {
    if (e.code === 'CANCELLED') return 'REQUEST_CANCELLED'
    if (e.code === 'NOT_CONFIGURED') return 'PROVIDER_NOT_CONFIGURED'
    if (e.code === 'BAD_RESPONSE') return 'PROVIDER_ERROR'
    return e.code
  }
  if (e instanceof CloudError) {
    switch (e.state) {
      case 'AUTH_ERROR':
        return 'AUTHENTICATION_FAILED'
      case 'RATE_LIMITED':
        return 'RATE_LIMITED'
      case 'NOT_CONFIGURED':
        return 'PROVIDER_NOT_CONFIGURED'
      case 'NETWORK_OFFLINE':
        return 'NETWORK_ERROR'
      default:
        return 'PROVIDER_OFFLINE'
    }
  }
  const c = (e as OllamaError)?.code
  if (c === 'cancelled') return 'REQUEST_CANCELLED'
  if (c === 'model_not_installed') return 'MODEL_NOT_FOUND'
  if (c === 'ollama_offline') return 'PROVIDER_OFFLINE'
  if (c === 'timeout') return 'PROVIDER_OFFLINE'
  return 'NETWORK_ERROR'
}

/**
 * Parse a Server-Sent-Events stream. `extract(json)` returns the incremental
 * text for a data line ('' if none). Resolves with the full concatenated text.
 * Handles `data: [DONE]` and ignores non-data lines.
 */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  // Provider SSE payloads are dynamically-shaped third-party JSON; the concrete
  // shape is validated by each `extract` implementation at the call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extract: (json: any) => string,
  onDelta: (d: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const MAX_SSE_BUFFER = 1024 * 1024 // guard against an unbounded no-newline stream
  let buf = ''
  let full = ''
  // try/finally guarantees the body reader is cancelled on the `[DONE]` early
  // return and on any thrown error — otherwise the locked, un-cancelled reader
  // keeps the underlying HTTP socket open until GC (fd/connection leak).
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      if (buf.length > MAX_SSE_BUFFER) throw new Error('bad_response')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line || !line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return full
        let json: unknown
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const delta = extract(json)
        if (delta) {
          full += delta
          onDelta(delta)
        }
      }
    }
    return full
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* already released */
    }
  }
}
