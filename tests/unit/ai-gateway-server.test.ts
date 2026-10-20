import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../server/src/config'
import { hashToken, openCredential, sealCredential } from '../../server/src/crypto'
import { redact, redactString } from '../../server/src/log'
import { matchesAllow } from '../../server/src/router'
import { ENC_KEY_HEX, SERVER_KEY, VALID_BYOK, call, parseSse, register, startGateway, startUpstream, userMsg, type FakeUpstream, type TestGateway } from './gateway-harness'

let upstream: FakeUpstream
let gw: TestGateway

beforeAll(async () => {
  upstream = await startUpstream()
  gw = await startGateway(upstream)
})
afterAll(async () => {
  await gw.close()
  await upstream.close()
})
beforeEach(() => {
  upstream.mode = 'ok'
  upstream.calls.length = 0
})

const chatCalls = () => upstream.calls.filter((c) => c.path === '/chat/completions')

describe('health', () => {
  it('reports status without exposing credentials', async () => {
    const res = await call(gw, '/api/ai/health')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ status: 'ok', provider: 'openrouter', configured: true, version: 1 })
    expect(text).not.toContain(SERVER_KEY)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('authentication', () => {
  it('rejects unauthenticated, malformed and unknown tokens with AUTH_REQUIRED', async () => {
    for (const token of [undefined, 'garbage', 'nxa_' + 'A'.repeat(43)]) {
      const res = await call(gw, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })
      expect(res.status).toBe(401)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('AUTH_REQUIRED')
      expect(res.headers.get('www-authenticate')).toBe('Bearer')
    }
    expect(chatCalls()).toHaveLength(0)
  })

  it('stores only a hash of the device token and rejects revoked tokens', async () => {
    const token = await register(gw)
    expect(token).toMatch(/^nxa_[A-Za-z0-9_-]{43}$/)
    expect((await call(gw, '/api/ai/usage', { token })).status).toBe(200)
    const revoke = await call(gw, '/api/auth/device', { method: 'DELETE', token })
    expect(revoke.status).toBe(200)
    expect((await call(gw, '/api/ai/usage', { token })).status).toBe(401)
  })

  it('ignores client-asserted identity, quota or entitlement fields', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', userId: 'usr_admin', premium: true, messages: [userMsg()] } })
    expect(res.status).toBe(400) // strict schema: unknown fields rejected
    const res2 = await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', messages: [userMsg()] } })
    expect(res2.status).toBe(403)
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe('PREMIUM_NOT_CONNECTED')
  })
})

describe('free AI routing', () => {
  it('routes free mode to the server default model with the server credential', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()], maxOutputTokens: 30_000 } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: string; mode: string; model: string; usage: { inputTokens: number; outputTokens: number } }
    expect(body.content).toBe('Hello world')
    expect(body.mode).toBe('free')
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(body.usage).toEqual({ inputTokens: 11, outputTokens: 2 })
    const [c] = chatCalls()
    expect(c.body?.model).toBe('openrouter/free')
    expect(c.authorization).toBe(`Bearer ${SERVER_KEY}`)
    expect(c.body?.max_tokens).toBe(gw.config.limits.free.maxOutputTokens) // clamped server-side
  })

  it('never lets free mode reach a paid model', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/chat', { token, body: { mode: 'free', model: 'openai/gpt-4o', messages: [userMsg()] } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MODEL_UNAVAILABLE')
    expect(chatCalls()).toHaveLength(0)
    const ok = await call(gw, '/api/ai/chat', { token, body: { mode: 'free', model: 'meta-llama/llama-3.3-70b-instruct:free', messages: [userMsg()] } })
    expect(ok.status).toBe(200)
  })

  it('maps a rejected server key to AI_SERVICE_UNAVAILABLE and refunds quota', async () => {
    const token = await register(gw)
    upstream.mode = 'auth_error'
    const res = await call(gw, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text).error.code).toBe('AI_SERVICE_UNAVAILABLE')
    expect(text).not.toMatch(/auth|credential|openrouter/i)
    const usage = (await (await call(gw, '/api/ai/usage', { token })).json()) as { free: { requests: number } }
    expect(usage.free.requests).toBe(0)
  })
})

