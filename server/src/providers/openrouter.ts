/**
 * OpenRouter provider adapter (OpenAI-compatible API).
 *
 * - Host is fixed by config (locked to https://openrouter.ai in production).
 * - Credentials are passed per call and never stored on the adapter.
 * - Chat completions are retried ONLY when the connection failed before the
 *   request could reach OpenRouter (cannot duplicate a billable request).
 *   Idempotent GETs (models, key check) get one retry on network/5xx errors.
 */

import type { ChatUsage } from '../../../src/shared/ai-gateway'
import {
  ProviderError,
  type AIProviderAdapter,
  type ProviderChatInput,
  type ProviderChatResult,
  type ProviderModel,
  type ProviderStreamChunk
} from './types'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenRouterOptions {
  baseUrl: string
  timeoutMs: number
  referer: string
  title: string
  /** Max silence between stream chunks before aborting. */
  idleTimeoutMs?: number
  fetch?: FetchLike
}

const CONNECT_PHASE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH'])

function errorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.cause?.code || err?.code
}

function statusKind(status: number): ProviderError['kind'] {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'credits'
  if (status === 404) return 'model_unavailable'
  if (status === 408 || status === 504 || status === 524) return 'timeout'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'upstream'
  return 'bad_request'
}

/** Links an external signal with a resettable timeout. */
function deadline(ms: number, external?: AbortSignal) {
  const ctrl = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  const onAbort = () => ctrl.abort()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    get timedOut() {
      return timedOut
    },
    reset(next: number) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        ctrl.abort()
      }, next)
    },
    dispose() {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    }
  }
}

function usageFrom(raw: unknown): ChatUsage | null {
  const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined
  if (!u || typeof u !== 'object') return null
  const inputTokens = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
  const outputTokens = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0
  return { inputTokens, outputTokens }
}

export class OpenRouterAdapter implements AIProviderAdapter {
  readonly id = 'openrouter'
  private fetchImpl: FetchLike

