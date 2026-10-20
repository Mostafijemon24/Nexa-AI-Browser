/**
 * Gateway configuration. Secrets come ONLY from the server environment (or a
 * secret manager that injects env vars / `*_FILE` mounts). Nothing here is ever
 * bundled into the Electron app.
 */

import { readFileSync } from 'node:fs'

export interface GatewayConfig {
  env: 'production' | 'development' | 'test'
  host: string
  port: number
  dbPath: string
  /** Server-side OpenRouter key for NEXA Free AI. Never logged or returned. */
  openrouterApiKey: string | null
  openrouterBaseUrl: string
  /** 32-byte AES-256-GCM master key for BYOK credentials. */
  encryptionKey: Buffer | null
  trustProxy: boolean
  tls: { certFile: string; keyFile: string } | null
  corsOrigins: string[]
  publicReferer: string
  appTitle: string
  maxBodyBytes: number
  providerTimeoutMs: number
  models: {
    freeDefault: string
    freeAllow: string[]
    premiumDefault: string
    premiumAllow: string[]
    cacheTtlMs: number
  }
  limits: {
    free: TierLimits
    premium: TierLimits
    ipPerMinute: number
    devicePerMinute: number
    registrationsPerIpPerHour: number
    maxConcurrentPerUser: number
    /** Free requests per client IP per UTC day, across all devices behind it. */
    freeIpPerDay: number
    /** Free requests per UTC day across all users (0 = no global cap). */
    freeGlobalPerDay: number
  }
  tokenTtlDays: number
  auditRetentionDays: number
}

export interface TierLimits {
  requestsPerMinute: number
  requestsPerDay: number
  maxInputTokens: number
  maxOutputTokens: number
}

export class ConfigError extends Error {}

const OPENROUTER_PROD_BASE = 'https://openrouter.ai/api/v1'

type Env = Record<string, string | undefined>

/** Read `NAME` or the contents of the file at `NAME_FILE` (Docker/K8s secrets). */
function secret(env: Env, name: string): string | null {
  const file = env[`${name}_FILE`]
  if (file) {
    try {
      const v = readFileSync(file, 'utf8').trim()
      return v || null
    } catch {
      throw new ConfigError(`${name}_FILE is set but the file could not be read`)
    }
  }
  const v = env[name]?.trim()
  return v ? v : null
}

function int(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name]
  if (raw == null || raw.trim() === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  return n
}

function bool(env: Env, name: string, def: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return def
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  throw new ConfigError(`${name} must be true or false`)
}

