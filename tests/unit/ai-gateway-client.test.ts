import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GatewayClient, GatewayClientError, resolveGatewayUrl } from '../../src/main/services/ai-gateway-client'
import { NexaGatewayAdapter, providerErrorCode } from '../../src/main/services/ai-provider-adapters'
import { AIProviderRegistry, type SecretStore } from '../../src/main/services/ai-registry'
import { OllamaClient } from '../../src/main/services/ollama'
import { AIService } from '../../src/main/services/ai'
import { createAIPlanner } from '../../src/main/services/agent'
import { validateGatewayUrl } from '../../src/shared/ai-gateway'
import type { AiStreamEvent } from '../../src/shared/ai'
import { SERVER_KEY, VALID_BYOK, startGateway, startUpstream, type FakeUpstream, type TestGateway } from './gateway-harness'

function memSecrets(): SecretStore & { map: Record<string, string> } {
  const map: Record<string, string> = {}
  return {
    map,
    available: () => true,
    get: (k) => (k in map ? map[k] : null),
    set: (k, v) => {
      map[k] = v
    },
    delete: (k) => {
      delete map[k]
    }
  }
}

let upstream: FakeUpstream
let gw: TestGateway
const base = mkdtempSync(join(tmpdir(), 'nexa-gwc-'))
const fakePersist = { profileDir: (id: string) => join(base, id) } as unknown as import('../../src/main/services/persistence').Persistence
const offlineOllama = () =>
  new OllamaClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    }
  })

beforeAll(async () => {
  upstream = await startUpstream()
  gw = await startGateway(upstream)
})
afterAll(async () => {
  await gw.close()
  await upstream.close()
  rmSync(base, { recursive: true, force: true })
})
beforeEach(() => {
  upstream.mode = 'ok'
  upstream.calls.length = 0
})

const client = (secure = memSecrets()) => new GatewayClient({ baseUrl: gw.url, allowLoopbackHttp: true, secure, platform: 'darwin', appVersion: '0.1.0' })

describe('gateway URL policy', () => {
  it('requires https except explicitly-allowed loopback http', () => {
    expect(validateGatewayUrl('https://ai.nexa.example', { allowLoopbackHttp: false })?.origin).toBe('https://ai.nexa.example')
    expect(validateGatewayUrl('http://ai.nexa.example', { allowLoopbackHttp: true })).toBeNull()
    expect(validateGatewayUrl('http://127.0.0.1:8787', { allowLoopbackHttp: false })).toBeNull()
    expect(validateGatewayUrl('http://127.0.0.1:8787', { allowLoopbackHttp: true })?.origin).toBe('http://127.0.0.1:8787')
    expect(validateGatewayUrl('https://user:pw@ai.nexa.example', { allowLoopbackHttp: false })).toBeNull()
    expect(validateGatewayUrl('https://ai.nexa.example/?k=v', { allowLoopbackHttp: false })).toBeNull()
    expect(validateGatewayUrl('javascript:alert(1)', { allowLoopbackHttp: true })).toBeNull()
  })

  it('packaged builds have no implicit gateway; insecure URLs leave the client unconfigured', () => {
    const prev = process.env.NEXA_AI_GATEWAY_URL
    delete process.env.NEXA_AI_GATEWAY_URL
    try {
      expect(resolveGatewayUrl({ packaged: true })).toBeNull()
      expect(resolveGatewayUrl({ packaged: false })).toBe('http://127.0.0.1:8787')
    } finally {
      if (prev !== undefined) process.env.NEXA_AI_GATEWAY_URL = prev
    }
    const c = new GatewayClient({ baseUrl: 'http://ai.nexa.example', allowLoopbackHttp: false, secure: memSecrets() })
    expect(c.configured).toBe(false)
  })
})