describe('model discovery', () => {
  it('exposes only allowed text models, separated into free and premium', async () => {
    const token = await register(gw)
    const m = (await (await call(gw, '/api/ai/models', { token })).json()) as { defaults: { free: string }; free: { id: string }[]; premium: unknown[]; premiumAvailable: boolean }
    expect(m.defaults.free).toBe('openrouter/free')
    const ids = m.free.map((x) => x.id)
    expect(ids).toContain('openrouter/free')
    expect(ids).toContain('meta-llama/llama-3.3-70b-instruct:free')
    expect(ids).not.toContain('openai/gpt-4o')
    expect(ids).not.toContain('black-forest-labs/flux') // image-only
    expect(m.premiumAvailable).toBe(false)
    expect(m.premium).toEqual([])
  })

  it('caches the upstream catalog', async () => {
    const token = await register(gw)
    await call(gw, '/api/ai/models', { token })
    await call(gw, '/api/ai/models', { token })
    expect(upstream.calls.filter((c) => c.path === '/models').length).toBeLessThanOrEqual(1)
  })

  it('allow-list patterns match exact, prefix and suffix', () => {
    expect(matchesAllow('a/b:free', ['*:free'])).toBe(true)
    expect(matchesAllow('openai/gpt-4o', ['openai/*'])).toBe(true)
    expect(matchesAllow('openai/gpt-4o', ['anthropic/*', 'x'])).toBe(false)
    expect(matchesAllow('anything', ['*'])).toBe(true)
  })
})

describe('streaming', () => {
  it('streams start → delta → done with usage over SSE', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/stream', { token, body: { mode: 'free', messages: [userMsg()] } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const events = parseSse(await res.text())
    expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'done'])
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('Hello world')
    expect(events[3].data.usage).toEqual({ inputTokens: 11, outputTokens: 2 })
    expect(chatCalls()[0].body?.stream).toBe(true)
  })

  it('emits a normalized SSE error when the provider fails mid-stream', async () => {
    const token = await register(gw)
    upstream.mode = 'mid_stream_error'
    const events = parseSse(await (await call(gw, '/api/ai/stream', { token, body: { mode: 'free', messages: [userMsg()] } })).text())
    const last = events[events.length - 1]
    expect(last.event).toBe('error')
    expect(last.data.code).toBe('PROVIDER_ERROR')
  })

  it('returns PROVIDER_TIMEOUT when the provider hangs and refunds the quota', async () => {
    const token = await register(gw)
    upstream.mode = 'hang'
    const res = await call(gw, '/api/ai/stream', { token, body: { mode: 'free', messages: [userMsg()] } })
    expect(res.status).toBe(504)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PROVIDER_TIMEOUT')
    const usage = (await (await call(gw, '/api/ai/usage', { token })).json()) as { free: { requests: number } }
    expect(usage.free.requests).toBe(0)
  })
})

