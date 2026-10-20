import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIService } from '../../src/main/services/ai'
import type { OllamaClient } from '../../src/main/services/ollama'
import type { AiModel } from '../../src/shared/ai'

const base = mkdtempSync(join(tmpdir(), 'nexa-vision-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const fakePersist = { profileDir: (id: string) => join(base, id) } as unknown as import('../../src/main/services/persistence').Persistence

const MODELS: AiModel[] = [{ name: 'qwen3:8b', family: 'qwen3', paramSize: '8B', quant: 'Q4', contextLength: 40960, capabilities: ['completion'], embedding: false }]

function makeClient(overrides: Partial<OllamaClient> = {}): OllamaClient {
  return {
    listModels: vi.fn(async () => MODELS),
    show: vi.fn(async () => ({ capabilities: ['completion'], family: 'qwen3', families: ['qwen3'] })),
    chat: vi.fn(async ({ onDelta }: { onDelta: (d: string) => void }) => {
      onDelta('a picture of a form')
      return 'a picture of a form'
    }),
    embed: vi.fn(async () => [[0.1]]),
    ping: vi.fn(async () => true),
    ...overrides
  } as unknown as OllamaClient
}

describe('AIService.visionStatus — honest capability detection', () => {
  it('reports TEXT_ONLY for a text-only model', async () => {
    const svc = new AIService(fakePersist, () => {}, { client: makeClient() })
    const s = await svc.visionStatus('research')
    expect(s.capability).toBe('TEXT_ONLY')
    expect(s.note).toMatch(/text-only/i)
  })

  it('reports VISION_CAPABLE when the model advertises the vision capability', async () => {
    const client = makeClient({ show: vi.fn(async () => ({ capabilities: ['completion', 'vision'], family: 'llama', families: ['mllama'] })) as unknown as OllamaClient['show'] })
    const svc = new AIService(fakePersist, () => {}, { client })
    const s = await svc.visionStatus('research', 'llama3.2-vision:11b')
    expect(s.capability).toBe('VISION_CAPABLE')
  })

  it('reports UNAVAILABLE when Ollama is offline', async () => {
    const client = makeClient({ show: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'ollama_offline' }) }) as unknown as OllamaClient['show'] })
    const svc = new AIService(fakePersist, () => {}, { client })
    const s = await svc.visionStatus('research')
    expect(s.capability).toBe('UNAVAILABLE')
  })
})

describe('AIService.visionAnalyze — honest + local', () => {
  it('returns vision_not_configured for a text-only model WITHOUT sending an image', async () => {
    const chat = vi.fn(async () => 'should not be called')
    const svc = new AIService(fakePersist, () => {}, { client: makeClient({ chat: chat as unknown as OllamaClient['chat'] }) })
    const r = await svc.visionAnalyze('research', { image: 'ZmFrZWJhc2U2NGltYWdlZGF0YQ==', prompt: 'describe' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('vision_not_configured')
    expect(chat).not.toHaveBeenCalled()
  })

  it('analyzes an image on a vision-capable model and strips the data-uri prefix', async () => {
    let sentImages: string[] | undefined
    const client = makeClient({
      show: vi.fn(async () => ({ capabilities: ['vision'], family: 'llama', families: ['mllama'] })) as unknown as OllamaClient['show'],
      chat: vi.fn(async ({ images, onDelta }: { images?: string[]; onDelta: (d: string) => void }) => {
        sentImages = images
        onDelta('a login form with two fields')
        return 'a login form with two fields'
      }) as unknown as OllamaClient['chat']
    })
    const svc = new AIService(fakePersist, () => {}, { client })
    const r = await svc.visionAnalyze('research', { image: 'data:image/png;base64,AAAABBBBCCCCDDDD', prompt: 'what is this?', model: 'llava:13b' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('login form')
    expect(sentImages).toEqual(['AAAABBBBCCCCDDDD']) // prefix stripped, raw base64 only
  })

  it('maps cancellation and timeout to explicit states', async () => {
    const visionClient = () => makeClient({ show: vi.fn(async () => ({ capabilities: ['vision'], family: 'x', families: ['clip'] })) as unknown as OllamaClient['show'] })
    const cancelled = new AIService(fakePersist, () => {}, { client: visionClient() })
    ;(cancelled as unknown as { client: OllamaClient }).client.chat = vi.fn(async () => { throw Object.assign(new Error('cancelled'), { code: 'cancelled' }) }) as unknown as OllamaClient['chat']
    expect((await cancelled.visionAnalyze('research', { image: 'AAAABBBBCCCC', prompt: 'x', model: 'llava' })).error).toBe('vision_cancelled')

    const timed = new AIService(fakePersist, () => {}, { client: visionClient() })
    ;(timed as unknown as { client: OllamaClient }).client.chat = vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'timeout' }) }) as unknown as OllamaClient['chat']
    expect((await timed.visionAnalyze('research', { image: 'AAAABBBBCCCC', prompt: 'x', model: 'llava' })).error).toBe('vision_timeout')
  })
})
