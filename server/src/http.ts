import type { IncomingMessage, ServerResponse } from 'node:http'
import { GatewayError } from './errors'

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'interest-cohort=()'
}

export function applySecurityHeaders(res: ServerResponse, opts: { hsts: boolean }): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)
  if (opts.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...headers })
  res.end(payload)
}

export function sendError(res: ServerResponse, err: GatewayError): void {
  const headers: Record<string, string> = {}
  if (err.retryAfterSeconds != null) headers['Retry-After'] = String(err.retryAfterSeconds)
  if (err.code === 'AUTH_REQUIRED') headers['WWW-Authenticate'] = 'Bearer'
  sendJson(res, err.status, err.body(), headers)
}

/** Read and parse a JSON body with a hard byte cap (checked while streaming). */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') throw new GatewayError('INVALID_REQUEST', 'content_type')
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw new GatewayError('PAYLOAD_TOO_LARGE')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) {
      req.destroy()
      throw new GatewayError('PAYLOAD_TOO_LARGE')
    }
    chunks.push(chunk as Buffer)
  }
  if (!size) throw new GatewayError('INVALID_REQUEST', 'empty_body')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new GatewayError('INVALID_REQUEST', 'malformed_json')
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}

/** Client IP. With a trusted proxy, the right-most X-Forwarded-For hop is used. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff
    const hops = String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }
  return req.socket.remoteAddress || 'unknown'
}

export class SseWriter {
  private closed = false
  private heartbeat: ReturnType<typeof setInterval>

  constructor(private res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders?.()
    this.heartbeat = setInterval(() => this.raw(': keep-alive\n\n'), 15_000)
  }

  private raw(s: string): void {
    if (this.closed || this.res.writableEnded) return
    this.res.write(s)
  }

  send(event: string, data: unknown): void {
    this.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  end(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    if (!this.res.writableEnded) this.res.end()
  }
}
