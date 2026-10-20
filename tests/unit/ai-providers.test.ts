import { describe, it, expect } from 'vitest'
import {
  PROVIDER_META,
  KNOWN_PROVIDER_IDS,
  isKnownProvider,
  providerType,
  assertKnownHost,
  ollamaModelCapabilities,
  modelSupports,
  modelCapability,
  cloudModelsFor,
  defaultCloudChatModel,
  CLOUD_MODELS,
  defaultProfileAIConfig,
  normalizeProfileAIConfig,
  normalizeHttpError,
  aiProviderErrorMessage,
  routeAIRequest,
  planContextBudget,
  estimateTokens,
  estimateCost,
  formatCostLabel,
  type AIProviderRuntime,
  type AIModelInfo,
  type AIProviderHealth
} from '../../src/shared/ai-providers'

/* ------------------------------ helpers ------------------------------ */

const health = (state: AIProviderHealth['state']): AIProviderHealth => ({ state })

const ollamaModel: AIModelInfo = {
  id: 'qwen3:8b',
  providerId: 'ollama',
  displayName: 'Qwen3 8B',
  local: true,
  capabilities: { chat: 'supported', streaming: 'supported', tools: 'unknown', vision: 'unsupported', embeddings: 'unsupported', reasoning: 'supported' }
}
const ollamaEmbed: AIModelInfo = {
  id: 'nomic-embed-text:latest',
  providerId: 'ollama',
  displayName: 'Nomic',
  local: true,
  capabilities: { chat: 'unsupported', streaming: 'unsupported', tools: 'unsupported', vision: 'unsupported', embeddings: 'supported', reasoning: 'unsupported' }
}

function ollamaRt(over: Partial<AIProviderRuntime> = {}): AIProviderRuntime {
  return { id: 'ollama', type: 'local', configured: true, health: health('CONNECTED'), models: [ollamaModel, ollamaEmbed], defaultModel: 'qwen3:8b', ...over }
}
function openaiRt(over: Partial<AIProviderRuntime> = {}): AIProviderRuntime {
  return { id: 'openai', type: 'cloud', configured: true, health: health('CONNECTED'), models: cloudModelsFor('openai'), defaultModel: 'gpt-4o-mini', ...over }
}

/* ------------------------------ registry ------------------------------ */

describe('provider registry', () => {
  it('knows exactly the four providers with correct types + locked hosts', () => {
    expect(KNOWN_PROVIDER_IDS).toEqual(['nexa', 'ollama', 'openai', 'anthropic'])
    expect(providerType('nexa')).toBe('cloud')
    expect(PROVIDER_META.nexa.managed).toBe(true)
    expect(providerType('ollama')).toBe('local')
    expect(providerType('openai')).toBe('cloud')
    expect(providerType('anthropic')).toBe('cloud')
    expect(isKnownProvider('openai')).toBe(true)
    expect(isKnownProvider('evil')).toBe(false)
    expect(PROVIDER_META.openai.endpoint).toBe('https://api.openai.com')
  })

  it('assertKnownHost accepts the locked host and rejects anything else', () => {
    expect(() => assertKnownHost('openai', 'https://api.openai.com/v1/chat/completions')).not.toThrow()
    expect(() => assertKnownHost('anthropic', 'https://api.anthropic.com/v1/messages')).not.toThrow()
    expect(() => assertKnownHost('openai', 'https://evil.example.com/v1')).toThrow('invalid_endpoint')
    expect(() => assertKnownHost('openai', 'http://api.openai.com/v1')).toThrow('invalid_endpoint')
    expect(() => assertKnownHost('ollama', 'http://127.0.0.1:11434/api/tags')).not.toThrow()
  })
})

/* ---------------------------- capabilities ---------------------------- */

describe('capability detection', () => {
  it('maps Ollama /api/show capabilities honestly (unknown, not false)', () => {
    const vision = ollamaModelCapabilities({ capabilities: ['completion', 'vision'], name: 'llava' })
    expect(vision.chat).toBe('supported')
    expect(vision.vision).toBe('supported')
    expect(vision.streaming).toBe('supported')

    const textOnly = ollamaModelCapabilities({ capabilities: ['completion'], name: 'qwen3:8b' })
    expect(textOnly.vision).toBe('unsupported') // has a caps list but no vision
    expect(textOnly.tools).toBe('unknown')

    const embed = ollamaModelCapabilities({ embedding: true, name: 'nomic-embed-text' })
    expect(embed.embeddings).toBe('supported')
    expect(embed.chat).toBe('unsupported')

    const noInfo = ollamaModelCapabilities({ name: 'mystery' })
    expect(noInfo.vision).toBe('unknown') // no caps list → unknown, never false-positive
  })

  it('modelSupports only true for explicit "supported"', () => {
    expect(modelSupports(ollamaModel, 'chat')).toBe(true)
    expect(modelSupports(ollamaModel, 'vision')).toBe(false)
    expect(modelCapability(ollamaModel, 'tools')).toBe('unknown')
    expect(modelSupports(undefined, 'chat')).toBe(false)
  })

  it('cloud catalog exposes only known metadata', () => {
    expect(cloudModelsFor('openai').length).toBeGreaterThan(0)
    expect(defaultCloudChatModel('openai')).toBe('gpt-4o-mini')
    expect(defaultCloudChatModel('anthropic')).toBe('claude-3-5-haiku-latest')
    expect(defaultCloudChatModel('ollama')).toBeUndefined()
    // embedding-only model is chat-unsupported
    const embed = CLOUD_MODELS.find((m) => m.id === 'text-embedding-3-small')!
    expect(modelSupports(embed, 'chat')).toBe(false)
    expect(modelSupports(embed, 'embeddings')).toBe(true)
  })
})

