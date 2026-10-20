import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OpenAIProviderAdapter,
  AnthropicProviderAdapter,
  OllamaProviderAdapter,
  providerErrorCode
} from '../../src/main/services/ai-provider-adapters'
import { AIProviderRegistry, type SecretStore } from '../../src/main/services/ai-registry'
import { OllamaClient } from '../../src/main/services/ollama'
import { AIService } from '../../src/main/services/ai'
import type { AiStreamEvent } from '../../src/shared/ai'

/* ------------------------------ fakes ------------------------------ */

function sse(lines: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    }
  })
  return new Response(body, { status })
}

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

const base = mkdtempSync(join(tmpdir(), 'nexa-aip-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const fakePersist = { profileDir: (id: string) => join(base, id) } as unknown as import('../../src/main/services/persistence').Persistence

/* ------------------------------ OpenAI adapter ------------------------------ */

describe('OpenAIProviderAdapter', () => {
  it('reports NOT_CONFIGURED without a key (no network call)', async () => {
    const fetchImpl = vi.fn()
    const a = new OpenAIProviderAdapter(fetchImpl as never)
    const h = await a.health({ apiKey: null })
    expect(h.state).toBe('NOT_CONFIGURED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps auth + connected health from status', async () => {
    const okFetch = vi.fn(async () => new Response('{}', { status: 200 }))
    expect((await new OpenAIProviderAdapter(okFetch as never).health({ apiKey: 'sk-test' })).state).toBe('CONNECTED')
    const authFetch = vi.fn(async () => new Response(null, { status: 401 }))
    expect((await new OpenAIProviderAdapter(authFetch as never).health({ apiKey: 'sk-bad' })).state).toBe('AUTH_ERROR')
  })

  it('streams chat deltas and sends the key only in the Authorization header', async () => {
    let sentAuth = ''
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sentAuth = (init?.headers as Record<string, string>).Authorization
      return sse(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n', 'data: [DONE]\n'])
    })
    const a = new OpenAIProviderAdapter(fetchImpl as never)
    const deltas: string[] = []
    const text = await a.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], apiKey: 'sk-secret', onDelta: (d) => deltas.push(d) })
    expect(text).toBe('Hello')
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(sentAuth).toBe('Bearer sk-secret')
    // the returned text never contains the key
    expect(text).not.toContain('sk-secret')
  })

  it('embeds via /v1/embeddings', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }))
    const a = new OpenAIProviderAdapter(fetchImpl as never)
    const vecs = await a.embed!({ model: 'text-embedding-3-small', input: 'x', apiKey: 'sk' })
    expect(vecs).toEqual([[0.1, 0.2]])
  })
})

describe('AnthropicProviderAdapter', () => {
  it('streams content_block_delta events', async () => {
    let sentKey = ''
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sentKey = (init?.headers as Record<string, string>)['x-api-key']
      return sse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n',
        'data: {"type":"message_stop"}\n'
      ])
    })
    const a = new AnthropicProviderAdapter(fetchImpl as never)
    const text = await a.chat({ model: 'claude-3-5-haiku-latest', messages: [{ role: 'user', content: 'hey' }], apiKey: 'ant-key', onDelta: () => {} })
    expect(text).toBe('Hi there')
    expect(sentKey).toBe('ant-key')
  })
})

describe('providerErrorCode', () => {
  it('normalizes ollama + cloud errors to safe codes', () => {
    expect(providerErrorCode(Object.assign(new Error(), { code: 'ollama_offline' }))).toBe('PROVIDER_OFFLINE')
    expect(providerErrorCode(Object.assign(new Error(), { code: 'cancelled' }))).toBe('REQUEST_CANCELLED')
    expect(providerErrorCode(Object.assign(new Error(), { code: 'model_not_installed' }))).toBe('MODEL_NOT_FOUND')
  })
})

/* ------------------------------ registry ------------------------------ */