describe('request validation', () => {
  it('rejects malformed, oversized and wrongly typed requests', async () => {
    const token = await register(gw)
    const cases: { body: unknown; headers?: Record<string, string>; status: number }[] = [
      { body: { mode: 'gold', messages: [userMsg()] }, status: 400 },
      { body: { mode: 'free', messages: [] }, status: 400 },
      { body: { mode: 'free', messages: [{ role: 'tool', content: 'x' }] }, status: 400 },
      { body: { mode: 'free', messages: Array.from({ length: 61 }, () => userMsg()) }, status: 400 },
      { body: { mode: 'free', model: '../../etc/passwd!', messages: [userMsg()] }, status: 400 },
      { body: '{not json', status: 400 },
      { body: { mode: 'free', messages: [userMsg()] }, headers: { 'content-type': 'text/plain' }, status: 400 },
      { body: { mode: 'free', messages: [userMsg('x'.repeat(600_000))] }, status: 413 },
      { body: { mode: 'free', messages: [userMsg('x'.repeat(100_000))] }, status: 413 } // > AI_MAX_INPUT_TOKENS
    ]
    for (const c of cases) {
      const res = await call(gw, '/api/ai/chat', { token, body: c.body, headers: c.headers })
      expect(res.status, JSON.stringify(c.body).slice(0, 60)).toBe(c.status)
    }
    expect(chatCalls()).toHaveLength(0)
  })

  it('returns NOT_FOUND / METHOD_NOT_ALLOWED without stack traces', async () => {
    const token = await register(gw)
    const nf = await call(gw, '/api/ai/nope', { token })
    expect(nf.status).toBe(404)
    const mna = await call(gw, '/api/ai/chat', { token })
    expect(mna.status).toBe(405)
    expect(await mna.text()).not.toMatch(/at \w+ \(/)
  })
})

describe('premium / BYOK', () => {
  it('rejects an invalid OpenRouter key without storing anything', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/providers/openrouter', { method: 'PUT', token, body: { apiKey: 'sk-or-v1-invalid-key-000000000000' } })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_PROVIDER_KEY')
    const p = (await (await call(gw, '/api/ai/providers', { token })).json()) as { providers: { id: string; connected: boolean }[] }
    expect(p.providers.find((x) => x.id === 'openrouter')?.connected).toBe(false)
  })

  it('encrypts the key at rest, never returns it, and routes premium with it', async () => {
    const token = await register(gw)
    const res = await call(gw, '/api/ai/providers/openrouter', { method: 'PUT', token, body: { apiKey: VALID_BYOK } })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(VALID_BYOK)
    expect(text).not.toMatch(/apiKey|decrypted|secret/)
    const info = JSON.parse(text).providers.find((x: { id: string }) => x.id === 'openrouter')
    expect(info).toMatchObject({ connected: true, label: 'OpenRouter', keyHint: '…' + VALID_BYOK.slice(-4) })
    expect(info.lastValidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Ciphertext only in the database.
    const row = gw.store.rawConnectionRow(userIdOf(token), 'openrouter')!
    const raw = Buffer.from(row.ciphertext as Uint8Array).toString('latin1')
    expect(raw).not.toContain(VALID_BYOK)
    expect(JSON.stringify(row)).not.toContain(VALID_BYOK)

    // Premium chat uses the BYOK key, not the server key.
    const chat = await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', messages: [userMsg()] } })
    expect(chat.status).toBe(200)
    const c = chatCalls().at(-1)!
    expect(c.authorization).toBe(`Bearer ${VALID_BYOK}`)
    expect(c.body?.model).toBe('openrouter/auto')

    // Premium models now listed; specific premium model routes; non-allowed rejected.
    const m = (await (await call(gw, '/api/ai/models', { token })).json()) as { premium: { id: string }[]; premiumAvailable: boolean }
    expect(m.premiumAvailable).toBe(true)
    expect(m.premium.map((x) => x.id)).toContain('openai/gpt-4o')
    expect(m.premium.some((x) => x.id.endsWith(':free') || x.id === 'openrouter/free')).toBe(false) // free models live in the free list
    expect((await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', model: 'openai/gpt-4o', messages: [userMsg()] } })).status).toBe(200)
    expect((await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', model: 'black-forest-labs/flux', messages: [userMsg()] } })).status).toBe(400)

    // Another user cannot see or use this connection.
    const other = await register(gw)
    const op = (await (await call(gw, '/api/ai/providers', { token: other })).json()) as { providers: { id: string; connected: boolean }[] }
    expect(op.providers.find((x) => x.id === 'openrouter')?.connected).toBe(false)
    expect((await call(gw, '/api/ai/chat', { token: other, body: { mode: 'premium', messages: [userMsg()] } })).status).toBe(403)

    // Disconnect removes the credential.
    const del = await call(gw, '/api/ai/providers/openrouter', { method: 'DELETE', token })
    expect(del.status).toBe(200)
    expect(gw.store.rawConnectionRow(userIdOf(token), 'openrouter')).toBeUndefined()
  })

  it('binds ciphertext to its owner (AAD) and rejects tampering', () => {
    const key = Buffer.from(ENC_KEY_HEX, 'hex')
    const sealed = sealCredential(key, 'usr_a', 'openrouter', VALID_BYOK)
    expect(openCredential(key, 'usr_a', 'openrouter', sealed)).toBe(VALID_BYOK)
    expect(() => openCredential(key, 'usr_b', 'openrouter', sealed)).toThrow()
    const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))) }
    expect(() => openCredential(key, 'usr_a', 'openrouter', tampered)).toThrow()
    expect(() => openCredential(Buffer.alloc(32, 7), 'usr_a', 'openrouter', sealed)).toThrow()
  })
})

