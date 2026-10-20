/**
 * Structured JSON logger with secret redaction. Prompts and completions are
 * never passed to the logger; this layer additionally scrubs anything that
 * looks like a credential in case a caller slips.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSink = (line: string) => void

const SENSITIVE_EXACT = /^(authorization|cookie|set-cookie|messages|content|prompt|ciphertext|key|token)$/i
const SENSITIVE_PART = /(api[-_]?key|secret|password|credential|encryption|bearer)/i

function sensitiveKey(k: string): boolean {
  return SENSITIVE_EXACT.test(k) || SENSITIVE_PART.test(k) || /(^|[-_])token$/i.test(k) || /[a-z]Token$/.test(k)
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /nxa_[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
]

export function redactString(s: string): string {
  let out = s
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]')
  return out.length > 2_000 ? out.slice(0, 2_000) + '…' : out
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (typeof value === 'string') return redactString(value)
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sensitiveKey(k) ? '[REDACTED]' : redact(v, depth + 1)
  }
  return out
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function createLogger(opts: { level?: LogLevel; sink?: LogSink } = {}): Logger {
  const min = ORDER[opts.level ?? 'info']
  const sink: LogSink = opts.sink ?? ((line) => process.stdout.write(line + '\n'))
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return
    const rec = { ts: new Date().toISOString(), level, msg: redactString(msg), ...(fields ? (redact(fields) as Record<string, unknown>) : {}) }
    sink(JSON.stringify(rec))
  }
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f)
  }
}