/* -------------------------- config validation -------------------------- */

describe('profile AI config', () => {
  it('defaults to NEXA Free AI with a local-only fallback and local embeddings', () => {
    const c = defaultProfileAIConfig()
    expect(c.providerId).toBe('nexa')
    expect(c.model).toBe('free')
    expect(c.privacyMode).toBe('cloud_allowed')
    expect(c.fallback).toBe('local_only')
    expect(c.embedProviderId).toBe('ollama')
    expect(c.vision).toBe('auto')
  })

  it('normalizes untrusted persisted config safely', () => {
    expect(normalizeProfileAIConfig(null)).toEqual(defaultProfileAIConfig())
    expect(normalizeProfileAIConfig('nope')).toEqual(defaultProfileAIConfig())
    const bad = normalizeProfileAIConfig({ providerId: 'evil', privacyMode: 'yolo', fallback: 'always', vision: 'maybe' })
    expect(bad.providerId).toBe('nexa')
    expect(bad.privacyMode).toBe('cloud_allowed')
    const good = normalizeProfileAIConfig({ providerId: 'openai', model: 'gpt-4o', privacyMode: 'cloud_allowed', fallback: 'configured_provider', embedProviderId: 'ollama', vision: 'off' })
    expect(good.providerId).toBe('openai')
    expect(good.model).toBe('gpt-4o')
    expect(good.privacyMode).toBe('cloud_allowed')
    expect(good.vision).toBe('off')
  })

  it('rejects malformed model refs', () => {
    const c = normalizeProfileAIConfig({ providerId: 'openai', model: 'bad model!! <script>', privacyMode: 'cloud_allowed', fallback: 'none', embedProviderId: 'ollama', vision: 'auto' })
    expect(c.model).not.toBe('bad model!! <script>')
    expect(c.model).toBe(defaultProfileAIConfig().model)
  })
})

/* -------------------------------- routing ------------------------------- */

/** The previous out-of-the-box config: local Ollama only. */
const localOnly = () => ({ ...defaultProfileAIConfig(), providerId: 'ollama' as const, model: undefined, privacyMode: 'local_only' as const, fallback: 'local_only' as const })

describe('routing — local-first & privacy', () => {
  it('routes a local-only profile to local Ollama', () => {
    const d = routeAIRequest({ capability: 'chat', config: localOnly(), providers: [ollamaRt(), openaiRt()] })
    expect(d).toEqual({ ok: true, providerId: 'ollama', modelId: 'qwen3:8b', usedFallback: false, type: 'local' })
  })

  it('local_only prefers local even when cloud is the primary (never cloud)', () => {
    // Contradictory config (cloud primary + local_only) resolves to the safe
    // local provider, never the cloud one.
    const cfg = { ...defaultProfileAIConfig(), providerId: 'openai' as const, privacyMode: 'local_only' as const }
    const d = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt(), openaiRt()] })
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.providerId).toBe('ollama')
  })

  it('local_only with no local fallback blocks a cloud primary (PRIVACY_BLOCKED)', () => {
    const cfg = { ...defaultProfileAIConfig(), providerId: 'openai' as const, privacyMode: 'local_only' as const, fallback: 'none' as const }
    const d = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt(), openaiRt()] })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.error).toBe('PRIVACY_BLOCKED')
  })

  it('local_only → offline local yields AI-offline (no cloud escalation)', () => {
    const d = routeAIRequest({ capability: 'chat', config: localOnly(), providers: [ollamaRt({ health: health('LOCAL_OFFLINE') }), openaiRt()] })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.error).toBe('PROVIDER_OFFLINE')
  })

  it('cloud_allowed routes to a configured cloud primary', () => {
    const cfg = { ...defaultProfileAIConfig(), providerId: 'openai' as const, model: 'gpt-4o', privacyMode: 'cloud_allowed' as const, fallback: 'none' as const }
    const d = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt(), openaiRt()] })
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.providerId).toBe('openai')
      expect(d.modelId).toBe('gpt-4o')
    }
  })

  it('local_preferred + configured_provider falls back to cloud only when local is down', () => {
    const cfg = { ...defaultProfileAIConfig(), providerId: 'ollama' as const, privacyMode: 'local_preferred' as const, fallback: 'configured_provider' as const }
    // local healthy → stays local
    const healthy = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt(), openaiRt()] })
    expect(healthy.ok && healthy.providerId).toBe('ollama')
    // local down → cloud fallback allowed
    const down = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt({ health: health('LOCAL_OFFLINE') }), openaiRt()] })
    expect(down.ok).toBe(true)
    if (down.ok) {
      expect(down.providerId).toBe('openai')
      expect(down.usedFallback).toBe(true)
    }
  })

  it('local_preferred without configured_provider fallback stays local-only', () => {
    const cfg = { ...localOnly(), privacyMode: 'local_preferred' as const, fallback: 'local_only' as const }
    const down = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt({ health: health('LOCAL_OFFLINE') }), openaiRt()] })
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.error).toBe('PROVIDER_OFFLINE')
  })

  it('not-configured primary reports PROVIDER_NOT_CONFIGURED', () => {
    const cfg = { ...defaultProfileAIConfig(), providerId: 'openai' as const, privacyMode: 'cloud_allowed' as const, fallback: 'none' as const }
    const d = routeAIRequest({ capability: 'chat', config: cfg, providers: [ollamaRt(), openaiRt({ configured: false, health: health('NOT_CONFIGURED') })] })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.error).toBe('PROVIDER_NOT_CONFIGURED')
  })

  it('capability mismatch reports CAPABILITY_UNAVAILABLE (no silent downgrade)', () => {
    const cfg = localOnly()
    const d = routeAIRequest({ capability: 'vision', config: cfg, providers: [ollamaRt()] })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.error).toBe('CAPABILITY_UNAVAILABLE')
  })

  it('embeddings route to a model that supports embeddings', () => {
    const cfg = localOnly()
    const d = routeAIRequest({ capability: 'embeddings', config: cfg, providers: [ollamaRt()] })
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.modelId).toBe('nomic-embed-text:latest')
  })
})