describe('rate limiting and quotas', () => {
  it('enforces the per-user per-minute limit with Retry-After', async () => {
    const g = await startGateway(upstream, { AI_FREE_REQUESTS_PER_MINUTE: '2' })
    try {
      const token = await register(g)
      for (let i = 0; i < 2; i++) expect((await call(g, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })).status).toBe(200)
      const res = await call(g, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })
      expect(res.status).toBe(429)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    } finally {
      await g.close()
    }
  })

  it('enforces per-IP and per-device limits', async () => {
    const g = await startGateway(upstream, { AI_IP_REQUESTS_PER_MINUTE: '3' })
    try {
      const token = await register(g)
      await call(g, '/api/ai/usage', { token })
      await call(g, '/api/ai/usage', { token })
      expect((await call(g, '/api/ai/usage', { token })).status).toBe(429)
    } finally {
      await g.close()
    }
    const d = await startGateway(upstream, { AI_DEVICE_REQUESTS_PER_MINUTE: '2' })
    try {
      const token = await register(d)
      await call(d, '/api/ai/usage', { token })
      await call(d, '/api/ai/usage', { token })
      expect((await call(d, '/api/ai/usage', { token })).status).toBe(429)
      const fresh = await register(d) // a different device is unaffected
      expect((await call(d, '/api/ai/usage', { token: fresh })).status).toBe(200)
    } finally {
      await d.close()
    }
  })

  it('limits device registrations per IP', async () => {
    const g = await startGateway(upstream, { AI_DEVICE_REGISTRATIONS_PER_IP_PER_HOUR: '2' })
    try {
      await register(g)
      await register(g)
      await expect(register(g)).rejects.toThrow('429')
    } finally {
      await g.close()
    }
  })

  it('enforces the persistent daily quota with QUOTA_EXCEEDED', async () => {
    const g = await startGateway(upstream, { AI_FREE_REQUESTS_PER_DAY: '2' })
    try {
      const token = await register(g)
      for (let i = 0; i < 2; i++) expect((await call(g, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })).status).toBe(200)
      const res = await call(g, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })
      expect(res.status).toBe(429)
      const body = (await res.json()) as { error: { code: string; retryAfterSeconds: number } }
      expect(body.error.code).toBe('QUOTA_EXCEEDED')
      expect(body.error.retryAfterSeconds).toBeGreaterThan(0)
      const usage = (await (await call(g, '/api/ai/usage', { token })).json()) as { free: { requests: number; limit: number; inputTokens: number } }
      expect(usage.free).toMatchObject({ requests: 2, limit: 2, inputTokens: 22 })
    } finally {
      await g.close()
    }
  })
})

describe('free-tier abuse protection', () => {
  it('caps free requests per IP across freshly minted devices', async () => {
    const g = await startGateway(upstream, { AI_FREE_REQUESTS_PER_IP_PER_DAY: '3' })
    try {
      const codes: number[] = []
      for (let i = 0; i < 4; i++) {
        const token = await register(g) // a new anonymous account each time
        const res = await call(g, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg()] } })
        codes.push(res.status)
        if (res.status === 429) expect(((await res.json()) as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED')
      }
      expect(codes).toEqual([200, 200, 200, 429])
      // Premium (user-paid) traffic is not counted against the free IP bucket.
      const token = await register(g)
      await call(g, '/api/ai/providers/openrouter', { method: 'PUT', token, body: { apiKey: VALID_BYOK } })
      expect((await call(g, '/api/ai/chat', { token, body: { mode: 'premium', messages: [userMsg()] } })).status).toBe(200)
    } finally {
      await g.close()
    }
  })

  it('enforces the global free cap and refunds every bucket when the provider fails', async () => {
    const g = await startGateway(upstream, { AI_FREE_REQUESTS_GLOBAL_PER_DAY: '2' })
    try {
      const a = await register(g)
      upstream.mode = 'auth_error'
      for (let i = 0; i < 3; i++) expect((await call(g, '/api/ai/chat', { token: a, body: { mode: 'free', messages: [userMsg()] } })).status).toBe(503)
      upstream.mode = 'ok'
      expect((await call(g, '/api/ai/chat', { token: a, body: { mode: 'free', messages: [userMsg()] } })).status).toBe(200)
      const b = await register(g)
      expect((await call(g, '/api/ai/chat', { token: b, body: { mode: 'free', messages: [userMsg()] } })).status).toBe(200)
      const c = await register(g)
      const res = await call(g, '/api/ai/chat', { token: c, body: { mode: 'free', messages: [userMsg()] } })
      expect(res.status).toBe(429)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED')
      // The rejected request did not consume c's personal quota.
      expect(((await (await call(g, '/api/ai/usage', { token: c })).json()) as { free: { requests: number } }).free.requests).toBe(0)
    } finally {
      await g.close()
    }
  })

  it('treats a model as free only when every price component is zero', async () => {
    const { OpenRouterAdapter } = await import('../../server/src/providers/openrouter')
    const data = [
      { id: 'a/zero', pricing: { prompt: '0', completion: '0', request: '0', image: '0' } },
      { id: 'b/per-request:free', pricing: { prompt: '0', completion: '0', request: '0.01' } },
      { id: 'c/no-pricing:free' },
      { id: 'd/variable', pricing: { prompt: '-1', completion: '-1' } }
    ]
    const a = new OpenRouterAdapter({ baseUrl: 'http://x', timeoutMs: 1000, referer: 'r', title: 't', fetch: async () => new Response(JSON.stringify({ data }), { status: 200 }) })
    const free = Object.fromEntries((await a.listModels('k')).map((m) => [m.id, m.free]))
    expect(free).toEqual({ 'a/zero': true, 'b/per-request:free': false, 'c/no-pricing:free': false, 'd/variable': false })
  })
})

