import {
  OLLAMA_ENDPOINT,
  OLLAMA_HOST,
  OLLAMA_PORT,
  type AiMessage,
  type AiModel
} from '../../shared/ai'

/**
 * Minimal, dependency-free client for a LOCAL Ollama instance.
 *
 * Security: the endpoint is locked to the loopback host/port. The URL is never
 * taken from user input. Only the main process uses this client — the renderer
 * never talks to Ollama directly.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OllamaError extends Error {
  code: 'ollama_offline' | 'model_not_installed' | 'bad_response' | 'timeout' | 'cancelled'
}

function err(code: OllamaError['code'], message: string = code): OllamaError {
  const e = new Error(message) as OllamaError
  e.code = code
  return e
}

/** Reject anything that is not the exact loopback endpoint. */
function assertLoopback(endpoint: string): void {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    throw new Error('invalid_endpoint')
  }
  const okHost = u.hostname === OLLAMA_HOST || u.hostname === 'localhost'
  if (u.protocol !== 'http:' || !okHost || u.port !== String(OLLAMA_PORT)) {
    throw new Error('invalid_endpoint')
  }
}

interface TagsModel {
  name?: string
  model?: string
  details?: {
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
    context_length?: number
    embedding_length?: number
  }
  capabilities?: string[]
}

export function mapTagsModel(m: TagsModel): AiModel | null {
  const name = m.name || m.model
  if (!name) return null
  const d = m.details || {}
  const caps = Array.isArray(m.capabilities) ? m.capabilities : []
  const embedding = caps.includes('embedding') || /embed/i.test(name)
  return {
    name,
    family: d.family || (d.families && d.families[0]) || name.split(':')[0],
    paramSize: d.parameter_size || '',
    quant: d.quantization_level || '',
    contextLength: typeof d.context_length === 'number' ? d.context_length : null,
    capabilities: caps,
    embedding
  }
}

export class OllamaClient {
  private endpoint: string
  private fetchImpl: FetchLike

  constructor(opts: { endpoint?: string; fetchImpl?: FetchLike } = {}) {
    this.endpoint = opts.endpoint || OLLAMA_ENDPOINT
    assertLoopback(this.endpoint)
    const f = opts.fetchImpl || (globalThis.fetch as FetchLike | undefined)
    if (!f) throw new Error('fetch_unavailable')
    this.fetchImpl = f
  }