/* ------------------------------ error model ----------------------------- */

describe('error model', () => {
  it('maps HTTP status to safe codes', () => {
    expect(normalizeHttpError(401)).toBe('AUTHENTICATION_FAILED')
    expect(normalizeHttpError(403)).toBe('AUTHENTICATION_FAILED')
    expect(normalizeHttpError(404)).toBe('MODEL_NOT_FOUND')
    expect(normalizeHttpError(429)).toBe('RATE_LIMITED')
    expect(normalizeHttpError(500)).toBe('PROVIDER_OFFLINE')
    expect(normalizeHttpError(418)).toBe('NETWORK_ERROR')
  })

  it('messages never leak secrets/internals', () => {
    for (const code of ['AUTHENTICATION_FAILED', 'PRIVACY_BLOCKED', 'RATE_LIMITED', 'CAPABILITY_UNAVAILABLE'] as const) {
      const m = aiProviderErrorMessage(code)
      expect(m).not.toMatch(/sk-|api[_-]?key|token|Bearer|\/Users\//i)
      expect(m.length).toBeGreaterThan(0)
    }
  })
})

/* --------------------------- context budgeting -------------------------- */

describe('context budgeting', () => {
  it('estimates tokens deterministically', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('includes high-priority sources first and truncates the rest', () => {
    const big = 'x'.repeat(400_000) // ~100k tokens
    const res = planContextBudget([
      { label: 'prompt', text: 'hello' },
      { label: 'page', text: big }
    ], { contextWindow: 8_192, maxOutputTokens: 1_024 })
    expect(res.included[0].label).toBe('prompt')
    expect(res.included[0].truncated).toBe(false)
    expect(res.truncatedAny).toBe(true)
    // page got truncated to fit remaining budget
    const page = res.included.find((s) => s.label === 'page')
    expect(page?.truncated).toBe(true)
    expect(res.usedTokens).toBeLessThanOrEqual(res.budgetTokens)
  })

  it('respects a tighter user contextLimit', () => {
    const res = planContextBudget([{ label: 'a', text: 'y'.repeat(40_000) }], { contextWindow: 128_000, contextLimit: 2_048, maxOutputTokens: 512 })
    expect(res.truncatedAny).toBe(true)
    expect(res.budgetTokens).toBeLessThan(2_048)
  })

  it('fits small content without truncation', () => {
    const res = planContextBudget([{ label: 'a', text: 'short text' }], { contextWindow: 8_192 })
    expect(res.truncatedAny).toBe(false)
    expect(res.included).toHaveLength(1)
  })
})

/* -------------------------------- cost ---------------------------------- */

describe('cost model', () => {
  it('local models are Free', () => {
    expect(formatCostLabel(ollamaModel)).toBe('Free')
    expect(estimateCost(ollamaModel, 1000, 1000)).toBeNull()
  })

  it('cloud cost estimated only when pricing is known', () => {
    const gpt = CLOUD_MODELS.find((m) => m.id === 'gpt-4o')!
    const cost = estimateCost(gpt, 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(2.5 + 10, 5)
    expect(formatCostLabel(gpt)).toMatch(/\$/)
  })

  it('never invents a price', () => {
    const unknown: AIModelInfo = { id: 'x', providerId: 'openai', displayName: 'X', local: false, capabilities: ollamaModel.capabilities }
    expect(formatCostLabel(unknown)).toBe('Cost unknown')
    expect(estimateCost(unknown, 100, 100)).toBeNull()
  })
})