describe('transport security', () => {
  it('rejects disallowed browser origins (strict CORS) and allows configured ones', async () => {
    const g = await startGateway(upstream, { AI_CORS_ORIGINS: 'https://app.nexa.example' })
    try {
      expect((await call(g, '/api/ai/health', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
      const ok = await call(g, '/api/ai/health', { headers: { origin: 'https://app.nexa.example' } })
      expect(ok.status).toBe(200)
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.nexa.example')
    } finally {
      await g.close()
    }
  })

  it('requires HTTPS (via trusted proxy) in production', async () => {
    const g = await startGateway(upstream, { AI_TRUST_PROXY: 'true' }, (c) => {
      c.env = 'production'
    })
    try {
      expect((await call(g, '/api/auth/device', { body: {} })).status).toBe(403)
      const ok = await call(g, '/api/auth/device', { body: {}, headers: { 'x-forwarded-proto': 'https' } })
      expect(ok.status).toBe(201)
      expect(ok.headers.get('strict-transport-security')).toMatch(/max-age=/)
    } finally {
      await g.close()
    }
  })
})

describe('configuration', () => {
  it('fails fast with clear errors that never include secret values', () => {
    const secret = 'sk-or-v1-should-never-appear-in-errors'
    expect(() => loadConfig({ NODE_ENV: 'production', AI_TRUST_PROXY: 'true' })).toThrow(ConfigError)
    try {
      loadConfig({ NODE_ENV: 'production', AI_TRUST_PROXY: 'true' })
    } catch (e) {
      expect((e as Error).message).toBe('Missing required secret(s): OPENROUTER_API_KEY, AI_ENCRYPTION_KEY')
    }
    try {
      loadConfig({ NODE_ENV: 'production', OPENROUTER_API_KEY: secret, AI_ENCRYPTION_KEY: ENC_KEY_HEX })
    } catch (e) {
      expect((e as Error).message).toMatch(/HTTPS/)
      expect((e as Error).message).not.toContain(secret)
    }
    expect(() => loadConfig({ NODE_ENV: 'production', OPENROUTER_API_KEY: secret, AI_ENCRYPTION_KEY: ENC_KEY_HEX, AI_TRUST_PROXY: 'true', OPENROUTER_BASE_URL: 'http://169.254.169.254' })).toThrow(/cannot be overridden/)
    expect(() => loadConfig({ AI_ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/)
    expect(() => loadConfig({ AI_FREE_REQUESTS_PER_DAY: '-1' })).toThrow(/AI_FREE_REQUESTS_PER_DAY/)
  })
})

describe('secret hygiene', () => {
  it('never logs provider keys, BYOK keys, device tokens or prompts', async () => {
    const token = await register(gw)
    await call(gw, '/api/ai/providers/openrouter', { method: 'PUT', token, body: { apiKey: VALID_BYOK } })
    await call(gw, '/api/ai/chat', { token, body: { mode: 'premium', messages: [userMsg('my secret prompt text')] } })
    upstream.mode = 'auth_error'
    await call(gw, '/api/ai/chat', { token, body: { mode: 'free', messages: [userMsg('another private prompt')] } })
    await call(gw, '/api/ai/chat', { token: 'nxa_' + 'B'.repeat(43), body: { mode: 'free', messages: [userMsg()] } })
    const all = gw.logs.join('\n')
    expect(gw.logs.length).toBeGreaterThan(0)
    for (const s of [SERVER_KEY, VALID_BYOK, token, 'my secret prompt text', 'another private prompt']) expect(all).not.toContain(s)
    const audit = JSON.stringify(gw.store.rawAuditRows())
    for (const s of [SERVER_KEY, VALID_BYOK, token, 'my secret prompt text']) expect(audit).not.toContain(s)
  })

  it('redaction scrubs credential-shaped values and sensitive keys', () => {
    expect(redactString(`Bearer ${VALID_BYOK}`)).toBe('Bearer [REDACTED]')
    expect(redactString(`key=${SERVER_KEY}`)).not.toContain(SERVER_KEY)
    expect(redact({ apiKey: 'x', authorization: 'y', messages: ['z'], inputTokens: 5, nested: { deviceToken: 't' } })).toEqual({
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      messages: '[REDACTED]',
      inputTokens: 5,
      nested: { deviceToken: '[REDACTED]' }
    })
  })
})

function userIdOf(token: string): string {
  return gw.store.deviceByTokenHash(hashToken(token))!.userId
}
