/**
 * STEP 12 — AIProviderRegistry.
 *
 * Owns: profile-scoped AI configuration (non-secret, on disk), cloud API keys
 * (OS SecureStorage only — never on disk in plaintext, never to renderer),
 * provider adapters, a brief health/model cache, and deterministic routing via
 * the pure `routeAIRequest` core.
 *
 * The renderer only ever receives `AIProviderInfo` (metadata) — never keys.
 */

import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import { assertSafeProfileId } from '../../platform'
import { OllamaClient } from './ollama'
import {
  AnthropicProviderAdapter,
  NexaGatewayAdapter,
  OllamaProviderAdapter,
  OpenAIProviderAdapter,
  type AIProviderAdapter
} from './ai-provider-adapters'
import { GatewayClient } from './ai-gateway-client'
import {
  KNOWN_PROVIDER_IDS,
  PROVIDER_META,
  cloudModelsFor,
  defaultCloudChatModel,
  isKnownProvider,
  isManagedProvider,
  normalizeProfileAIConfig,
  providerType,
  routeAIRequest,
  type AICapability,
  type AIModelInfo,
  type AIProviderHealth,
  type AIProviderId,
  type AIProviderInfo,
  type AIProviderRuntime,
  type AIRouteDecision,
  type ProfileAIConfig
} from '../../shared/ai-providers'

/** Minimal secret store (satisfied by SecureStorage; fakeable in tests). */
export interface SecretStore {
  available(): boolean
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

const HEALTH_TTL_MS = 15_000
const MODELS_TTL_MS = 30_000
const keyName = (id: AIProviderId) => `ai.key.${id}`

interface CacheEntry<T> {
  value: T
  at: number
}

export class AIProviderRegistry {
  private adapters: Record<AIProviderId, AIProviderAdapter>
  private gatewayClient: GatewayClient
  private healthCache = new Map<AIProviderId, CacheEntry<AIProviderHealth>>()
  private modelCache = new Map<AIProviderId, CacheEntry<AIModelInfo[]>>()

  constructor(
    private persist: Persistence,
    private secure: SecretStore,
    opts: { ollamaClient?: OllamaClient; gateway?: GatewayClient; adapters?: Partial<Record<AIProviderId, AIProviderAdapter>> } = {}
  ) {
    const ollama = new OllamaProviderAdapter(opts.ollamaClient || new OllamaClient())
    // Without an explicit gateway the provider is present but NOT_CONFIGURED.
    this.gatewayClient = opts.gateway || new GatewayClient({ baseUrl: null, allowLoopbackHttp: false, secure })
    this.adapters = {
      nexa: new NexaGatewayAdapter(this.gatewayClient),
      ollama,
      openai: new OpenAIProviderAdapter(),
      anthropic: new AnthropicProviderAdapter(),
      ...(opts.adapters as Record<AIProviderId, AIProviderAdapter> | undefined)
    }
  }

  /* ------------------------------- config -------------------------------- */

  private configPath(profileId: string): string {
    const dir = this.persist.profileDir(profileId)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'ai-config.json')
  }

  getConfig(profileId: string): ProfileAIConfig {
    assertSafeProfileId(profileId)
    return normalizeProfileAIConfig(readJsonSafe<unknown>(this.configPath(profileId), null))
  }

  updateConfig(profileId: string, patch: Partial<ProfileAIConfig>): ProfileAIConfig {
    assertSafeProfileId(profileId)
    const next = normalizeProfileAIConfig({ ...this.getConfig(profileId), ...patch })
    writeJsonAtomic(this.configPath(profileId), next)
    return next
  }

  /* ------------------------------- secrets ------------------------------- */

  /** True when a cloud provider has a stored key (or is the always-local Ollama). */
  isConfigured(id: AIProviderId): boolean {
    if (providerType(id) === 'local') return true
    if (isManagedProvider(id)) return this.gatewayClient.configured
    return !!this.secure.get(keyName(id))
  }

  /** The NEXA AI Gateway client (premium connect, usage, models). */
  get gateway(): GatewayClient {
    return this.gatewayClient
  }

  /** Drop cached health + models (e.g. after a premium connection change). */
  invalidate(id: AIProviderId): void {
    this.healthCache.delete(id)
    this.modelCache.delete(id)
  }

  /** Store a cloud API key. Returns only success — never echoes the key. */
  setKey(id: AIProviderId, apiKey: string): void {
    if (providerType(id) !== 'cloud' || isManagedProvider(id)) throw new Error('provider_has_no_key')
    if (!this.secure.available()) throw new Error('secure_storage_unavailable')
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('empty_key')
    this.secure.set(keyName(id), trimmed)
    this.healthCache.delete(id)
  }

