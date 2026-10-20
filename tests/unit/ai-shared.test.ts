import { describe, expect, it } from 'vitest'
import {
  aiChatSchema,
  aiEmbedSchema,
  aiSelectModelSchema,
  aiCancelSchema,
  prettyModelName,
  clampContext,
  buildActionMessages,
  aiErrorMessage,
  MAX_MESSAGES,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  OLLAMA_ENDPOINT
} from '../../src/shared/ai'

describe('ai schemas — chat', () => {
  const good = {
    profileId: 'research',
    requestId: 'r_abc123',
    messages: [{ role: 'user', content: 'hi' }]
  }
  it('accepts a valid chat request', () => {
    expect(aiChatSchema.safeParse(good).success).toBe(true)
  })
  it('rejects an invalid profile id', () => {
    expect(aiChatSchema.safeParse({ ...good, profileId: '../etc' }).success).toBe(false)
  })
  it('rejects an invalid request id', () => {
    expect(aiChatSchema.safeParse({ ...good, requestId: 'no spaces!' }).success).toBe(false)
  })
  it('rejects an invalid role', () => {
    expect(aiChatSchema.safeParse({ ...good, messages: [{ role: 'root', content: 'x' }] }).success).toBe(false)
  })
  it('rejects empty message content', () => {
    expect(aiChatSchema.safeParse({ ...good, messages: [{ role: 'user', content: '' }] }).success).toBe(false)
  })
  it('rejects too many messages', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }))
    expect(aiChatSchema.safeParse({ ...good, messages }).success).toBe(false)
  })
  it('rejects a malicious model name', () => {
    expect(aiChatSchema.safeParse({ ...good, model: 'qwen3:8b; rm -rf /' }).success).toBe(false)
  })
})

describe('ai schemas — embed / select / cancel', () => {
  it('accepts string and array embed input', () => {
    expect(aiEmbedSchema.safeParse({ profileId: 'research', input: 'hello' }).success).toBe(true)
    expect(aiEmbedSchema.safeParse({ profileId: 'research', input: ['a', 'b'] }).success).toBe(true)
  })
  it('rejects empty embed input', () => {
    expect(aiEmbedSchema.safeParse({ profileId: 'research', input: '' }).success).toBe(false)
    expect(aiEmbedSchema.safeParse({ profileId: 'research', input: [] }).success).toBe(false)
  })
  it('validates select model + cancel', () => {
    expect(aiSelectModelSchema.safeParse({ profileId: 'research', chatModel: 'qwen3:8b' }).success).toBe(true)
    expect(aiSelectModelSchema.safeParse({ profileId: 'research', chatModel: 'bad model' }).success).toBe(false)
    expect(aiCancelSchema.safeParse({ profileId: 'research', requestId: 'r_1abcde' }).success).toBe(true)
  })
})

describe('ai defaults are local-only', () => {
  it('uses local loopback + qwen3/nomic defaults', () => {
    expect(OLLAMA_ENDPOINT).toBe('http://127.0.0.1:11434')
    expect(DEFAULT_CHAT_MODEL).toBe('qwen3:8b')
    expect(DEFAULT_EMBED_MODEL).toBe('nomic-embed-text:latest')
  })
})

describe('prettyModelName', () => {
  it('maps known models and derives unknown ones', () => {
    expect(prettyModelName('qwen3:8b')).toBe('Qwen3 8B')
    expect(prettyModelName('nomic-embed-text:latest')).toBe('Nomic Embed Text')
    expect(prettyModelName('mistral:latest')).toBe('Mistral')
    expect(prettyModelName('phi4:14b')).toContain('14b')
  })
})

describe('clampContext', () => {
  it('collapses whitespace and truncates to budget', () => {
    const out = clampContext('a\r\n\n\n\nb   c', 100)
    expect(out).toContain('a')
    expect(out).not.toContain('\r')
    const big = clampContext('x'.repeat(50_000), 1000)
    expect(big.length).toBeLessThan(1200)
    expect(big).toContain('truncated')
  })
})

describe('buildActionMessages', () => {
  it('builds summarize messages using only provided text', () => {
    const msgs = buildActionMessages('summarize', { title: 'T', content: 'page body here' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toContain('page body here')
    expect(msgs[1].content).toContain('T')
  })
  it('builds translate messages with a target language', () => {
    const msgs = buildActionMessages('translate', { selection: 'hola', targetLang: 'English' })
    expect(msgs[0].content).toContain('English')
    expect(msgs[1].content).toContain('hola')
  })
  it('builds qa messages with the question', () => {
    const msgs = buildActionMessages('qa', { content: 'ctx', question: 'why?' })
    expect(msgs[1].content).toContain('why?')
    expect(msgs[1].content).toContain('ctx')
  })
})

describe('aiErrorMessage', () => {
  it('returns sanitized, user-safe messages', () => {
    expect(aiErrorMessage('ollama_offline')).toMatch(/start Ollama/i)
    expect(aiErrorMessage('model_not_installed')).toMatch(/not installed/i)
    expect(aiErrorMessage('anything-else')).toMatch(/failed/i)
    // Never leaks internal identifiers.
    expect(aiErrorMessage('ECONNREFUSED 127.0.0.1')).not.toContain('127.0.0.1')
  })
})
