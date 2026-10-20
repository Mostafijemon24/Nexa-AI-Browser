/**
 * NEXA AI Gateway — request pipeline.
 *
 *   request → security headers/CORS → HTTPS check → per-IP limit
 *           → authentication (device bearer token, server-side lookup)
 *           → per-device / per-user limits → validation + size limits
 *           → model router → concurrency gate → daily quota
 *           → provider adapter (server key or decrypted BYOK) → response/SSE
 *
 * Identity, quota, entitlement and provider authorization are derived from
 * server-side state only; nothing in the request body can assert them.
 */

import { createHmac, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  GATEWAY_API_VERSION,
  GATEWAY_ROUTES,
  DEVICE_TOKEN_RE,
  chatRequestSchema,
  connectProviderSchema,
  registerDeviceSchema,
  type AIMode,
  type ChatRequest,
  type ChatResponse,
  type ChatUsage,
  type HealthResponse,
  type ModelsResponse,
  type ProviderConnectionInfo,
  type ProvidersResponse,
  type RegisterDeviceResponse,
  type UsageResponse
} from '../../src/shared/ai-gateway'
import type { GatewayConfig, TierLimits } from './config'
import { hashToken, keyHint, newId, newToken, openCredential, sealCredential } from './crypto'
import type { GatewayStore } from './db'
import { GatewayError, asGatewayError } from './errors'
import { SseWriter, applySecurityHeaders, bearerToken, clientIp, peerIsTrustworthy, readJson, sendError, sendJson } from './http'
import { ConcurrencyGate, SlidingWindowLimiter, estimateTokens, utcDay } from './limits'
import type { Logger } from './log'
import { ModelCatalog, ModelRouter } from './router'
import { ProviderError, type AIProviderAdapter } from './providers/types'

const BYOK_PROVIDER = 'openrouter'
const MINUTE = 60_000
const DAY = 86_400_000

interface AuthContext {
  userId: string
  deviceId: string
}

interface RequestContext {
  ip: string
  ipHash: string
  started: number
}

export interface GatewayDeps {
  config: GatewayConfig
  store: GatewayStore
  provider: AIProviderAdapter
  log: Logger
  now?: () => number
}

export interface Gateway {
  handle(req: IncomingMessage, res: ServerResponse): void
  catalog: ModelCatalog
  dispose(): void
}

