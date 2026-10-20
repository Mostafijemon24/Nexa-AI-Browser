/**
 * NEXA AI Gateway — wire protocol shared by the gateway server (`server/`) and
 * the Electron main-process client. Pure: no I/O, no secrets.
 *
 * The browser never talks to an upstream AI provider directly. It asks the
 * gateway for a logical `mode`; the gateway authenticates, enforces quotas and
 * decides the concrete provider/model server-side.
 */

import { z } from 'zod'

export const GATEWAY_API_VERSION = 1

export const GATEWAY_ROUTES = {
  health: '/api/ai/health',
  registerDevice: '/api/auth/device',
  chat: '/api/ai/chat',
  stream: '/api/ai/stream',
  models: '/api/ai/models',
  usage: '/api/ai/usage',
  providers: '/api/ai/providers',
  openrouterConnection: '/api/ai/providers/openrouter'
} as const

/* --------------------------------- Errors --------------------------------- */

export const GATEWAY_ERROR_CODES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'PREMIUM_NOT_CONNECTED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'INVALID_PROVIDER_KEY',
  'MODEL_UNAVAILABLE',
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  'AI_SERVICE_UNAVAILABLE',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED'
] as const

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number]

export const GATEWAY_ERROR_STATUS: Record<GatewayErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  PREMIUM_NOT_CONNECTED: 403,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_PROVIDER_KEY: 422,
  MODEL_UNAVAILABLE: 400,
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
  AI_SERVICE_UNAVAILABLE: 503,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405
}

export function isGatewayErrorCode(v: unknown): v is GatewayErrorCode {
  return typeof v === 'string' && (GATEWAY_ERROR_CODES as readonly string[]).includes(v)
}

/** User-safe message for a gateway error code. Never includes internals. */
export function gatewayErrorMessage(code: GatewayErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'NEXA AI session expired. Try again to reconnect.'
    case 'FORBIDDEN':
      return 'This AI request is not allowed for your account.'
    case 'PREMIUM_NOT_CONNECTED':
      return 'Premium AI is not connected. Connect OpenRouter in Settings → AI.'
    case 'RATE_LIMITED':
      return 'Too many AI requests. Wait a moment and try again.'
    case 'QUOTA_EXCEEDED':
      return 'Daily NEXA Free AI limit reached. It resets at midnight UTC.'
    case 'INVALID_REQUEST':
      return 'The AI request was invalid.'
    case 'PAYLOAD_TOO_LARGE':
      return 'The request is too large. Shorten the conversation or page context.'
    case 'INVALID_PROVIDER_KEY':
      return 'OpenRouter rejected this API key. Check the key and try again.'
    case 'MODEL_UNAVAILABLE':
      return 'The selected AI model is not available right now.'
    case 'PROVIDER_ERROR':
      return 'The AI provider returned an error. Try again.'
    case 'PROVIDER_TIMEOUT':
      return 'The AI provider took too long to respond.'
    case 'AI_SERVICE_UNAVAILABLE':
      return 'NEXA AI is temporarily unavailable.'
    case 'NOT_FOUND':
    case 'METHOD_NOT_ALLOWED':
      return 'NEXA AI request failed.'
  }
}

export interface GatewayErrorBody {
  error: { code: GatewayErrorCode; message: string; retryAfterSeconds?: number }
}

/* ------------------------------ Device auth ------------------------------- */

export const registerDeviceSchema = z.object({
  platform: z.enum(['darwin', 'win32', 'linux', 'other']).optional(),
  appVersion: z
    .string()
    .max(32)
    .regex(/^[0-9A-Za-z.+-]+$/)
    .optional()
})
export type RegisterDeviceRequest = z.infer<typeof registerDeviceSchema>

export interface RegisterDeviceResponse {
  token: string
  expiresAt: string
}

/** Opaque device bearer token format (`nxa_` + 43 base64url chars). */
export const DEVICE_TOKEN_RE = /^nxa_[A-Za-z0-9_-]{43}$/

/* --------------------------------- Chat ----------------------------------- */

export type AIMode = 'free' | 'premium'

export const GATEWAY_MAX_MESSAGES = 60
export const GATEWAY_MAX_MESSAGE_CHARS = 200_000

const gatewayModelIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9._:/-]+$/, 'invalid_model')

export const chatRequestSchema = z
  .object({
    mode: z.enum(['free', 'premium']),
    /** Optional concrete model; must be in the server's allow-list for `mode`. */
    model: gatewayModelIdSchema.optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string().min(1).max(GATEWAY_MAX_MESSAGE_CHARS)
          })
          .strict()
      )
      .min(1)
      .max(GATEWAY_MAX_MESSAGES),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().min(1).max(32_000).optional()
  })
  .strict()
export type ChatRequest = z.infer<typeof chatRequestSchema>

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResponse {
  id: string
  mode: AIMode
  model: string
  content: string
  finishReason: string | null
  usage: ChatUsage
}

/** Server-Sent Events emitted by `POST /api/ai/stream`. */
export type StreamEvent =
  | { event: 'start'; data: { id: string; mode: AIMode; model: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { model: string; finishReason: string | null; usage: ChatUsage } }
  | { event: 'error'; data: { code: GatewayErrorCode; message: string } }

/* -------------------------------- Models ---------------------------------- */

export interface GatewayModel {
  id: string
  name: string
  contextLength: number | null
}

export interface ModelsResponse {
  /** The model the server uses for each mode when none is requested. */
  defaults: { free: string; premium: string }
  free: GatewayModel[]
  /** Empty unless the account has premium connected. */
  premium: GatewayModel[]
  premiumAvailable: boolean
  updatedAt: string
}

/* --------------------------------- Usage ---------------------------------- */

export interface UsageResponse {
  day: string
  free: { requests: number; limit: number; inputTokens: number; outputTokens: number }
  premium: { requests: number; limit: number; inputTokens: number; outputTokens: number }
  limits: { requestsPerMinute: number; maxInputTokens: number; maxOutputTokens: number }
}

/* ------------------------------- Providers -------------------------------- */

export interface ProviderConnectionInfo {
  id: 'nexa-free' | 'openrouter'
  kind: 'free' | 'byok'
  label: string
  connected: boolean
  requiresKey: boolean
  /** Masked hint only (e.g. "…a1b2"). Never the key. */
  keyHint?: string
  lastValidatedAt?: string
}

export interface ProvidersResponse {
  providers: ProviderConnectionInfo[]
}

export const connectProviderSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(20)
      .max(256)
      .regex(/^[\x21-\x7e]+$/, 'invalid_key_format')
  })
  .strict()

/* ------------------------- Renderer-facing summary ------------------------ */

/** What Settings → AI receives over IPC. Contains no credentials. */
export type GatewayInfo =
  | { configured: false }
  | {
      configured: true
      origin: string | null
      health: string
      note?: string
      usage?: UsageResponse | null
      providers?: ProviderConnectionInfo[]
    }

/* --------------------------------- Health --------------------------------- */

export interface HealthResponse {
  status: 'ok' | 'degraded'
  provider: 'openrouter'
  configured: boolean
  version: number
}

/* ------------------------ Client-side model refs -------------------------- */
/* The Electron app stores a logical model ref in its profile config:
 *   'free'                  → NEXA Free AI, server default
 *   'free:<model>'          → a specific server-allowed free model
 *   'premium'               → premium, server default
 *   'premium:<model>'       → a specific server-allowed premium model        */

export function parseModelRef(ref: string | undefined): { mode: AIMode; model?: string } {
  if (!ref || ref === 'free') return { mode: 'free' }
  if (ref === 'premium') return { mode: 'premium' }
  if (ref.startsWith('free:')) return { mode: 'free', model: ref.slice(5) || undefined }
  if (ref.startsWith('premium:')) return { mode: 'premium', model: ref.slice(8) || undefined }
  return { mode: 'free' }
}

export function modelRef(mode: AIMode, model?: string): string {
  return model ? `${mode}:${model}` : mode
}

/** Gateway base URL policy: HTTPS required except for loopback development. */
export function validateGatewayUrl(raw: string, opts: { allowLoopbackHttp: boolean }): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.username || u.password || u.search || u.hash) return null
  if (u.protocol === 'https:') return u
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
  if (u.protocol === 'http:' && loopback && opts.allowLoopbackHttp) return u
  return null
}
