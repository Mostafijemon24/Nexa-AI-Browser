/**
 * Main-process client for the NEXA AI Gateway.
 *
 * - The renderer never sees the gateway token or talks to the gateway.
 * - The device token lives in OS SecureStorage, bound to the gateway origin.
 * - No provider credential ever exists on the client; a BYOK key passes
 *   through exactly once (HTTPS → gateway) when the user connects it.
 */

import {
  GATEWAY_ROUTES,
  DEVICE_TOKEN_RE,
  isGatewayErrorCode,
  validateGatewayUrl,
  type ChatRequest,
  type ChatUsage,
  type GatewayErrorCode,
  type HealthResponse,
  type ModelsResponse,
  type ProvidersResponse,
  type RegisterDeviceResponse,
  type UsageResponse
} from '../../shared/ai-gateway'
import type { SecretStore } from './ai-registry'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type GatewayClientErrorCode = GatewayErrorCode | 'NOT_CONFIGURED' | 'NETWORK_ERROR' | 'CANCELLED' | 'BAD_RESPONSE'

export class GatewayClientError extends Error {
  constructor(
    public code: GatewayClientErrorCode,
    public retryAfterSeconds?: number
  ) {
    super(code)
  }
}

export interface GatewayClientOptions {
  /** Raw configured URL (build- or run-time). Null/invalid → not configured. */
  baseUrl: string | null | undefined
  /** Allow http:// for loopback (development builds only). */
  allowLoopbackHttp: boolean
  secure: SecretStore
  platform?: string
  appVersion?: string
  fetch?: FetchLike
  requestTimeoutMs?: number
  streamIdleTimeoutMs?: number
}

export interface GatewayStreamResult {
  content: string
  model: string
  finishReason: string | null
  usage: ChatUsage | null
}

const TOKEN_KEY = 'ai.gateway.device'
const MODELS_TTL_MS = 60_000

/** Resolve the gateway URL from runtime env first, then the build-time value. */
export function resolveGatewayUrl(opts: { packaged: boolean }): string | null {
  const runtime = process.env.NEXA_AI_GATEWAY_URL?.trim()
  const buildTime = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.MAIN_VITE_NEXA_AI_GATEWAY_URL?.trim()
  if (runtime) return runtime
  if (buildTime) return buildTime
  return opts.packaged ? null : 'http://127.0.0.1:8787'
}

export class GatewayClient {
  private base: URL | null
  private fetchImpl: FetchLike
  private memToken: string | null = null
  private registering: Promise<string> | null = null
  private modelsCache: { value: ModelsResponse; at: number } | null = null

  constructor(private opts: GatewayClientOptions) {
    this.base = opts.baseUrl ? validateGatewayUrl(opts.baseUrl, { allowLoopbackHttp: opts.allowLoopbackHttp }) : null
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  }

  get configured(): boolean {
    return !!this.base
  }

  get origin(): string | null {
    return this.base ? this.base.origin : null
  }