  constructor(private opts: OpenRouterOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'HTTP-Referer': this.opts.referer,
      'X-Title': this.opts.title
    }
  }

  private body(input: ProviderChatInput, stream: boolean): string {
    return JSON.stringify({
      model: input.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: input.maxOutputTokens,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
      stream
    })
  }

  /** POST with connect-phase-only retry. */
  private async post(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchImpl(url, { ...init, signal })
      } catch (e) {
        if (signal.aborted) throw e
        if (attempt === 0 && CONNECT_PHASE_CODES.has(errorCode(e) || '')) continue
        throw e
      }
    }
  }

  private mapThrown(e: unknown, d: { timedOut: boolean }, external: AbortSignal): ProviderError {
    if (e instanceof ProviderError) return e
    if (d.timedOut) return new ProviderError('timeout')
    if (external.aborted) return new ProviderError('cancelled')
    return new ProviderError('network')
  }

  async chat(input: ProviderChatInput): Promise<ProviderChatResult> {
    const d = deadline(this.opts.timeoutMs, input.signal)
    try {
      const res = await this.post(`${this.opts.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(input.apiKey), body: this.body(input, false) }, d.signal)
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        throw new ProviderError(statusKind(res.status), res.status)
      }
      const json = (await res.json()) as {
        model?: string
        choices?: { message?: { content?: unknown }; finish_reason?: string | null }[]
        usage?: unknown
        error?: unknown
      }
      if (json.error) throw new ProviderError('upstream')
      const choice = json.choices?.[0]
      const content = typeof choice?.message?.content === 'string' ? choice.message.content : ''
      return {
        model: typeof json.model === 'string' ? json.model : input.model,
        content,
        finishReason: choice?.finish_reason ?? null,
        usage: usageFrom(json.usage) ?? { inputTokens: 0, outputTokens: 0 }
      }
    } catch (e) {
      throw this.mapThrown(e, d, input.signal)
    } finally {
      d.dispose()
    }
  }

  async *stream(input: ProviderChatInput): AsyncIterable<ProviderStreamChunk> {
    const d = deadline(this.opts.timeoutMs, input.signal)
    const idle = this.opts.idleTimeoutMs ?? 60_000
    try {
      const res = await this.post(`${this.opts.baseUrl}/chat/completions`, { method: 'POST', headers: { ...this.headers(input.apiKey), Accept: 'text/event-stream' }, body: this.body(input, true) }, d.signal)
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {})
        throw new ProviderError(statusKind(res.status), res.status)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let model = input.model
      let finishReason: string | null = null
      let usage: ChatUsage | null = null
      for (;;) {
        d.reset(idle)
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue // SSE comments / keep-alives
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            yield { type: 'done', model, finishReason, usage }
            return
          }
          let json: {
            model?: unknown
            choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[]
            usage?: unknown
            error?: unknown
          }
          try {
            json = JSON.parse(payload)
          } catch {
            continue
          }
          if (json.error) throw new ProviderError('upstream')
          if (typeof json.model === 'string') model = json.model
          const choice = json.choices?.[0]
          if (choice?.finish_reason) finishReason = choice.finish_reason
          if (choice?.finish_reason === 'error') throw new ProviderError('upstream')
          const text = choice?.delta?.content
          if (typeof text === 'string' && text) yield { type: 'delta', text }
          const u = usageFrom(json.usage)
          if (u) usage = u
        }
      }
      yield { type: 'done', model, finishReason, usage }
    } catch (e) {
      throw this.mapThrown(e, d, input.signal)
    } finally {
      d.dispose()
    }
  }

  /** Idempotent GET with one retry on network/5xx. */
  private async get(path: string, apiKey: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const d = deadline(Math.min(this.opts.timeoutMs, 15_000), signal)
      try {
        const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, { method: 'GET', headers: this.headers(apiKey), signal: d.signal })
        if (res.status >= 500 && attempt === 0) {
          await res.body?.cancel().catch(() => {})
          continue
        }
        return res
      } catch (e) {
        if (signal?.aborted) throw new ProviderError('cancelled')
        if (attempt === 0) continue
        throw this.mapThrown(e, d, signal ?? new AbortController().signal)
      } finally {
        d.dispose()
      }
    }
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<ProviderModel[]> {
    const res = await this.get('/models', apiKey, signal)
    if (!res.ok) throw new ProviderError(statusKind(res.status), res.status)
    const json = (await res.json()) as { data?: unknown[] }
    const out: ProviderModel[] = []
    for (const raw of Array.isArray(json.data) ? json.data : []) {
      const m = raw as {
        id?: unknown
        name?: unknown
        context_length?: unknown
        pricing?: Record<string, unknown>
        architecture?: { output_modalities?: unknown; modality?: unknown }
      }
      if (typeof m.id !== 'string' || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(m.id)) continue
      // Free only when every listed price component (prompt, completion,
      // request, image, web_search, reasoning, …) is exactly zero.
      const prices = m.pricing && typeof m.pricing === 'object' ? Object.values(m.pricing) : []
      const free = prices.length > 0 && m.pricing?.prompt != null && m.pricing?.completion != null && prices.every((v) => v != null && v !== '' && Number(v) === 0)
      const outMods = m.architecture?.output_modalities
      const textOutput = Array.isArray(outMods)
        ? outMods.includes('text')
        : typeof m.architecture?.modality === 'string'
          ? /->.*text/.test(m.architecture.modality)
          : true
      out.push({
        id: m.id,
        name: typeof m.name === 'string' ? m.name.slice(0, 120) : m.id,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        free,
        textOutput
      })
    }
    return out
  }

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<boolean> {
    const res = await this.get('/key', apiKey, signal)
    await res.body?.cancel().catch(() => {})
    if (res.ok) return true
    if (res.status === 401 || res.status === 403) return false
    throw new ProviderError(statusKind(res.status), res.status)
  }
}