  removeProvider(id: AIProviderId): void {
    if (providerType(id) !== 'cloud' || isManagedProvider(id)) throw new Error('provider_has_no_key')
    this.secure.delete(keyName(id))
    this.healthCache.delete(id)
  }

  private keyFor(id: AIProviderId): string | null {
    return providerType(id) === 'cloud' && !isManagedProvider(id) ? this.secure.get(keyName(id)) : null
  }

  /* ------------------------------- health -------------------------------- */

  async refreshHealth(id: AIProviderId): Promise<AIProviderHealth> {
    const adapter = this.adapters[id]
    const health = await adapter.health({ apiKey: this.keyFor(id) })
    this.healthCache.set(id, { value: health, at: Date.now() })
    return health
  }

  private cachedHealth(id: AIProviderId): AIProviderHealth {
    const c = this.healthCache.get(id)
    if (c && Date.now() - c.at < HEALTH_TTL_MS) return c.value
    if (providerType(id) === 'cloud' && !this.isConfigured(id)) return { state: 'NOT_CONFIGURED' }
    return { state: 'CHECKING' }
  }

  private async models(id: AIProviderId): Promise<AIModelInfo[]> {
    if (providerType(id) === 'cloud' && !isManagedProvider(id)) return cloudModelsFor(id)
    const c = this.modelCache.get(id)
    if (c && Date.now() - c.at < MODELS_TTL_MS) return c.value
    try {
      const list = await this.adapters[id].listModels({ apiKey: this.keyFor(id) })
      this.modelCache.set(id, { value: list, at: Date.now() })
      return list
    } catch {
      return this.modelCache.get(id)?.value ?? []
    }
  }

  /* --------------------------- provider surface -------------------------- */

  /** Non-secret provider metadata for the renderer. `refresh` does live checks. */
  async listProviders(profileId: string, opts: { refresh?: boolean } = {}): Promise<AIProviderInfo[]> {
    assertSafeProfileId(profileId)
    const config = this.getConfig(profileId)
    const out: AIProviderInfo[] = []
    for (const id of KNOWN_PROVIDER_IDS) {
      if (opts.refresh) await this.refreshHealth(id).catch(() => {})
      const health = this.cachedHealth(id)
      const models = await this.models(id)
      out.push({
        id,
        name: PROVIDER_META[id].name,
        type: providerType(id),
        configured: this.isConfigured(id),
        health: health.state,
        note: health.note,
        defaultModel: id === config.providerId ? config.model : undefined,
        models
      })
    }
    return out
  }

  /** Live authenticated health check for a single provider (used by "Test"). */
  async testProvider(id: AIProviderId): Promise<AIProviderHealth> {
    if (!isKnownProvider(id)) throw new Error('unknown_provider')
    return this.refreshHealth(id)
  }

  async listModels(profileId: string): Promise<AIModelInfo[]> {
    assertSafeProfileId(profileId)
    const all: AIModelInfo[] = []
    for (const id of KNOWN_PROVIDER_IDS) {
      if (!this.isConfigured(id)) continue
      all.push(...(await this.models(id)))
    }
    return all
  }

  /* ------------------------------- routing ------------------------------- */

  private async buildRuntimes(): Promise<AIProviderRuntime[]> {
    const rts: AIProviderRuntime[] = []
    for (const id of KNOWN_PROVIDER_IDS) {
      const configured = this.isConfigured(id)
      const health = configured ? await this.refreshHealthCached(id) : { state: 'NOT_CONFIGURED' as const }
      const models = configured ? await this.models(id) : []
      rts.push({
        id,
        type: providerType(id),
        configured,
        health,
        models,
        defaultModel: isManagedProvider(id)
          ? 'free'
          : providerType(id) === 'cloud'
            ? defaultCloudChatModel(id)
            : models.find((m) => m.capabilities.chat === 'supported')?.id
      })
    }
    return rts
  }

  private async refreshHealthCached(id: AIProviderId): Promise<AIProviderHealth> {
    const c = this.healthCache.get(id)
    if (c && Date.now() - c.at < HEALTH_TTL_MS) return c.value
    return this.refreshHealth(id).catch(() => ({ state: 'ERROR' as const }))
  }

  /** Deterministic route for a capability under the profile's config + health. */
  async route(
    profileId: string,
    capability: AICapability,
    opts: { configOverride?: Partial<ProfileAIConfig> } = {}
  ): Promise<AIRouteDecision> {
    assertSafeProfileId(profileId)
    const config = { ...this.getConfig(profileId), ...opts.configOverride }
    const providers = await this.buildRuntimes()
    return routeAIRequest({ capability, config, providers })
  }

  /** Dispatch a streaming chat to the routed provider. Never logs prompts/keys. */
  adapterFor(id: AIProviderId): AIProviderAdapter {
    return this.adapters[id]
  }

  keyForRouting(id: AIProviderId): string | null {
    return this.keyFor(id)
  }
}