  private url(path: string): string {
    if (!this.base) throw new GatewayClientError('NOT_CONFIGURED')
    return new URL(path.replace(/^\//, ''), this.base.href.endsWith('/') ? this.base.href : this.base.href + '/').toString()
  }

  /* ------------------------------- token -------------------------------- */

  private loadToken(): string | null {
    if (this.memToken) return this.memToken
    try {
      const raw = this.opts.secure.available() ? this.opts.secure.get(TOKEN_KEY) : null
      if (!raw) return null
      const parsed = JSON.parse(raw) as { origin?: string; token?: string }
      if (parsed.origin !== this.origin || !parsed.token || !DEVICE_TOKEN_RE.test(parsed.token)) return null
      this.memToken = parsed.token
      return parsed.token
    } catch {
      return null
    }
  }

  private saveToken(token: string): void {
    this.memToken = token
    try {
      if (this.opts.secure.available()) this.opts.secure.set(TOKEN_KEY, JSON.stringify({ origin: this.origin, token }))
    } catch {
      // Memory-only session when OS secure storage is unavailable.
    }
  }

  private dropToken(): void {
    this.memToken = null
    try {
      if (this.opts.secure.available()) this.opts.secure.delete(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  }

  private async register(): Promise<string> {
    if (!this.registering) {
      this.registering = (async () => {
        const res = await this.send('POST', GATEWAY_ROUTES.registerDevice, {
          body: { platform: normalizePlatform(this.opts.platform), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}) },
          auth: false
        })
        const data = (await res.json()) as RegisterDeviceResponse
        if (!data?.token || !DEVICE_TOKEN_RE.test(data.token)) throw new GatewayClientError('BAD_RESPONSE')
        this.saveToken(data.token)
        return data.token
      })().finally(() => {
        this.registering = null
      })
    }
    return this.registering
  }

  private async token(): Promise<string> {
    return this.loadToken() ?? (await this.register())
  }

  /* ------------------------------ transport ----------------------------- */

  private async send(
    method: string,
    path: string,
    opts: { body?: unknown; auth?: boolean; signal?: AbortSignal; timeoutMs?: number; accept?: string; retried?: boolean } = {}
  ): Promise<Response> {
    const auth = opts.auth !== false
    // The timeout bounds time-to-headers only; the caller's signal keeps
    // governing the response body after this returns.
    const headerDeadline = new AbortController()
    const timeout = setTimeout(() => headerDeadline.abort(), opts.timeoutMs ?? this.opts.requestTimeoutMs ?? 15_000)
    const signal = opts.signal ? AbortSignal.any([headerDeadline.signal, opts.signal]) : headerDeadline.signal
    const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      if (auth) headers.Authorization = `Bearer ${await this.token()}`
      let res: Response
      try {
        res = await this.fetchImpl(this.url(path), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal,
          redirect: 'error'
        })
      } catch {
        if (opts.signal?.aborted) throw new GatewayClientError('CANCELLED')
        throw new GatewayClientError('NETWORK_ERROR')
      }
      if (res.ok) return res
      const err = await errorFrom(res)
      if (auth && err.code === 'AUTH_REQUIRED' && !opts.retried) {
        this.dropToken()
        return this.send(method, path, { ...opts, retried: true })
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await this.send('GET', path, { signal })
    try {
      return (await res.json()) as T
    } catch {
      throw new GatewayClientError('BAD_RESPONSE')
    }
  }

  /* --------------------------------- API -------------------------------- */

  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const res = await this.send('GET', GATEWAY_ROUTES.health, { auth: false, signal, timeoutMs: 6_000 })
    return (await res.json()) as HealthResponse
  }

  async providers(): Promise<ProvidersResponse> {
    return this.getJson<ProvidersResponse>(GATEWAY_ROUTES.providers)
  }

  async usage(): Promise<UsageResponse> {
    return this.getJson<UsageResponse>(GATEWAY_ROUTES.usage)
  }

  async models(opts: { refresh?: boolean } = {}): Promise<ModelsResponse> {
    if (!opts.refresh && this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) return this.modelsCache.value
    const value = await this.getJson<ModelsResponse>(GATEWAY_ROUTES.models)
    this.modelsCache = { value, at: Date.now() }
    return value
  }

  /** Send a BYOK key to the gateway once. The client never stores it. */
  async connectOpenRouter(apiKey: string): Promise<ProvidersResponse> {
    const res = await this.send('PUT', GATEWAY_ROUTES.openrouterConnection, { body: { apiKey }, timeoutMs: 30_000 })
    this.modelsCache = null
    return (await res.json()) as ProvidersResponse
  }

  async disconnectOpenRouter(): Promise<ProvidersResponse> {
    const res = await this.send('DELETE', GATEWAY_ROUTES.openrouterConnection)
    this.modelsCache = null
    return (await res.json()) as ProvidersResponse
  }

  /** Streaming chat over SSE. Resolves with the full text; `onDelta` per chunk. */
  async stream(req: ChatRequest, opts: { signal?: AbortSignal; onDelta: (text: string) => void; timeoutMs?: number }): Promise<GatewayStreamResult> {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const total = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000)
    const idleMs = this.opts.streamIdleTimeoutMs ?? 90_000
    let idle: ReturnType<typeof setTimeout> | null = null
    let timedOut = false
    const armIdle = () => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => {
        timedOut = true
        ctrl.abort()
      }, idleMs)
    }
    try {
      const res = await this.send('POST', GATEWAY_ROUTES.stream, { body: req, signal: ctrl.signal, accept: 'text/event-stream', timeoutMs: 60_000 })
      if (!res.body) throw new GatewayClientError('BAD_RESPONSE')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let content = ''
      let model = req.model ?? req.mode
      let usage: ChatUsage | null = null
      let finishReason: string | null = null
      let event = 'message'
      let finished = false
      for (;;) {
        armIdle()
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch {
          if (opts.signal?.aborted) throw new GatewayClientError('CANCELLED')
          throw new GatewayClientError(timedOut ? 'PROVIDER_TIMEOUT' : 'NETWORK_ERROR')
        }
        if (chunk.done) break
        buf += decoder.decode(chunk.value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '')
          buf = buf.slice(nl + 1)
          if (!line) {
            event = 'message'
            continue
          }
          if (line.startsWith(':')) continue
          if (line.startsWith('event:')) {
            event = line.slice(6).trim()
            continue
          }
          if (!line.startsWith('data:')) continue
          let data: Record<string, unknown>
          try {
            data = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          if (event === 'start' && typeof data.model === 'string') model = data.model
          else if (event === 'delta' && typeof data.text === 'string' && data.text) {
            content += data.text
            opts.onDelta(data.text)
          } else if (event === 'done') {
            finished = true
            if (typeof data.model === 'string') model = data.model
            finishReason = typeof data.finishReason === 'string' ? data.finishReason : null
            const u = data.usage as ChatUsage | undefined
            if (u && typeof u.inputTokens === 'number' && typeof u.outputTokens === 'number') usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens }
          } else if (event === 'error') {
            throw new GatewayClientError(isGatewayErrorCode(data.code) ? data.code : 'PROVIDER_ERROR')
          }
        }
      }
      // A stream that ends without `done` was cut off (proxy/network drop).
      if (!finished) throw new GatewayClientError(opts.signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR')
      return { content, model, finishReason, usage }
    } catch (e) {
      if (e instanceof GatewayClientError) {
        if (e.code === 'NETWORK_ERROR' && opts.signal?.aborted) throw new GatewayClientError('CANCELLED')
        if (e.code === 'CANCELLED' && !opts.signal?.aborted) throw new GatewayClientError('PROVIDER_TIMEOUT')
        throw e
      }
      throw new GatewayClientError(opts.signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR')
    } finally {
      clearTimeout(total)
      if (idle) clearTimeout(idle)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
}

function normalizePlatform(p?: string): 'darwin' | 'win32' | 'linux' | 'other' {
  return p === 'darwin' || p === 'win32' || p === 'linux' ? p : 'other'
}

async function errorFrom(res: Response): Promise<GatewayClientError> {
  let code: GatewayClientErrorCode = res.status === 401 ? 'AUTH_REQUIRED' : res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'AI_SERVICE_UNAVAILABLE' : 'INVALID_REQUEST'
  let retryAfter: number | undefined
  try {
    const body = (await res.json()) as { error?: { code?: unknown; retryAfterSeconds?: unknown } }
    if (isGatewayErrorCode(body?.error?.code)) code = body.error.code
    if (typeof body?.error?.retryAfterSeconds === 'number') retryAfter = body.error.retryAfterSeconds
  } catch {
    /* non-JSON error body */
  }
  return new GatewayClientError(code, retryAfter)
}
