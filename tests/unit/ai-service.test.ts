import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIService } from '../../src/main/services/ai'
import type { OllamaClient } from '../../src/main/services/ollama'
import type { AiModel, AiStreamEvent } from '../../src/shared/ai'

const base = mkdtempSync(join(tmpdir(), 'nexa-ai-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

const fakePersist = { profileDir: (id: string) => join(base, id) } as unknown as import('../../src/main/services/persistence').Persistence

const MODELS: AiModel[] = [
  { name: 'qwen3:8b', family: 'qwen3', paramSize: '8.2B', quant: 'Q4_K_M', contextLength: 40960, capabilities: ['completion'], embedding: false },
  { name: 'nomic-embed-text:latest', family: 'nomic', paramSize: '137M', quant: '', contextLength: null, capabilities: ['embedding'], embedding: true }
]

function makeClient(overrides: Partial<OllamaClient> = {}): OllamaClient {
  return {
    listModels: vi.fn(async () => MODELS),
    chat: vi.fn(async ({ onDelta }: { onDelta: (d: string) => void }) => {
      onDelta('Hel')
      onDelta('lo')
      return 'Hello'
    }),
    embed: vi.fn(async () => [[0.1, 0.2]]),
    ping: vi.fn(async () => true),
    ...overrides
  } as unknown as OllamaClient
}

function collector() {
  const events: AiStreamEvent[] = []
  return { emit: (e: AiStreamEvent) => events.push(e), events }
}

describe('AIService — status & discovery', () => {
  it('reports connected with discovered models', async () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    const s = await svc.status('research')
    expect(s.state).toBe('connected')
    expect(s.models).toHaveLength(2)
    expect(s.chatModel).toBe('qwen3:8b')
    expect(s.embedModel).toBe('nomic-embed-text:latest')
    expect(s.cloudEnabled).toBe(false)
    expect(s.processing).toBe('local-only')
  })

  it('reports offline (never cloud) when Ollama is down', async () => {
    const client = makeClient({ listModels: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'ollama_offline' }) }) as unknown as OllamaClient['listModels'] })
    const svc = new AIService(fakePersist, () => {}, { client })
    const s = await svc.status('research')
    expect(s.state).toBe('offline')
    expect(s.models).toHaveLength(0)
    expect(s.cloudEnabled).toBe(false)
    expect(s.note).toMatch(/start Ollama/i)
  })
})

describe('AIService — chat streaming', () => {
  it('emits start → delta(s) → done', async () => {
    const { emit, events } = collector()
    const svc = new AIService(fakePersist, emit, { client: makeClient() })
    await svc.chat('research', 'req_stream1', [{ role: 'user', content: 'hi' }])
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'delta', 'done'])
    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>
    expect(done.content).toBe('Hello')
  })

  it('emits model_not_installed when the model is absent (no silent switch)', async () => {
    const { emit, events } = collector()
    const svc = new AIService(fakePersist, emit, { client: makeClient() })
    await svc.chat('research', 'req_missing1', [{ role: 'user', content: 'hi' }], 'ghost:1b')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as Extract<AiStreamEvent, { type: 'error' }>).code).toBe('model_not_installed')
  })

  it('emits ollama_offline error when backend is down mid-request', async () => {
    const client = makeClient({ listModels: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'ollama_offline' }) }) as unknown as OllamaClient['listModels'] })
    const { emit, events } = collector()
    const svc = new AIService(fakePersist, emit, { client })
    await svc.chat('research', 'req_off1', [{ role: 'user', content: 'hi' }])
    expect((events[0] as Extract<AiStreamEvent, { type: 'error' }>).code).toBe('ollama_offline')
  })
})

describe('AIService — cancellation (real abort)', () => {
  it('aborts the in-flight request and emits cancelled', async () => {
    const client = makeClient({
      chat: vi.fn(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_res, rej) => {
            signal?.addEventListener('abort', () => rej(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true })
          })
      ) as unknown as OllamaClient['chat']
    })
    const { emit, events } = collector()
    const svc = new AIService(fakePersist, emit, { client })
    const p = svc.chat('research', 'req_cancel1', [{ role: 'user', content: 'hi' }])
    // Let it reach the streaming stage, then cancel.
    await new Promise((r) => setTimeout(r, 15))
    expect(svc.cancel('research', 'req_cancel1')).toBe(true)
    await p
    expect(events.map((e) => e.type)).toContain('cancelled')
  })

  it('does not cancel a request from another profile', async () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    expect(svc.cancel('research', 'nope_req')).toBe(false)
  })
})

describe('AIService — concurrency guard', () => {
  it('rejects requests beyond the concurrency limit as busy', async () => {
    const client = makeClient({
      chat: vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true }))) as unknown as OllamaClient['chat']
    })
    const { emit, events } = collector()
    const svc = new AIService(fakePersist, emit, { client })
    void svc.chat('research', 'req_c1', [{ role: 'user', content: 'a' }])
    void svc.chat('research', 'req_c2', [{ role: 'user', content: 'b' }])
    await new Promise((r) => setTimeout(r, 20))
    await svc.chat('research', 'req_c3', [{ role: 'user', content: 'c' }])
    const busy = events.find((e) => e.type === 'error' && (e as Extract<AiStreamEvent, { type: 'error' }>).code === 'busy')
    expect(busy).toBeTruthy()
    svc.dispose()
  })
})

describe('AIService — embeddings', () => {
  it('returns vectors from the embed model', async () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    const vecs = await svc.embed('research', 'hello')
    expect(vecs).toEqual([[0.1, 0.2]])
  })
})

describe('AIService — settings, profile isolation, no cloud', () => {
  it('persists settings per profile without leaking across profiles', () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    svc.saveSettings('research', { chatModel: 'mistral:latest' })
    expect(svc.getSettings('research').chatModel).toBe('mistral:latest')
    // A different profile keeps defaults — no cross-profile leak.
    expect(svc.getSettings('work').chatModel).toBe('qwen3:8b')
  })

  it('never exposes an enabled cloud flag', () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    const s = svc.saveSettings('research', { chatModel: 'qwen3:8b' })
    expect(s.cloudEnabled).toBe(false)
  })
})
