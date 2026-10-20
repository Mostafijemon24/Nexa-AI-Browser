/**
 * Model catalog + model router.
 *
 * The client asks for a logical mode ('free' | 'premium') and optionally a
 * model id. The router decides the concrete upstream model and which
 * credential pays for it. Free mode can only ever reach zero-priced models or
 * the operator-configured default, so a free request can never bill a paid
 * model on the server key.
 */

import type { AIMode, GatewayModel } from '../../src/shared/ai-gateway'
import type { GatewayConfig } from './config'
import { GatewayError } from './errors'
import type { Logger } from './log'
import type { AIProviderAdapter, ProviderModel } from './providers/types'

export function matchesAllow(id: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p === '*') return true
    if (p.startsWith('*')) return id.endsWith(p.slice(1))
    if (p.endsWith('*')) return id.startsWith(p.slice(0, -1))
    return p === id
  })
}

export class ModelCatalog {
  private cache: { models: ProviderModel[]; at: number } | null = null
  private inflight: Promise<ProviderModel[]> | null = null

  constructor(
    private provider: AIProviderAdapter,
    private cfg: GatewayConfig,
    private log: Logger,
    private now: () => number = Date.now
  ) {}

  /** Cached upstream catalog. Serves stale data if the provider is unreachable. */
  async all(): Promise<ProviderModel[]> {
    const fresh = this.cache && this.now() - this.cache.at < this.cfg.models.cacheTtlMs
    if (fresh) return this.cache!.models
    if (!this.cfg.openrouterApiKey) return this.cache?.models ?? []
    if (!this.inflight) {
      this.inflight = this.provider
        .listModels(this.cfg.openrouterApiKey)
        .then((models) => {
          this.cache = { models, at: this.now() }
          return models
        })
        .catch((e) => {
          this.log.warn('model catalog refresh failed', { error: e })
          return this.cache?.models ?? []
        })
        .finally(() => {
          this.inflight = null
        })
    }
    return this.inflight
  }

  get updatedAt(): number | null {
    return this.cache?.at ?? null
  }

  async freeModels(): Promise<GatewayModel[]> {
    const { freeDefault, freeAllow } = this.cfg.models
    const out = new Map<string, GatewayModel>()
    out.set(freeDefault, { id: freeDefault, name: 'NEXA Free AI', contextLength: null })
    for (const m of await this.all()) {
      if (!m.free || !m.textOutput || !matchesAllow(m.id, freeAllow)) continue
      if (m.id === freeDefault) continue
      out.set(m.id, { id: m.id, name: m.name, contextLength: m.contextLength })
    }
    return [...out.values()]
  }

  async premiumModels(): Promise<GatewayModel[]> {
    const { premiumDefault, premiumAllow } = this.cfg.models
    const out = new Map<string, GatewayModel>()
    out.set(premiumDefault, { id: premiumDefault, name: 'Auto (best available)', contextLength: null })
    for (const m of await this.all()) {
      // Free models are already offered in free mode; premium lists paid models only.
      if (!m.textOutput || m.free || m.id === this.cfg.models.freeDefault || !matchesAllow(m.id, premiumAllow) || m.id === premiumDefault) continue
      out.set(m.id, { id: m.id, name: m.name, contextLength: m.contextLength })
    }
    return [...out.values()].sort((a, b) => (a.id === premiumDefault ? -1 : b.id === premiumDefault ? 1 : a.name.localeCompare(b.name)))
  }
}

export interface RouteDecision {
  mode: AIMode
  model: string
  /** Which credential pays: the server key or the user's BYOK key. */
  credential: 'server' | 'byok'
}

export class ModelRouter {
  constructor(
    private catalog: ModelCatalog,
    private cfg: GatewayConfig
  ) {}

  async route(input: { mode: AIMode; model?: string; premiumConnected: boolean }): Promise<RouteDecision> {
    if (input.mode === 'premium') {
      if (!input.premiumConnected) throw new GatewayError('PREMIUM_NOT_CONNECTED')
      const model = input.model ?? this.cfg.models.premiumDefault
      if (model !== this.cfg.models.premiumDefault) {
        const allowed = (await this.catalog.premiumModels()).some((m) => m.id === model)
        if (!allowed) throw new GatewayError('MODEL_UNAVAILABLE', 'premium_model_not_allowed')
      }
      return { mode: 'premium', model, credential: 'byok' }
    }
    if (!this.cfg.openrouterApiKey) throw new GatewayError('AI_SERVICE_UNAVAILABLE', 'server_key_missing')
    const model = input.model ?? this.cfg.models.freeDefault
    if (model !== this.cfg.models.freeDefault) {
      const allowed = (await this.catalog.freeModels()).some((m) => m.id === model)
      if (!allowed) throw new GatewayError('MODEL_UNAVAILABLE', 'free_model_not_allowed')
    }
    return { mode: 'free', model, credential: 'server' }
  }
}
