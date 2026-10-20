import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  CHAT_TIMEOUT_MS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  EMBED_TIMEOUT_MS,
  MAX_CONCURRENT_AI,
  OLLAMA_ENDPOINT,
  STATUS_TIMEOUT_MS,
  type AiMessage,
  aiErrorMessage,
  type AiLocalStatus,
  type AiModel,
  type AiSettings,
  type AiStatus,
  type AiStreamEvent
} from '../../shared/ai'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import { OllamaClient, type OllamaError } from './ollama'
import { assertSafeProfileId } from '../../platform'
import { classifyVisionCapability, VISION_TIMEOUT_MS, type VisionStatus } from '../../shared/vision'
import type { AIProviderRegistry } from './ai-registry'
import { providerErrorCode } from './ai-provider-adapters'
import { PROVIDER_META, type AIProviderId, type ProfileAIConfig } from '../../shared/ai-providers'

/**
 * Main-process Local AI service. Wraps the Ollama provider, owns request
 * lifecycle + cancellation, and pushes streaming events to the renderer.
 *
 * Privacy: prompts, page content, selections and responses are NEVER logged.
 * Local-only: no cloud provider, no fallback. Settings are profile-scoped.
 */

type Emit = (event: AiStreamEvent) => void

interface ActiveRequest {
  profileId: string
  controller: AbortController
}

function codeOf(e: unknown): string {
  const c = (e as OllamaError)?.code
  if (c) return c
  const m = e instanceof Error ? e.message : ''
  if (m === 'timeout') return 'timeout'
  return 'error'
}

export class AIService {
  private client: OllamaClient
  private active = new Map<string, ActiveRequest>()
  /** STEP 12 — optional multi-provider registry. When absent, behavior is the
   * original local-only Ollama path (backward-compatible for existing tests). */
  private registry?: AIProviderRegistry

  constructor(
    private persist: Persistence,
    private emit: Emit,
    opts: { client?: OllamaClient; registry?: AIProviderRegistry } = {}
  ) {
    this.client = opts.client || new OllamaClient()
    this.registry = opts.registry
  }

  /** STEP 12 — expose the registry surface through the single AI service. */
  get providers(): AIProviderRegistry | undefined {
    return this.registry
  }