function list(env: Env, name: string, def: string[]): string[] {
  const raw = env[name]
  if (raw == null || raw.trim() === '') return def
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const MODEL_RE = /^[a-zA-Z0-9._:/*-]{1,160}$/

function decodeKey(raw: string): Buffer {
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null
  const buf = hex ?? Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new ConfigError('AI_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)')
  return buf
}

export function loadConfig(env: Env = process.env): GatewayConfig {
  const mode = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development'

  const openrouterApiKey = secret(env, 'OPENROUTER_API_KEY')
  const rawEnc = secret(env, 'AI_ENCRYPTION_KEY')
  const encryptionKey = rawEnc ? decodeKey(rawEnc) : null

  // SSRF guard: the upstream host is locked in production.
  const baseOverride = env.OPENROUTER_BASE_URL?.trim()
  if (baseOverride && mode === 'production') throw new ConfigError('OPENROUTER_BASE_URL cannot be overridden in production')
  const openrouterBaseUrl = (baseOverride || OPENROUTER_PROD_BASE).replace(/\/+$/, '')

  const certFile = env.AI_TLS_CERT_FILE?.trim()
  const keyFile = env.AI_TLS_KEY_FILE?.trim()
  if (!!certFile !== !!keyFile) throw new ConfigError('AI_TLS_CERT_FILE and AI_TLS_KEY_FILE must be set together')
  const tls = certFile && keyFile ? { certFile, keyFile } : null
  const trustProxy = bool(env, 'AI_TRUST_PROXY', false)

  const freeDefault = env.AI_FREE_MODEL?.trim() || 'openrouter/free'
  const premiumDefault = env.AI_PREMIUM_DEFAULT_MODEL?.trim() || 'openrouter/auto'
  const freeAllow = list(env, 'AI_FREE_MODELS', [freeDefault, '*:free'])
  const premiumAllow = list(env, 'AI_PREMIUM_MODELS', ['*'])
  for (const m of [freeDefault, premiumDefault, ...freeAllow, ...premiumAllow]) {
    if (!MODEL_RE.test(m)) throw new ConfigError('AI model configuration contains an invalid model id')
  }

  const free: TierLimits = {
    requestsPerMinute: int(env, 'AI_FREE_REQUESTS_PER_MINUTE', 10, 1, 10_000),
    requestsPerDay: int(env, 'AI_FREE_REQUESTS_PER_DAY', 200, 1, 1_000_000),
    maxInputTokens: int(env, 'AI_MAX_INPUT_TOKENS', 12_000, 256, 2_000_000),
    maxOutputTokens: int(env, 'AI_MAX_OUTPUT_TOKENS', 2_048, 16, 200_000)
  }
  const premium: TierLimits = {
    requestsPerMinute: int(env, 'AI_PREMIUM_REQUESTS_PER_MINUTE', 30, 1, 10_000),
    requestsPerDay: int(env, 'AI_PREMIUM_REQUESTS_PER_DAY', 2_000, 1, 1_000_000),
    maxInputTokens: int(env, 'AI_PREMIUM_MAX_INPUT_TOKENS', 64_000, 256, 2_000_000),
    maxOutputTokens: int(env, 'AI_PREMIUM_MAX_OUTPUT_TOKENS', 8_192, 16, 200_000)
  }

  const cfg: GatewayConfig = {
    env: mode,
    host: env.AI_GATEWAY_HOST?.trim() || '127.0.0.1',
    port: int(env, 'PORT', 8787, 0, 65_535),
    dbPath: env.AI_DB_PATH?.trim() || './data/nexa-ai.sqlite',
    openrouterApiKey,
    openrouterBaseUrl,
    encryptionKey,
    trustProxy,
    tls,
    corsOrigins: list(env, 'AI_CORS_ORIGINS', []),
    publicReferer: env.AI_PUBLIC_REFERER?.trim() || 'https://nexa.browser',
    appTitle: env.AI_APP_TITLE?.trim() || 'NEXA Browser',
    maxBodyBytes: int(env, 'AI_MAX_BODY_BYTES', 512 * 1024, 1024, 16 * 1024 * 1024),
    providerTimeoutMs: int(env, 'AI_PROVIDER_TIMEOUT_MS', 120_000, 1_000, 600_000),
    models: { freeDefault, freeAllow, premiumDefault, premiumAllow, cacheTtlMs: int(env, 'AI_MODEL_CACHE_TTL_SECONDS', 600, 10, 86_400) * 1000 },
    limits: {
      free,
      premium,
      ipPerMinute: int(env, 'AI_IP_REQUESTS_PER_MINUTE', 60, 1, 100_000),
      devicePerMinute: int(env, 'AI_DEVICE_REQUESTS_PER_MINUTE', 30, 1, 100_000),
      registrationsPerIpPerHour: int(env, 'AI_DEVICE_REGISTRATIONS_PER_IP_PER_HOUR', 10, 1, 10_000),
      maxConcurrentPerUser: int(env, 'AI_MAX_CONCURRENT_PER_USER', 2, 1, 100),
      freeIpPerDay: int(env, 'AI_FREE_REQUESTS_PER_IP_PER_DAY', 500, 1, 10_000_000),
      freeGlobalPerDay: int(env, 'AI_FREE_REQUESTS_GLOBAL_PER_DAY', 1_000, 0, 100_000_000)
    },
    tokenTtlDays: int(env, 'AI_DEVICE_TOKEN_TTL_DAYS', 90, 1, 3650),
    auditRetentionDays: int(env, 'AI_AUDIT_RETENTION_DAYS', 30, 1, 3650)
  }

  if (mode === 'production') {
    const missing: string[] = []
    if (!openrouterApiKey) missing.push('OPENROUTER_API_KEY')
    if (!encryptionKey) missing.push('AI_ENCRYPTION_KEY')
    if (missing.length) throw new ConfigError(`Missing required secret(s): ${missing.join(', ')}`)
    if (!tls && !trustProxy) {
      throw new ConfigError('Production requires HTTPS: set AI_TLS_CERT_FILE/AI_TLS_KEY_FILE or run behind a TLS proxy with AI_TRUST_PROXY=true')
    }
  }
  return cfg
}