  /** Combine an external abort signal with an internal timeout. */
  private withTimeout(ms: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
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

  private classifyNetworkError(e: unknown, external?: AbortSignal): OllamaError {
    if (external?.aborted) return err('cancelled')
    const msg = e instanceof Error ? e.message : String(e)
    if (/timeout/i.test(msg)) return err('timeout')
    // fetch throws TypeError on ECONNREFUSED / connection failures.
    return err('ollama_offline', 'ollama_offline')
  }

  /** GET /api/tags — list installed models. */
  async listModels(opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<AiModel[]> {
    const { signal, cancel } = this.withTimeout(opts.timeoutMs ?? 4000, opts.signal)
    try {
      const res = await this.fetchImpl(`${this.endpoint}/api/tags`, { method: 'GET', signal })
      if (!res.ok) throw err('bad_response', `tags_${res.status}`)
      const data = (await res.json()) as { models?: TagsModel[] }
      if (!data || !Array.isArray(data.models)) throw err('bad_response')
      return data.models.map(mapTagsModel).filter((m): m is AiModel => m !== null)
    } catch (e) {
      if ((e as OllamaError).code) throw e
      throw this.classifyNetworkError(e, opts.signal)
    } finally {
      cancel()
    }
  }

  /**
   * POST /api/show — model metadata incl. capabilities (e.g. ["completion","vision"]).
   * Used for honest runtime vision-capability detection. Never assumes capability.
   */
  async show(name: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ capabilities: string[]; family: string; families: string[] }> {
    const { signal, cancel } = this.withTimeout(opts.timeoutMs ?? 4000, opts.signal)
    try {
      const res = await this.fetchImpl(`${this.endpoint}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal
      })
      if (res.status === 404) throw err('model_not_installed')
      if (!res.ok) throw err('bad_response', `show_${res.status}`)
      const data = (await res.json()) as { capabilities?: string[]; details?: { family?: string; families?: string[] } }
      return {
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        family: data.details?.family || '',
        families: Array.isArray(data.details?.families) ? data.details!.families! : []
      }
    } catch (e) {
      if ((e as OllamaError).code) throw e
      throw this.classifyNetworkError(e, opts.signal)
    } finally {
      cancel()
    }
  }

  async ping(timeoutMs = 3000): Promise<boolean> {
    try {
      await this.listModels({ timeoutMs })
      return true
    } catch {
      return false
    }
  }

  /**
   * POST /api/chat with stream:true. Calls onDelta for each incremental content
   * token and resolves with the full concatenated content. Aborting the signal
   * aborts the underlying HTTP request (real cancellation, not simulated).
   */
  async chat(params: {
    model: string
    messages: AiMessage[]
    signal?: AbortSignal
    timeoutMs?: number
    /** Optional base64 (no data-uri prefix) images attached to the LAST user message (multimodal). */
    images?: string[]
    onDelta: (delta: string) => void
  }): Promise<string> {
    const { signal, cancel } = this.withTimeout(params.timeoutMs ?? 180_000, params.signal)
    // Attach images to the last user message for multimodal models (Ollama format).
    let messages: (AiMessage & { images?: string[] })[] = params.messages
    if (params.images && params.images.length) {
      messages = params.messages.map((m) => ({ ...m }))
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i] = { ...messages[i], images: params.images }
          break
        }
      }
    }
    let res: Response
    try {
      res = await this.fetchImpl(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: true,
          // Suppress qwen3 "thinking" tokens from the streamed answer.
          think: false
        }),
        signal
      })
    } catch (e) {
      cancel()
      throw this.classifyNetworkError(e, params.signal)
    }

    if (res.status === 404) {
      cancel()
      throw err('model_not_installed')
    }
    if (!res.ok || !res.body) {
      cancel()
      throw err('bad_response', `chat_${res.status}`)
    }

    let full = ''
    try {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // Bound the line buffer so a backend streaming without newlines cannot
        // grow main-process memory without limit.
        if (buf.length > 1024 * 1024) throw err('bad_response', 'stream_too_large')
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const evt = parseChatLine(line)
          if (evt?.error) throw err(/not found|no such model/i.test(evt.error) ? 'model_not_installed' : 'bad_response', evt.error)
          if (evt?.delta) {
            full += evt.delta
            params.onDelta(evt.delta)
          }
        }
      }
      return full
    } catch (e) {
      if ((e as OllamaError).code) throw e
      throw this.classifyNetworkError(e, params.signal)
    } finally {
      cancel()
    }
  }

  /** POST /api/embed — returns one vector per input string. */
  async embed(params: { model: string; input: string | string[]; signal?: AbortSignal; timeoutMs?: number }): Promise<number[][]> {
    const { signal, cancel } = this.withTimeout(params.timeoutMs ?? 45_000, params.signal)
    try {
      const res = await this.fetchImpl(`${this.endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: params.model, input: params.input }),
        signal
      })
      if (res.status === 404) throw err('model_not_installed')
      if (!res.ok) throw err('bad_response', `embed_${res.status}`)
      const data = (await res.json()) as { embeddings?: number[][]; embedding?: number[] }
      if (Array.isArray(data.embeddings)) return data.embeddings
      if (Array.isArray(data.embedding)) return [data.embedding]
      throw err('bad_response')
    } catch (e) {
      if ((e as OllamaError).code) throw e
      throw this.classifyNetworkError(e, params.signal)
    } finally {
      cancel()
    }
  }
}

/** Pure parser for a single NDJSON line from /api/chat. Exported for tests. */
export function parseChatLine(line: string): { delta?: string; done?: boolean; error?: string } | null {
  let obj: {
    message?: { content?: string }
    response?: string
    done?: boolean
    error?: string
  }
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (obj.error) return { error: obj.error }
  const delta = obj.message?.content ?? obj.response ?? ''
  return { delta, done: !!obj.done }
}