export function createGateway(deps: GatewayDeps): Gateway {
  const { config: cfg, store, provider, log } = deps
  const now = deps.now ?? Date.now
  const catalog = new ModelCatalog(provider, cfg, log, now)
  const router = new ModelRouter(catalog, cfg)
  const minute = new SlidingWindowLimiter(MINUTE)
  const hourly = new SlidingWindowLimiter(60 * MINUTE)
  const concurrency = new ConcurrencyGate()
  // IPs are stored only as keyed hashes; the salt never leaves the process.
  const ipSalt = cfg.encryptionKey ? createHmac('sha256', cfg.encryptionKey).update('nexa-ip-salt').digest() : randomBytes(32)
  const hashIp = (ip: string) => createHmac('sha256', ipSalt).update(ip).digest('hex').slice(0, 32)

  const pruneTimer = setInterval(() => {
    try {
      store.prune(now(), cfg.auditRetentionDays * DAY)
    } catch (e) {
      log.warn('prune failed', { error: e })
    }
  }, 60 * MINUTE)
  pruneTimer.unref?.()

  /* ------------------------------- helpers ------------------------------- */

  function limit(key: string, max: number, limiter = minute): void {
    const r = limiter.check(key, max, now())
    if (!r.ok) throw new GatewayError('RATE_LIMITED', key.split(':')[0], r.retryAfterSeconds)
  }

  function authenticate(req: IncomingMessage): AuthContext {
    const token = bearerToken(req)
    if (!token || !DEVICE_TOKEN_RE.test(token)) throw new GatewayError('AUTH_REQUIRED', 'missing_or_malformed_token')
    const device = store.deviceByTokenHash(hashToken(token))
    const t = now()
    if (!device || device.revokedAt != null || device.expiresAt <= t) throw new GatewayError('AUTH_REQUIRED', 'unknown_revoked_or_expired')
    if (device.userStatus !== 'active') throw new GatewayError('FORBIDDEN', 'account_suspended')
    store.touchDevice(device.id, t, t + cfg.tokenTtlDays * DAY)
    return { userId: device.userId, deviceId: device.id }
  }

  function tier(mode: AIMode): TierLimits {
    return mode === 'premium' ? cfg.limits.premium : cfg.limits.free
  }

  function premiumConnected(userId: string): boolean {
    return !!store.getConnection(userId, BYOK_PROVIDER)
  }

  function secondsUntilUtcMidnight(): number {
    const t = now()
    return Math.max(1, Math.ceil((Math.ceil(t / DAY) * DAY - t) / 1000))
  }

  function mapProviderError(e: ProviderError, mode: AIMode): GatewayError {
    switch (e.kind) {
      case 'auth':
        // A rejected server key is an operator problem, not the user's.
        return mode === 'premium' ? new GatewayError('INVALID_PROVIDER_KEY', 'byok_rejected') : new GatewayError('AI_SERVICE_UNAVAILABLE', 'server_key_rejected')
      case 'credits':
        return mode === 'premium' ? new GatewayError('PROVIDER_ERROR', 'byok_insufficient_credits') : new GatewayError('AI_SERVICE_UNAVAILABLE', 'server_credits_exhausted')
      case 'rate_limited':
        return new GatewayError('RATE_LIMITED', 'upstream_rate_limited', 30)
      case 'model_unavailable':
        return new GatewayError('MODEL_UNAVAILABLE', 'upstream_model_unavailable')
      case 'bad_request':
        return new GatewayError('INVALID_REQUEST', 'upstream_bad_request')
      case 'timeout':
        return new GatewayError('PROVIDER_TIMEOUT')
      default:
        return new GatewayError('PROVIDER_ERROR', `upstream_${e.kind}`)
    }
  }

  /** Resolve the credential for a routed request. Decrypted keys stay in this scope. */
  function credentialFor(userId: string, credential: 'server' | 'byok'): string {
    if (credential === 'server') {
      if (!cfg.openrouterApiKey) throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'server_key_missing')
      return cfg.openrouterApiKey
    }
    if (!cfg.encryptionKey) throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'encryption_key_missing')
    const row = store.getConnection(userId, BYOK_PROVIDER)
    if (!row) throw new GatewayError('PREMIUM_NOT_CONNECTED')
    try {
      return openCredential(cfg.encryptionKey, userId, BYOK_PROVIDER, row)
    } catch {
      throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'byok_decrypt_failed')
    }
  }

  /* ----------------------------- AI pipeline ----------------------------- */

  interface Prepared {
    body: ChatRequest
    mode: AIMode
    model: string
    maxOutputTokens: number
    inputEstimate: number
    day: string
    release: () => void
    /** Return every daily reservation taken for this request. */
    refund: () => void
    credential: 'server' | 'byok'
  }

  /**
   * Consume the daily quota for a request. Free requests also draw from the
   * per-IP bucket (so minting devices cannot multiply the free quota) and the
   * optional global bucket that caps total server-key usage.
   */
  function reserveQuota(auth: AuthContext, ctx: RequestContext, mode: AIMode, day: string): () => void {
    const taken: (() => void)[] = []
    const undo = () => {
      while (taken.length) taken.pop()!()
    }
    if (!store.reserveDaily(auth.userId, day, mode, tier(mode).requestsPerDay)) throw new GatewayError('QUOTA_EXCEEDED', 'daily_user', secondsUntilUtcMidnight())
    taken.push(() => store.refundDaily(auth.userId, day, mode))
    if (mode === 'free') {
      const ipBucket = `ip:${ctx.ipHash}`
      if (!store.reserveBucket(ipBucket, day, cfg.limits.freeIpPerDay)) {
        undo()
        throw new GatewayError('QUOTA_EXCEEDED', 'daily_ip', secondsUntilUtcMidnight())
      }
      taken.push(() => store.refundBucket(ipBucket, day))
      if (cfg.limits.freeGlobalPerDay > 0) {
        if (!store.reserveBucket('global:free', day, cfg.limits.freeGlobalPerDay)) {
          undo()
          throw new GatewayError('QUOTA_EXCEEDED', 'daily_global', secondsUntilUtcMidnight())
        }
        taken.push(() => store.refundBucket('global:free', day))
      }
    }
    let done = false
    return () => {
      if (done) return
      done = true
      undo()
    }
  }

  async function prepareChat(req: IncomingMessage, auth: AuthContext, ctx: RequestContext): Promise<Prepared> {
    const parsed = chatRequestSchema.safeParse(await readJson(req, cfg.maxBodyBytes))
    if (!parsed.success) throw new GatewayError('INVALID_REQUEST', 'schema')
    const body = parsed.data
    const limits = tier(body.mode)
    limit(`user:${body.mode}:${auth.userId}`, limits.requestsPerMinute)
    const inputEstimate = body.messages.reduce((n, m) => n + estimateTokens(m.content), 0)
    if (inputEstimate > limits.maxInputTokens) throw new GatewayError('PAYLOAD_TOO_LARGE', 'input_tokens')
    const decision = await router.route({ mode: body.mode, model: body.model, premiumConnected: premiumConnected(auth.userId) })
    const release = concurrency.acquire(auth.userId, cfg.limits.maxConcurrentPerUser)
    if (!release) throw new GatewayError('RATE_LIMITED', 'concurrency', 5)
    const day = utcDay(now())
    let refund: () => void
    try {
      refund = reserveQuota(auth, ctx, decision.mode, day)
    } catch (e) {
      release()
      throw e
    }
    return {
      body,
      mode: decision.mode,
      model: decision.model,
      maxOutputTokens: Math.min(body.maxOutputTokens ?? limits.maxOutputTokens, limits.maxOutputTokens),
      inputEstimate,
      day,
      release,
      refund,
      credential: decision.credential
    }
  }

  function abortOnDisconnect(req: IncomingMessage, res: ServerResponse): AbortController {
    const ctrl = new AbortController()
    const onClose = () => {
      if (!res.writableFinished) ctrl.abort()
    }
    res.on('close', onClose)
    req.on('aborted', () => ctrl.abort())
    return ctrl
  }

  function finishUsage(p: Prepared, auth: AuthContext, usage: ChatUsage | null, outputText: string): ChatUsage {
    const u = usage ?? { inputTokens: p.inputEstimate, outputTokens: estimateTokens(outputText) }
    store.addTokens(auth.userId, p.day, p.mode, u.inputTokens, u.outputTokens)
    return u
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse, auth: AuthContext, ctx: RequestContext): Promise<void> {
    const p = await prepareChat(req, auth, ctx)
    const ctrl = abortOnDisconnect(req, res)
    let apiKey: string | null = null
    try {
      apiKey = credentialFor(auth.userId, p.credential)
      const result = await provider.chat({ apiKey, model: p.model, messages: p.body.messages, maxOutputTokens: p.maxOutputTokens, temperature: p.body.temperature, signal: ctrl.signal })
      apiKey = null
      const usage = finishUsage(p, auth, result.usage.inputTokens || result.usage.outputTokens ? result.usage : null, result.content)
      const out: ChatResponse = { id: newId('chat'), mode: p.mode, model: result.model, content: result.content, finishReason: result.finishReason, usage }
      sendJson(res, 200, out)
      audit(auth, ctx, 'chat', p, 200, null, usage)
    } catch (e) {
      apiKey = null
      p.refund()
      const err = e instanceof ProviderError ? mapProviderError(e, p.mode) : asGatewayError(e)
      audit(auth, ctx, 'chat', p, err.status, err.code, null)
      if (e instanceof ProviderError && e.kind === 'cancelled') return
      throw err
    } finally {
      p.release()
    }
  }

  async function handleStream(req: IncomingMessage, res: ServerResponse, auth: AuthContext, ctx: RequestContext): Promise<void> {
    const p = await prepareChat(req, auth, ctx)
    const ctrl = abortOnDisconnect(req, res)
    let apiKey: string | null = null
    let sse: SseWriter | null = null
    let text = ''
    try {
      apiKey = credentialFor(auth.userId, p.credential)
      const iter = provider.stream({ apiKey, model: p.model, messages: p.body.messages, maxOutputTokens: p.maxOutputTokens, temperature: p.body.temperature, signal: ctrl.signal })
      apiKey = null
      const id = newId('chat')
      for await (const chunk of iter) {
        if (!sse) {
          sse = new SseWriter(res)
          sse.send('start', { id, mode: p.mode, model: p.model })
        }
        if (chunk.type === 'delta') {
          text += chunk.text
          sse.send('delta', { text: chunk.text })
        } else {
          const usage = finishUsage(p, auth, chunk.usage, text)
          sse.send('done', { model: chunk.model, finishReason: chunk.finishReason, usage })
          audit(auth, ctx, 'stream', p, 200, null, usage)
        }
      }
      sse?.end()
    } catch (e) {
      apiKey = null
      const err = e instanceof ProviderError ? mapProviderError(e, p.mode) : asGatewayError(e)
      if (!text) p.refund()
      else finishUsage(p, auth, null, text)
      audit(auth, ctx, 'stream', p, err.status, e instanceof ProviderError && e.kind === 'cancelled' ? 'CANCELLED' : err.code, null)
      if (e instanceof ProviderError && e.kind === 'cancelled') {
        sse?.end()
        return
      }
      if (sse) {
        sse.send('error', err.body().error)
        sse.end()
        return
      }
      throw err
    } finally {
      p.release()
    }
  }

  function audit(auth: AuthContext | null, ctx: RequestContext, event: string, p: Pick<Prepared, 'mode' | 'model'> | null, status: number, errorCode: string | null, usage: ChatUsage | null): void {
    try {
      store.audit(
        {
          userId: auth?.userId,
          deviceId: auth?.deviceId,
          ipHash: ctx.ipHash,
          event,
          mode: p?.mode,
          model: p?.model,
          status,
          errorCode,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          latencyMs: now() - ctx.started
        },
        now()
      )
    } catch (e) {
      log.warn('audit write failed', { error: e })
    }
  }

  /* ------------------------------- routes -------------------------------- */

  function providerInfo(userId: string): ProviderConnectionInfo[] {
    const row = store.getConnection(userId, BYOK_PROVIDER)
    return [
      { id: 'nexa-free', kind: 'free', label: 'NEXA Free AI', connected: !!cfg.openrouterApiKey, requiresKey: false },
      {
        id: 'openrouter',
        kind: 'byok',
        label: 'OpenRouter',
        connected: !!row,
        requiresKey: true,
        ...(row?.keyHint ? { keyHint: row.keyHint } : {}),
        ...(row?.lastValidatedAt ? { lastValidatedAt: new Date(row.lastValidatedAt).toISOString() } : {})
      }
    ]
  }

  async function route(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
    const url = new URL(req.url || '/', 'http://gateway.local')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method || 'GET'

    if (path === GATEWAY_ROUTES.health) {
      if (method !== 'GET') throw new GatewayError('METHOD_NOT_ALLOWED')
      const configured = !!cfg.openrouterApiKey && !!cfg.encryptionKey
      const body: HealthResponse = { status: configured ? 'ok' : 'degraded', provider: 'openrouter', configured, version: GATEWAY_API_VERSION }
      return sendJson(res, 200, body)
    }

    limit(`ip:${ctx.ipHash}`, cfg.limits.ipPerMinute)

    if (path === GATEWAY_ROUTES.registerDevice) {
      if (method === 'POST') {
        limit(`reg:${ctx.ipHash}`, cfg.limits.registrationsPerIpPerHour, hourly)
        const parsed = registerDeviceSchema.safeParse(await readJson(req, 4096))
        if (!parsed.success) throw new GatewayError('INVALID_REQUEST', 'schema')
        const token = newToken()
        const t = now()
        const expiresAt = t + cfg.tokenTtlDays * DAY
        const userId = newId('usr')
        const deviceId = newId('dev')
        store.createUserWithDevice({ userId, deviceId, tokenHash: hashToken(token), platform: parsed.data.platform, appVersion: parsed.data.appVersion, now: t, expiresAt })
        audit({ userId, deviceId }, ctx, 'register', null, 201, null, null)
        const body: RegisterDeviceResponse = { token, expiresAt: new Date(expiresAt).toISOString() }
        return sendJson(res, 201, body)
      }
      if (method === 'DELETE') {
        const auth = authenticate(req)
        store.revokeDevice(auth.deviceId, now())
        audit(auth, ctx, 'revoke', null, 200, null, null)
        return sendJson(res, 200, { revoked: true })
      }
      throw new GatewayError('METHOD_NOT_ALLOWED')
    }

    const known = (Object.values(GATEWAY_ROUTES) as string[]).includes(path)
    if (!known) throw new GatewayError('NOT_FOUND')

    // Everything below requires an authenticated device session.
    const auth = authenticate(req)
    limit(`device:${auth.deviceId}`, cfg.limits.devicePerMinute)

    switch (path) {
      case GATEWAY_ROUTES.chat:
        if (method !== 'POST') throw new GatewayError('METHOD_NOT_ALLOWED')
        return handleChat(req, res, auth, ctx)
      case GATEWAY_ROUTES.stream:
        if (method !== 'POST') throw new GatewayError('METHOD_NOT_ALLOWED')
        return handleStream(req, res, auth, ctx)
      case GATEWAY_ROUTES.models: {
        if (method !== 'GET') throw new GatewayError('METHOD_NOT_ALLOWED')
        const connected = premiumConnected(auth.userId)
        const body: ModelsResponse = {
          defaults: { free: cfg.models.freeDefault, premium: cfg.models.premiumDefault },
          free: await catalog.freeModels(),
          premium: connected ? await catalog.premiumModels() : [],
          premiumAvailable: connected,
          updatedAt: new Date(catalog.updatedAt ?? now()).toISOString()
        }
        return sendJson(res, 200, body)
      }
      case GATEWAY_ROUTES.usage: {
        if (method !== 'GET') throw new GatewayError('METHOD_NOT_ALLOWED')
        const day = utcDay(now())
        const f = store.usage(auth.userId, day, 'free')
        const pr = store.usage(auth.userId, day, 'premium')
        const body: UsageResponse = {
          day,
          free: { ...f, limit: cfg.limits.free.requestsPerDay },
          premium: { ...pr, limit: cfg.limits.premium.requestsPerDay },
          limits: { requestsPerMinute: cfg.limits.free.requestsPerMinute, maxInputTokens: cfg.limits.free.maxInputTokens, maxOutputTokens: cfg.limits.free.maxOutputTokens }
        }
        return sendJson(res, 200, body)
      }
      case GATEWAY_ROUTES.providers: {
        if (method !== 'GET') throw new GatewayError('METHOD_NOT_ALLOWED')
        const body: ProvidersResponse = { providers: providerInfo(auth.userId) }
        return sendJson(res, 200, body)
      }
      case GATEWAY_ROUTES.openrouterConnection: {
        if (method === 'PUT') {
          limit(`connect:${auth.userId}`, 5)
          if (!cfg.encryptionKey) throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'encryption_key_missing')
          const parsed = connectProviderSchema.safeParse(await readJson(req, 4096))
          if (!parsed.success) throw new GatewayError('INVALID_REQUEST', 'schema')
          let apiKey: string | null = parsed.data.apiKey
          try {
            let valid: boolean
            try {
              valid = await provider.validateKey(apiKey)
            } catch {
              throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'key_validation_unreachable')
            }
            if (!valid) throw new GatewayError('INVALID_PROVIDER_KEY')
            const sealed = sealCredential(cfg.encryptionKey, auth.userId, BYOK_PROVIDER, apiKey)
            const t = now()
            store.upsertConnection({ userId: auth.userId, provider: BYOK_PROVIDER, ...sealed, keyHint: keyHint(apiKey), lastValidatedAt: t, now: t })
          } finally {
            apiKey = null
          }
          audit(auth, ctx, 'byok_connect', null, 200, null, null)
          const body: ProvidersResponse = { providers: providerInfo(auth.userId) }
          return sendJson(res, 200, body)
        }
        if (method === 'DELETE') {
          store.deleteConnection(auth.userId, BYOK_PROVIDER)
          audit(auth, ctx, 'byok_disconnect', null, 200, null, null)
          const body: ProvidersResponse = { providers: providerInfo(auth.userId) }
          return sendJson(res, 200, body)
        }
        throw new GatewayError('METHOD_NOT_ALLOWED')
      }
    }
    throw new GatewayError('NOT_FOUND')
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const ctx: RequestContext = { ip: '', ipHash: '', started: now() }
    // Honor X-Forwarded-* only when the direct TCP peer is a loopback/private
    // address (our own reverse proxy). A direct public client cannot then spoof
    // its IP or forge the HTTPS gate.
    const peerTrusted = cfg.trustProxy && peerIsTrustworthy(req.socket.remoteAddress)
    const secure = !!cfg.tls || (peerTrusted && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https')
    applySecurityHeaders(res, { hsts: cfg.env === 'production' })

    const origin = req.headers.origin
    if (origin) {
      if (!cfg.corsOrigins.includes(origin)) return sendError(res, new GatewayError('FORBIDDEN', 'cors_origin'))
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600'
        })
        return void res.end()
      }
    }

    ctx.ip = clientIp(req, peerTrusted)
    ctx.ipHash = hashIp(ctx.ip)
    const isHealth = (req.url || '').split('?')[0].replace(/\/+$/, '') === GATEWAY_ROUTES.health
    if (cfg.env === 'production' && !secure && !isHealth) return sendError(res, new GatewayError('FORBIDDEN', 'https_required'))

    route(req, res, ctx).catch((e) => {
      const err = asGatewayError(e)
      if (err.status >= 500) log.error('request failed', { code: err.code, detail: err.detail, method: req.method, path: (req.url || '').split('?')[0] })
      else log.info('request rejected', { code: err.code, detail: err.detail, method: req.method, path: (req.url || '').split('?')[0] })
      if (!res.headersSent) sendError(res, err)
      else if (!res.writableEnded) res.end()
    })
  }

  return {
    handle,
    catalog,
    dispose: () => clearInterval(pruneTimer)
  }
}