describe('AIProviderRegistry', () => {
  it('stores cloud keys in the secret store only — never in profile JSON', () => {
    const secrets = memSecrets()
    const reg = new AIProviderRegistry(fakePersist, secrets)
    reg.setKey('openai', 'sk-super-secret-123')
    expect(secrets.map['ai.key.openai']).toBe('sk-super-secret-123')
    expect(reg.isConfigured('openai')).toBe(true)
    // Config file must not contain the key
    reg.updateConfig('research', { providerId: 'openai', privacyMode: 'cloud_allowed' })
    const cfgPath = join(base, 'research', 'ai-config.json')
    expect(existsSync(cfgPath)).toBe(true)
    expect(readFileSync(cfgPath, 'utf8')).not.toContain('sk-super-secret-123')
  })

  it('isConfigured: local always true, cloud only with a key', () => {
    const secrets = memSecrets()
    const reg = new AIProviderRegistry(fakePersist, secrets)
    expect(reg.isConfigured('ollama')).toBe(true)
    expect(reg.isConfigured('anthropic')).toBe(false)
    reg.setKey('anthropic', 'ant-123456')
    expect(reg.isConfigured('anthropic')).toBe(true)
    reg.removeProvider('anthropic')
    expect(reg.isConfigured('anthropic')).toBe(false)
  })

  it('rejects a key for the local provider', () => {
    const reg = new AIProviderRegistry(fakePersist, memSecrets())
    expect(() => reg.setKey('ollama', 'x')).toThrow(/no_key/)
  })

  it('getConfig returns validated defaults; updateConfig normalizes untrusted patches', () => {
    const reg = new AIProviderRegistry(fakePersist, memSecrets())
    expect(reg.getConfig('p1').providerId).toBe('nexa')
    const updated = reg.updateConfig('p1', { providerId: 'evil' as never, privacyMode: 'nope' as never })
    expect(updated.providerId).toBe('nexa')
    expect(updated.privacyMode).toBe('cloud_allowed')
  })

  it('listProviders returns non-secret metadata for all providers (no key field)', async () => {
    const secrets = memSecrets()
    const reg = new AIProviderRegistry(fakePersist, secrets, {
      adapters: {
        ollama: { id: 'ollama', type: 'local', health: async () => ({ state: 'LOCAL_OFFLINE' }), listModels: async () => [], chat: async () => '' } as never,
        openai: { id: 'openai', type: 'cloud', health: async () => ({ state: 'CONNECTED' }), listModels: async () => [], chat: async () => '' } as never,
        anthropic: { id: 'anthropic', type: 'cloud', health: async () => ({ state: 'NOT_CONFIGURED' }), listModels: async () => [], chat: async () => '' } as never
      }
    })
    reg.setKey('openai', 'sk-abc12345')
    const list = await reg.listProviders('p1', { refresh: true })
    const json = JSON.stringify(list)
    expect(json).not.toContain('sk-abc12345')
    const openai = list.find((p) => p.id === 'openai')!
    expect(openai.configured).toBe(true)
    expect(openai.health).toBe('CONNECTED')
    expect((openai as unknown as Record<string, unknown>).apiKey).toBeUndefined()
    const anth = list.find((p) => p.id === 'anthropic')!
    expect(anth.configured).toBe(false)
  })

  it('END-TO-END: consumer → AIService → registry → router → Ollama adapter → client', async () => {
    // Simulate the real Ollama loopback transport so we exercise the NEW path,
    // not a legacy one. Any /api/chat NDJSON stream proves the full wiring.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b', details: { family: 'qwen3' }, capabilities: ['completion'] }] }), { status: 200 })
      }
      if (url.endsWith('/api/chat')) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"message":{"content":"Hi from Ollama"},"done":true}\n'))
            c.close()
          }
        })
        return new Response(body, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    const client = new OllamaClient({ fetchImpl: fetchImpl as never })
    const reg = new AIProviderRegistry(fakePersist, memSecrets(), { adapters: { ollama: new OllamaProviderAdapter(client) } })
    const events: AiStreamEvent[] = []
    const svc = new AIService(fakePersist, (e) => events.push(e), { client, registry: reg })
    await svc.chat('research', 'req-e2e-1', [{ role: 'user', content: 'hello' }])
    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>
    expect(done).toBeTruthy()
    expect(done.content).toContain('Hi from Ollama')
    // Proves routing selected the local provider deterministically.
    const decision = await reg.route('research', 'chat')
    expect(decision.ok && decision.providerId).toBe('ollama')
  })

  it('route respects local-only default (never cloud)', async () => {
    const secrets = memSecrets()
    const reg = new AIProviderRegistry(fakePersist, secrets, {
      adapters: {
        ollama: {
          id: 'ollama',
          type: 'local',
          health: async () => ({ state: 'CONNECTED' }),
          listModels: async () => [{ id: 'qwen3:8b', providerId: 'ollama', displayName: 'Q', local: true, capabilities: { chat: 'supported', streaming: 'supported', tools: 'unknown', vision: 'unsupported', embeddings: 'unsupported', reasoning: 'unknown' } }],
          chat: async () => ''
        } as never,
        openai: { id: 'openai', type: 'cloud', health: async () => ({ state: 'CONNECTED' }), listModels: async () => [], chat: async () => '' } as never,
        anthropic: { id: 'anthropic', type: 'cloud', health: async () => ({ state: 'NOT_CONFIGURED' }), listModels: async () => [], chat: async () => '' } as never
      }
    })
    reg.setKey('openai', 'sk-abc12345')
    reg.updateConfig('p1', { providerId: 'openai', privacyMode: 'local_only', fallback: 'none' })
    const decision = await reg.route('p1', 'chat')
    // cloud primary + local_only + no local fallback → privacy blocked
    expect(decision.ok).toBe(false)
  })
})
