/**
 * Provider adapter contract. The gateway core depends only on this interface;
 * OpenRouter is one implementation, and more can be added without touching
 * auth, quota or routing code.
 */

import type { ChatUsage } from '../../../src/shared/ai-gateway'

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProviderChatInput {
  /** Per-request credential. Held only for the duration of the call. */
  apiKey: string
  model: string
  messages: ProviderMessage[]
  maxOutputTokens: number
  temperature?: number
  signal: AbortSignal
}

export interface ProviderChatResult {
  model: string
  content: string
  finishReason: string | null
  usage: ChatUsage
}

export type ProviderStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; finishReason: string | null; usage: ChatUsage | null }

export interface ProviderModel {
  id: string
  name: string
  contextLength: number | null
  /** True when both prompt and completion pricing are zero. */
  free: boolean
  /** Text output supported (chat-capable). */
  textOutput: boolean
}

export type ProviderErrorKind = 'auth' | 'rate_limited' | 'model_unavailable' | 'bad_request' | 'timeout' | 'upstream' | 'network' | 'cancelled' | 'credits'

/** Normalized upstream failure. `status` is the upstream HTTP status, if any. */
export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    public status?: number
  ) {
    super(`provider_${kind}`)
  }
}

export interface AIProviderAdapter {
  readonly id: string
  chat(input: ProviderChatInput): Promise<ProviderChatResult>
  stream(input: ProviderChatInput): AsyncIterable<ProviderStreamChunk>
  listModels(apiKey: string, signal?: AbortSignal): Promise<ProviderModel[]>
  /** Returns true for a usable key, false for a rejected key. Throws on outage. */
  validateKey(apiKey: string, signal?: AbortSignal): Promise<boolean>
}