  private settingsPath(profileId: string): string {
    const dir = this.persist.profileDir(profileId)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'ai.json')
  }

  getSettings(profileId: string): AiSettings {
    assertSafeProfileId(profileId)
    const saved = readJsonSafe<Partial<AiSettings>>(this.settingsPath(profileId), {})
    return {
      chatModel: typeof saved.chatModel === 'string' && saved.chatModel ? saved.chatModel : DEFAULT_CHAT_MODEL,
      embedModel: typeof saved.embedModel === 'string' && saved.embedModel ? saved.embedModel : DEFAULT_EMBED_MODEL,
      cloudEnabled: false
    }
  }

  saveSettings(profileId: string, patch: { chatModel?: string; embedModel?: string }): AiSettings {
    assertSafeProfileId(profileId)
    const cur = this.getSettings(profileId)
    const next: AiSettings = {
      chatModel: patch.chatModel || cur.chatModel,
      embedModel: patch.embedModel || cur.embedModel,
      cloudEnabled: false
    }
    writeJsonAtomic(this.settingsPath(profileId), next)
    return next
  }

  /**
   * Live status of the provider chat is routed to. Without a registry this is
   * the original local-only Ollama status.
   */
  async status(profileId: string): Promise<AiStatus> {
    const local = await this.localStatus(profileId)
    if (!this.registry) return local
    const config = this.registry.getConfig(profileId)
    const decision = await this.registry.route(profileId, 'chat')
    const localView: AiLocalStatus = { state: local.state, endpoint: local.endpoint, chatModel: local.chatModel, embedModel: local.embedModel, models: local.models, note: local.note }
    const routedId = decision.ok ? decision.providerId : config.providerId
    if (routedId === 'ollama') return { ...local, providerId: 'ollama', providerName: PROVIDER_META.ollama.name, local: localView }

    const models = decision.ok ? await this.registry.listModels(profileId).catch(() => []) : []
    const own = models.filter((m) => m.providerId === routedId && m.capabilities.chat === 'supported')
    const chatModel = decision.ok ? decision.modelId : config.model || ''
    const label = own.find((m) => m.id === chatModel)?.displayName
    return {
      state: decision.ok ? 'connected' : 'offline',
      endpoint: routedId === 'nexa' ? this.registry.gateway.origin || '' : PROVIDER_META[routedId].endpoint,
      chatModel,
      embedModel: local.embedModel,
      models: own.map((m) => ({ name: m.id, displayName: m.displayName, family: routedId, paramSize: '', quant: '', contextLength: m.contextWindow ?? null, capabilities: ['completion'], embedding: false })),
      cloudEnabled: true,
      processing: 'cloud',
      note: decision.ok ? undefined : aiErrorMessage(decision.error),
      providerId: routedId,
      providerName: PROVIDER_META[routedId].name,
      modelLabel: label,
      local: localView
    }
  }

  /** Local Ollama runtime status (connection + installed models). */
  private async localStatus(profileId: string): Promise<AiStatus> {
    const settings = this.getSettings(profileId)
    const base: Omit<AiStatus, 'state' | 'models' | 'note'> = {
      endpoint: OLLAMA_ENDPOINT,
      chatModel: settings.chatModel,
      embedModel: settings.embedModel,
      cloudEnabled: false,
      processing: 'local-only'
    }
    try {
      const models = await this.client.listModels({ timeoutMs: STATUS_TIMEOUT_MS })
      const hasChat = models.some((m) => m.name === settings.chatModel)
      return {
        ...base,
        state: 'connected',
        models,
        note: hasChat ? undefined : 'Selected chat model is not installed.'
      }
    } catch (e) {
      const offline = codeOf(e) === 'ollama_offline' || codeOf(e) === 'timeout'
      return {
        ...base,
        state: 'offline',
        models: [],
        note: offline ? 'Local AI unavailable — start Ollama to use Local AI.' : 'Could not reach the local AI backend.'
      }
    }
  }

  async models(profileId: string): Promise<AiModel[]> {
    assertSafeProfileId(profileId)
    return this.client.listModels({ timeoutMs: STATUS_TIMEOUT_MS })
  }

  async testConnection(profileId: string): Promise<{ ok: boolean; models: number; note?: string }> {
    const s = await this.localStatus(profileId)
    return { ok: s.state === 'connected', models: s.models.length, note: s.note }
  }

  /**
   * Start a streaming chat. Returns immediately after validation; results are
   * delivered via emit(ai.event). Real HTTP streaming + real cancellation.
   */
  async chat(profileId: string, requestId: string, messages: AiMessage[], model?: string, opts: { private?: boolean } = {}): Promise<void> {
    assertSafeProfileId(profileId)
    if (this.active.has(requestId)) return // idempotent: ignore duplicate start
    if (this.active.size >= MAX_CONCURRENT_AI) {
      this.emit({ type: 'error', requestId, profileId, code: 'busy', message: 'busy' })
      return
    }

    const settings = this.getSettings(profileId)
    let providerId: AIProviderId = 'ollama'
    let chatModel = model || settings.chatModel

    // STEP 12 — deterministic routing (privacy + capability + health). When no
    // registry is present this is skipped and the local Ollama path is used.
    if (this.registry) {
      // Private tabs never leave the machine: force local-only routing.
      const override: Partial<ProfileAIConfig> | undefined = opts.private ? { privacyMode: 'local_only' } : undefined
      const decision = await this.registry.route(profileId, 'chat', { configOverride: override })
      if (!decision.ok) {
        const code = opts.private && decision.error === 'PRIVACY_BLOCKED' ? 'PRIVATE_LOCAL_ONLY' : decision.error
        this.emit({ type: 'error', requestId, profileId, code, message: aiErrorMessage(code) })
        return
      }
      providerId = decision.providerId
      // The renderer's model hint is an Ollama name; other providers use the
      // config-routed model ref so a local name is never sent upstream.
      if (!model || providerId !== 'ollama') chatModel = decision.modelId
    }

    // Ollama-only: verify the model is actually installed (honest state).
    if (providerId === 'ollama') {
      let installed: AiModel[]
      try {
        installed = await this.client.listModels({ timeoutMs: STATUS_TIMEOUT_MS })
      } catch (e) {
        const code = codeOf(e)
        this.emit({ type: 'error', requestId, profileId, code, message: aiErrorMessage(code) })
        return
      }
      if (!installed.some((m) => m.name === chatModel)) {
        this.emit({ type: 'error', requestId, profileId, code: 'model_not_installed', message: aiErrorMessage('model_not_installed') })
        return
      }
    }

    const controller = new AbortController()
    this.active.set(requestId, { profileId, controller })
    this.emit({ type: 'start', requestId, profileId, model: chatModel })

    try {
      const onDelta = (delta: string) => {
        if (delta) this.emit({ type: 'delta', requestId, profileId, delta })
      }
      let content: string
      let meta: { model?: string; usage?: { inputTokens: number; outputTokens: number } } = {}
      if (providerId === 'ollama' || !this.registry) {
        content = await this.client.chat({ model: chatModel, messages, signal: controller.signal, timeoutMs: CHAT_TIMEOUT_MS, onDelta })
      } else {
        const adapter = this.registry.adapterFor(providerId)
        content = await adapter.chat({
          model: chatModel,
          messages,
          apiKey: this.registry.keyForRouting(providerId),
          signal: controller.signal,
          timeoutMs: CHAT_TIMEOUT_MS,
          onDelta,
          onMeta: (m) => {
            meta = m
          }
        })
      }
      this.emit({ type: 'done', requestId, profileId, content, ...(meta.model ? { model: meta.model } : {}), ...(meta.usage ? { usage: meta.usage } : {}) })
    } catch (e) {
      const code = providerId === 'ollama' ? codeOf(e) : providerErrorCode(e)
      if (code === 'cancelled' || code === 'REQUEST_CANCELLED') this.emit({ type: 'cancelled', requestId, profileId })
      else this.emit({ type: 'error', requestId, profileId, code, message: aiErrorMessage(code) })
    } finally {
      this.active.delete(requestId)
    }
  }

  /**
   * Non-streaming completion used by the Browser Agent planner. Reuses the same
   * OllamaClient (no second runtime). Verifies the model is installed and honors
   * an external AbortSignal for cancellation. Returns the full model text.
   * Never logs prompts or responses.
   */
  async complete(
    profileId: string,
    params: { messages: AiMessage[]; model?: string; signal?: AbortSignal; timeoutMs?: number; private?: boolean }
  ): Promise<string> {
    assertSafeProfileId(profileId)
    const settings = this.getSettings(profileId)
    let providerId: AIProviderId = 'ollama'
    let chatModel = params.model || settings.chatModel
    if (this.registry) {
      // Private tasks never leave the machine (same rule as private-tab chat).
      const override: Partial<ProfileAIConfig> | undefined = params.private ? { privacyMode: 'local_only' } : undefined
      const decision = await this.registry.route(profileId, 'chat', { configOverride: override })
      if (!decision.ok) {
        const code = params.private && decision.error === 'PRIVACY_BLOCKED' ? 'PRIVATE_LOCAL_ONLY' : decision.error
        throw Object.assign(new Error(code), { code })
      }
      providerId = decision.providerId
      if (!params.model || providerId !== 'ollama') chatModel = decision.modelId
    }
    let out = ''
    const onDelta = (d: string) => {
      if (d) out += d
    }
    if (providerId === 'ollama' || !this.registry) {
      const installed = await this.client.listModels({ timeoutMs: STATUS_TIMEOUT_MS })
      if (!installed.some((m) => m.name === chatModel)) throw Object.assign(new Error('model_not_installed'), { code: 'model_not_installed' })
      await this.client.chat({ model: chatModel, messages: params.messages, signal: params.signal, timeoutMs: params.timeoutMs ?? CHAT_TIMEOUT_MS, onDelta })
    } else {
      const adapter = this.registry.adapterFor(providerId)
      await adapter.chat({ model: chatModel, messages: params.messages, apiKey: this.registry.keyForRouting(providerId), signal: params.signal, timeoutMs: params.timeoutMs ?? CHAT_TIMEOUT_MS, onDelta })
    }
    return out
  }

  /* ------------------------------------------------------------------------ */
  /* STEP 12 — multi-provider management surface (delegates to the registry). */
  /* Renderer only ever receives non-secret metadata via these methods.       */

  async listProviders(profileId: string, opts?: { refresh?: boolean }) {
    if (!this.registry) return []
    return this.registry.listProviders(profileId, opts)
  }

  async configureProvider(profileId: string, providerId: AIProviderId, apiKey: string) {
    assertSafeProfileId(profileId)
    if (!this.registry) throw new Error('providers_unavailable')
    this.registry.setKey(providerId, apiKey)
    // Immediately verify (honest state) — never echo the key back.
    const health = await this.registry.testProvider(providerId)
    return { configured: true, health: health.state, note: health.note }
  }

  async removeProvider(profileId: string, providerId: AIProviderId) {
    assertSafeProfileId(profileId)
    if (!this.registry) throw new Error('providers_unavailable')
    this.registry.removeProvider(providerId)
    return { configured: false }
  }

  async testProvider(profileId: string, providerId: AIProviderId) {
    assertSafeProfileId(profileId)
    if (!this.registry) throw new Error('providers_unavailable')
    const health = await this.registry.testProvider(providerId)
    return { health: health.state, note: health.note }
  }

  /** NEXA AI account overview for Settings: health, usage, provider connections. */
  async gatewayInfo(profileId: string) {
    assertSafeProfileId(profileId)
    if (!this.registry) return { configured: false as const }
    const gw = this.registry.gateway
    if (!gw.configured) return { configured: false as const }
    const health = await this.registry.testProvider('nexa')
    if (health.state !== 'CONNECTED') return { configured: true as const, origin: gw.origin, health: health.state, note: health.note }
    const [usage, providers] = await Promise.all([gw.usage().catch(() => null), gw.providers().catch(() => null)])
    return { configured: true as const, origin: gw.origin, health: health.state, usage, providers: providers?.providers ?? [] }
  }

  /** Forward a BYOK key to the gateway once; it is validated + encrypted server-side. */
  async connectPremium(profileId: string, apiKey: string) {
    assertSafeProfileId(profileId)
    if (!this.registry) throw new Error('providers_unavailable')
    try {
      const res = await this.registry.gateway.connectOpenRouter(apiKey)
      return { ok: true as const, providers: res.providers }
    } catch (e) {
      const code = providerErrorCode(e)
      return { ok: false as const, code, message: aiErrorMessage(code) }
    } finally {
      this.registry.invalidate('nexa')
    }
  }

  async disconnectPremium(profileId: string) {
    assertSafeProfileId(profileId)
    if (!this.registry) throw new Error('providers_unavailable')
    try {
      const res = await this.registry.gateway.disconnectOpenRouter()
      const cfg = this.registry.getConfig(profileId)
      if (cfg.providerId === 'nexa' && cfg.model?.startsWith('premium')) this.registry.updateConfig(profileId, { model: 'free' })
      return { ok: true as const, providers: res.providers }
    } catch (e) {
      const code = providerErrorCode(e)
      return { ok: false as const, code, message: aiErrorMessage(code) }
    } finally {
      this.registry.invalidate('nexa')
    }
  }

  getAIConfig(profileId: string) {
    if (!this.registry) return null
    return this.registry.getConfig(profileId)
  }

  updateAIConfig(profileId: string, patch: Record<string, unknown>) {
    if (!this.registry) throw new Error('providers_unavailable')
    return this.registry.updateConfig(profileId, patch)
  }

  async listAllModels(profileId: string) {
    if (!this.registry) return []
    return this.registry.listModels(profileId)
  }

  /**
   * P5.3 — honest runtime vision-capability detection for the configured model.
   * Reuses the existing Ollama client (no second runtime, no cloud fallback).
   */
  async visionStatus(profileId: string, model?: string): Promise<VisionStatus> {
    assertSafeProfileId(profileId)
    const settings = this.getSettings(profileId)
    const target = model || settings.chatModel
    try {
      const info = await this.client.show(target, { timeoutMs: STATUS_TIMEOUT_MS })
      const capability = classifyVisionCapability({ capabilities: info.capabilities, family: info.family, families: info.families, name: target })
      return {
        capability,
        model: target,
        note: capability === 'VISION_CAPABLE' ? undefined : `The selected model (${target}) is text-only. Vision is not configured.`
      }
    } catch (e) {
      const code = codeOf(e)
      if (code === 'ollama_offline' || code === 'timeout') return { capability: 'UNAVAILABLE', model: target, note: 'Local AI unavailable — start Ollama.' }
      if (code === 'model_not_installed') return { capability: 'UNAVAILABLE', model: target, note: `Model ${target} is not installed.` }
      return { capability: 'ERROR', model: target, note: 'Could not determine vision capability.' }
    }
  }

  /**
   * P5.3 — multimodal analysis of a single screenshot. Reuses the Ollama chat
   * path with images attached to the user message. Verifies the model is actually
   * vision-capable first (honest NOT_CONFIGURED), and never logs images or text.
   * The image is processed locally and never persisted or uploaded.
   */
  async visionAnalyze(
    profileId: string,
    params: { image: string; prompt: string; system?: string; model?: string; signal?: AbortSignal; timeoutMs?: number }
  ): Promise<{ ok: boolean; text?: string; error?: string }> {
    assertSafeProfileId(profileId)
    const settings = this.getSettings(profileId)
    const model = params.model || settings.chatModel
    const status = await this.visionStatus(profileId, model)
    if (status.capability !== 'VISION_CAPABLE') {
      return { ok: false, error: status.capability === 'UNAVAILABLE' ? 'vision_unavailable' : 'vision_not_configured' }
    }
    // Strip any data-uri prefix — Ollama expects raw base64.
    const b64 = params.image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    const messages: AiMessage[] = []
    if (params.system) messages.push({ role: 'system', content: params.system })
    messages.push({ role: 'user', content: params.prompt })
    try {
      let out = ''
      await this.client.chat({
        model,
        messages,
        images: [b64],
        signal: params.signal,
        timeoutMs: params.timeoutMs ?? VISION_TIMEOUT_MS,
        onDelta: (d) => {
          if (d) out += d
        }
      })
      return { ok: true, text: out }
    } catch (e) {
      const code = codeOf(e)
      if (code === 'cancelled') return { ok: false, error: 'vision_cancelled' }
      if (code === 'timeout') return { ok: false, error: 'vision_timeout' }
      return { ok: false, error: 'vision_provider_error' }
    }
  }

  /** Abort an in-flight request. Returns true if a request was cancelled. */
  cancel(profileId: string, requestId: string): boolean {
    assertSafeProfileId(profileId)
    const req = this.active.get(requestId)
    if (!req || req.profileId !== profileId) return false
    req.controller.abort(new Error('cancelled'))
    return true
  }

  async embed(profileId: string, input: string | string[], model?: string): Promise<number[][]> {
    assertSafeProfileId(profileId)
    const settings = this.getSettings(profileId)
    // STEP 12 — embeddings stay local unless the profile explicitly selects a
    // configured cloud embedding provider and privacy allows it. Never uploads
    // embeddings to the cloud by default.
    if (this.registry) {
      const cfg = this.registry.getConfig(profileId)
      if (cfg.embedProviderId !== 'ollama') {
        const decision = await this.registry.route(profileId, 'embeddings', {
          configOverride: { providerId: cfg.embedProviderId, model: cfg.embedModel }
        })
        if (decision.ok && decision.providerId !== 'ollama') {
          const adapter = this.registry.adapterFor(decision.providerId)
          if (adapter.embed) {
            return adapter.embed({ model: model || decision.modelId, input, apiKey: this.registry.keyForRouting(decision.providerId), timeoutMs: EMBED_TIMEOUT_MS })
          }
        }
      }
    }
    return this.client.embed({ model: model || settings.embedModel, input, timeoutMs: EMBED_TIMEOUT_MS })
  }

  /** Cancel everything (app shutdown / profile switch). */
  dispose(): void {
    for (const { controller } of this.active.values()) controller.abort(new Error('cancelled'))
    this.active.clear()
  }
}
