import { describe, expect, it, vi } from 'vitest'
import { OllamaClient, parseChatLine, mapTagsModel } from '../../src/main/services/ollama'

/** Build a Response-like object with an NDJSON streaming body. */
function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    }
  })
  return { ok: status >= 200 && status < 300, status, body } as unknown as Response
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, body: null } as unknown as Response
}

/** A fetch that rejects only when its abort signal fires (for timeout/cancel). */
function hangingFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const sig = init?.signal
      if (sig?.aborted) return reject(sig.reason ?? new Error('cancelled'))
      sig?.addEventListener('abort', () => reject(sig.reason ?? new Error('cancelled')), { once: true })
    })
}

describe('parseChatLine', () => {
  it('parses content deltas and done', () => {
    expect(parseChatLine('{"message":{"content":"He"},"done":false}')).toEqual({ delta: 'He', done: false })
    expect(parseChatLine('{"done":true}')).toEqual({ delta: '', done: true })
  })
  it('parses errors and ignores malformed lines', () => {
    expect(parseChatLine('{"error":"model not found"}')).toEqual({ error: 'model not found' })
    expect(parseChatLine('not json')).toBeNull()
  })
})

describe('mapTagsModel', () => {
  it('detects embedding capability and derives fields', () => {
    const m = mapTagsModel({ name: 'nomic-embed-text:latest', details: { family: 'nomic-bert' }, capabilities: ['embedding'] })
    expect(m?.embedding).toBe(true)
    const chat = mapTagsModel({ name: 'qwen3:8b', details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M', context_length: 40960 }, capabilities: ['completion', 'tools'] })
    expect(chat?.embedding).toBe(false)
    expect(chat?.contextLength).toBe(40960)
    expect(chat?.paramSize).toBe('8.2B')
  })
})

describe('OllamaClient — endpoint locking', () => {
  it('rejects non-loopback endpoints', () => {
    expect(() => new OllamaClient({ endpoint: 'http://evil.com:11434', fetchImpl: vi.fn() })).toThrow(/invalid_endpoint/)
    expect(() => new OllamaClient({ endpoint: 'https://127.0.0.1:11434', fetchImpl: vi.fn() })).toThrow(/invalid_endpoint/)
    expect(() => new OllamaClient({ endpoint: 'http://127.0.0.1:9999', fetchImpl: vi.fn() })).toThrow(/invalid_endpoint/)
  })
  it('accepts the loopback endpoint', () => {
    expect(() => new OllamaClient({ endpoint: 'http://127.0.0.1:11434', fetchImpl: vi.fn() })).not.toThrow()
    expect(() => new OllamaClient({ endpoint: 'http://localhost:11434', fetchImpl: vi.fn() })).not.toThrow()
  })
})

describe('OllamaClient — listModels', () => {
  it('returns mapped models', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [{ name: 'qwen3:8b', details: { parameter_size: '8.2B' }, capabilities: ['completion'] }] }))
    const c = new OllamaClient({ fetchImpl })
    const models = await c.listModels()
    expect(models).toHaveLength(1)
    expect(models[0].name).toBe('qwen3:8b')
  })
  it('classifies connection failure as ollama_offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const c = new OllamaClient({ fetchImpl })
    await expect(c.listModels()).rejects.toMatchObject({ code: 'ollama_offline' })
  })
  it('throws bad_response on malformed payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }))
    const c = new OllamaClient({ fetchImpl })
    await expect(c.listModels()).rejects.toMatchObject({ code: 'bad_response' })
  })
})

describe('OllamaClient — chat streaming', () => {
  it('streams deltas incrementally and returns the full text', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        '{"message":{"content":"Hello"},"done":false}\n',
        '{"message":{"content":", how"},"done":false}\n',
        '{"message":{"content":" can I help?"},"done":true}\n'
      ])
    )
    const c = new OllamaClient({ fetchImpl })
    const deltas: string[] = []
    const full = await c.chat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], onDelta: (d) => deltas.push(d) })
    expect(deltas).toEqual(['Hello', ', how', ' can I help?'])
    expect(full).toBe('Hello, how can I help?')
  })
  it('handles chunk boundaries split across reads', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"message":{"content":"A"}', ',"done":false}\n{"message":{"content":"B"},"done":true}\n']))
    const c = new OllamaClient({ fetchImpl })
    const deltas: string[] = []
    const full = await c.chat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], onDelta: (d) => deltas.push(d) })
    expect(full).toBe('AB')
  })
  it('maps 404 to model_not_installed', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([], 404))
    const c = new OllamaClient({ fetchImpl })
    await expect(c.chat({ model: 'ghost', messages: [{ role: 'user', content: 'hi' }], onDelta: () => {} })).rejects.toMatchObject({ code: 'model_not_installed' })
  })
  it('maps an in-stream error to model_not_installed', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"error":"model \'ghost\' not found"}\n']))
    const c = new OllamaClient({ fetchImpl })
    await expect(c.chat({ model: 'ghost', messages: [{ role: 'user', content: 'hi' }], onDelta: () => {} })).rejects.toMatchObject({ code: 'model_not_installed' })
  })
  it('aborts a hanging request via timeout', async () => {
    const c = new OllamaClient({ fetchImpl: hangingFetch() })
    await expect(c.chat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], timeoutMs: 20, onDelta: () => {} })).rejects.toMatchObject({ code: 'timeout' })
  })
  it('reports cancellation when the caller aborts', async () => {
    const c = new OllamaClient({ fetchImpl: hangingFetch() })
    const ctrl = new AbortController()
    const p = c.chat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], signal: ctrl.signal, onDelta: () => {} })
    ctrl.abort(new Error('cancelled'))
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('OllamaClient — embeddings', () => {
  it('returns embeddings from /api/embed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ embeddings: [[0.1, 0.2, 0.3]] }))
    const c = new OllamaClient({ fetchImpl })
    const vecs = await c.embed({ model: 'nomic-embed-text:latest', input: 'hello' })
    expect(vecs).toEqual([[0.1, 0.2, 0.3]])
  })
  it('falls back to a single embedding field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ embedding: [1, 2] }))
    const c = new OllamaClient({ fetchImpl })
    const vecs = await c.embed({ model: 'nomic-embed-text:latest', input: 'hello' })
    expect(vecs).toEqual([[1, 2]])
  })
  it('maps 404 to model_not_installed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404))
    const c = new OllamaClient({ fetchImpl })
    await expect(c.embed({ model: 'ghost', input: 'x' })).rejects.toMatchObject({ code: 'model_not_installed' })
  })
})