describe('GatewayClient', () => {
  it('registers once, keeps only its device token (bound to origin) in secure storage', async () => {
    const secure = memSecrets()
    const c = client(secure)
    await Promise.all([c.usage(), c.providers()])
    const stored = JSON.parse(secure.map['ai.gateway.device'])
    expect(stored.origin).toBe(gw.url)
    expect(stored.token).toMatch(/^nxa_/)
    expect(Object.keys(stored).sort()).toEqual(['origin', 'token'])
    expect(JSON.stringify(secure.map)).not.toContain(SERVER_KEY)
  })

  it('re-registers transparently after the token is revoked server-side', async () => {
    const secure = memSecrets()
    const c = client(secure)
    await c.usage()
    const { token } = JSON.parse(secure.map['ai.gateway.device'])
    await fetch(`${gw.url}/api/auth/device`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    await c.usage()
    expect(JSON.parse(secure.map['ai.gateway.device']).token).not.toBe(token)
  })

  it('streams deltas progressively and returns usage', async () => {
    const deltas: string[] = []
    const r = await client().stream({ mode: 'free', messages: [{ role: 'user', content: 'Hi' }] }, { onDelta: (t) => deltas.push(t) })
    expect(deltas).toEqual(['Hello', ' world'])
    expect(r).toMatchObject({ content: 'Hello world', usage: { inputTokens: 11, outputTokens: 2 } })
  })

  it('cancels an in-flight stream with CANCELLED', async () => {
    upstream.mode = 'hang'
    const ac = new AbortController()
    const p = client().stream({ mode: 'free', messages: [{ role: 'user', content: 'Hi' }] }, { signal: ac.signal, onDelta: () => {} })
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('surfaces normalized gateway error codes', async () => {
    const c = client()
    const err = await c.stream({ mode: 'premium', messages: [{ role: 'user', content: 'Hi' }] }, { onDelta: () => {} }).catch((e) => e)
    expect(err).toBeInstanceOf(GatewayClientError)
    expect(err.code).toBe('PREMIUM_NOT_CONNECTED')
    expect(providerErrorCode(err)).toBe('PREMIUM_NOT_CONNECTED')
    const bad = await c.connectOpenRouter('sk-or-v1-not-a-real-key-0000000000').catch((e) => e)
    expect(bad.code).toBe('INVALID_PROVIDER_KEY')
    expect(String(bad.message)).not.toContain('sk-or-v1-not-a-real-key')
  })

  it('treats a stream cut off before `done` as a network error, not success', async () => {
    const cut = new GatewayClient({
      baseUrl: 'http://127.0.0.1:9',
      allowLoopbackHttp: true,
      secure: memSecrets(),
      fetch: async (url) => {
        if (url.endsWith('/api/auth/device')) return new Response(JSON.stringify({ token: 'nxa_' + 'C'.repeat(43), expiresAt: '' }), { status: 201 })
        return new Response('event: start\ndata: {"model":"m"}\n\nevent: delta\ndata: {"text":"partial"}\n\n', { status: 200 })
      }
    })
    const deltas: string[] = []
    await expect(cut.stream({ mode: 'free', messages: [{ role: 'user', content: 'Hi' }] }, { onDelta: (t) => deltas.push(t) })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(deltas).toEqual(['partial'])
  })

  it('reports NETWORK_ERROR when the gateway is unreachable', async () => {
    const c = new GatewayClient({ baseUrl: 'http://127.0.0.1:1', allowLoopbackHttp: true, secure: memSecrets() })
    await expect(c.health()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const h = await new NexaGatewayAdapter(c).health()
    expect(h.state).toBe('NETWORK_OFFLINE')
  })
})

describe('NexaGatewayAdapter', () => {
  it('maps server models to logical refs and adds premium only after BYOK', async () => {
    const c = client()
    const a = new NexaGatewayAdapter(c)
    expect((await a.health()).state).toBe('CONNECTED')
    let ids = (await a.listModels()).map((m) => m.id)
    expect(ids[0]).toBe('free')
    expect(ids).toContain('free:meta-llama/llama-3.3-70b-instruct:free')
    expect(ids.some((i) => i.startsWith('premium'))).toBe(false)
    await c.connectOpenRouter(VALID_BYOK)
    ids = (await a.listModels()).map((m) => m.id)
    expect(ids).toContain('premium')
    expect(ids).toContain('premium:openai/gpt-4o')
  })
})

describe('AIService via NEXA gateway', () => {
  const setup = () => {
    const events: AiStreamEvent[] = []
    const secure = memSecrets()
    const gateway = client(secure)
    const registry = new AIProviderRegistry(fakePersist, secure, { gateway, ollamaClient: offlineOllama() })
    const ai = new AIService(fakePersist, (e: AiStreamEvent) => events.push(e), { client: offlineOllama(), registry })
    return { ai, events, gateway }
  }

  it('works out of the box with NEXA Free AI (no key, no setup)', async () => {
    const { ai, events } = setup()
    const status = await ai.status('p-free')
    expect(status).toMatchObject({ cloudEnabled: true, processing: 'cloud', providerId: 'nexa' })
    await ai.chat('p-free', 'r1', [{ role: 'user', content: 'Hi' }])
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('start')
    expect(types).toContain('delta')
    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>
    expect(done).toBeTruthy()
    expect(done.usage).toEqual({ inputTokens: 11, outputTokens: 2 })
    expect(upstream.calls.find((c) => c.path === '/chat/completions')?.body?.model).toBe('openrouter/free')
  })

  it('private tabs never leave the device (local-only even with NEXA AI selected)', async () => {
    const { ai, events } = setup()
    await ai.chat('p-private', 'r2', [{ role: 'user', content: 'secret' }], undefined, { private: true })
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(upstream.calls.filter((c) => c.path === '/chat/completions')).toHaveLength(0)
  })

  it('private Browser Agent tasks never plan through the cloud', async () => {
    const { ai } = setup()
    const planner = createAIPlanner(ai)
    const signal = new AbortController().signal
    await expect(planner.plan({ profileId: 'p-agent', messages: [{ role: 'user', content: 'private page text' }], signal, privateMode: true })).rejects.toBeTruthy()
    expect(upstream.calls.filter((c) => c.path === '/chat/completions')).toHaveLength(0)
    expect(await planner.plan({ profileId: 'p-agent', messages: [{ role: 'user', content: 'Hi' }], signal })).toBe('Hello world')
    expect(upstream.calls.filter((c) => c.path === '/chat/completions')).toHaveLength(1)
  })

  it('connects and disconnects premium returning metadata only', async () => {
    const { ai } = setup()
    const r = await ai.connectPremium('p-prem', VALID_BYOK)
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain(VALID_BYOK)
    const info = await ai.gatewayInfo('p-prem')
    expect(JSON.stringify(info)).not.toContain(VALID_BYOK)
    const d = await ai.disconnectPremium('p-prem')
    expect(JSON.stringify(d)).not.toContain(VALID_BYOK)
  })
})

describe('client bundle hygiene (static)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })

  it('no OpenRouter credential or client-exposed key variable exists in app source', () => {
    const files = [...walk('src/renderer'), ...walk('src/preload'), ...walk('src/main'), ...walk('src/shared')].filter((f) => /\.(ts|tsx|js|html|json)$/.test(f))
    for (const f of files) {
      const s = readFileSync(f, 'utf8')
      expect(s, f).not.toMatch(/sk-or-v1-[A-Za-z0-9]{16,}/)
      expect(s, f).not.toMatch(/(VITE|NEXT_PUBLIC|REACT_APP|MAIN_VITE|RENDERER_VITE|PRELOAD_VITE)_[A-Z_]*OPENROUTER/)
      expect(s, f).not.toMatch(/OPENROUTER_API_KEY/)
    }
  })
})
