/**
 * Test harness: a real NEXA AI Gateway HTTP server wired to a fake OpenRouter
 * upstream (both on loopback). No network beyond 127.0.0.1.
 */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createGateway, type Gateway } from '../../server/src/app'
import { loadConfig, type GatewayConfig } from '../../server/src/config'
import { GatewayStore } from '../../server/src/db'
import { createLogger } from '../../server/src/log'
import { OpenRouterAdapter } from '../../server/src/providers/openrouter'

export const SERVER_KEY = 'sk-or-v1-server' + randomBytes(16).toString('hex')
export const VALID_BYOK = 'sk-or-v1-byok' + randomBytes(16).toString('hex')
export const ENC_KEY_HEX = randomBytes(32).toString('hex')

export type UpstreamMode = 'ok' | 'hang' | 'auth_error' | 'mid_stream_error' | 'rate_limited'

export interface UpstreamCall {
  path: string
  method: string
  authorization: string | undefined
  body: Record<string, unknown> | null
}

export interface FakeUpstream {
  url: string
  calls: UpstreamCall[]
  mode: UpstreamMode
  close(): Promise<void>
}

const MODELS = [
  { id: 'openrouter/free', name: 'Free Models Router', context_length: 200000, pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
  { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' }, architecture: { output_modalities: ['text'] } },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { output_modalities: ['text'] } },
  { id: 'black-forest-labs/flux', name: 'FLUX image', context_length: 0, pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } }
]

async function body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

export async function startUpstream(): Promise<FakeUpstream> {
  const state: FakeUpstream = { url: '', calls: [], mode: 'ok', close: async () => {} }
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const b = await body(req)
    const path = (req.url || '').replace(/^\/api\/v1/, '')
    state.calls.push({ path, method: req.method || '', authorization: req.headers.authorization, body: b })
    const auth = req.headers.authorization
    const authorized = auth === `Bearer ${SERVER_KEY}` || auth === `Bearer ${VALID_BYOK}`
    if (path === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: MODELS }))
    }
    if (path === '/key') {
      if (!authorized) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { code: 401, message: 'User not found.' } }))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: { label: 'sk-or-v1-abc...xyz', usage: 0 } }))
    }
    if (path === '/chat/completions') {
      if (state.mode === 'hang') return // never respond
      if (state.mode === 'auth_error' || !authorized) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { code: 401, message: 'No auth credentials found' } }))
      }
      if (state.mode === 'rate_limited') {
        res.writeHead(429, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { code: 429, message: 'rate limited' } }))
      }
      const model = b?.model === 'openrouter/free' ? 'meta-llama/llama-3.3-70b-instruct:free' : String(b?.model)
      if (b?.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(': OPENROUTER PROCESSING\n\n')
        res.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: 'Hello' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: ' world' } }] })}\n\n`)
        if (state.mode === 'mid_stream_error') {
          res.write(`data: ${JSON.stringify({ error: { code: 502, message: 'provider crashed' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] })}\n\n`)
          return res.end()
        }
        res.write(`data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 2 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ model, choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 2 } }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
  state.close = () => new Promise<void>((r) => server.close(() => r()))
  return state
}

export interface TestGateway {
  url: string
  config: GatewayConfig
  store: GatewayStore
  gateway: Gateway
  logs: string[]
  close(): Promise<void>
}

export async function startGateway(upstream: FakeUpstream, env: Record<string, string> = {}, mutate?: (c: GatewayConfig) => void): Promise<TestGateway> {
  const config = loadConfig({
    NODE_ENV: 'test',
    OPENROUTER_API_KEY: SERVER_KEY,
    AI_ENCRYPTION_KEY: ENC_KEY_HEX,
    OPENROUTER_BASE_URL: upstream.url,
    AI_DB_PATH: ':memory:',
    AI_IP_REQUESTS_PER_MINUTE: '10000',
    AI_DEVICE_REQUESTS_PER_MINUTE: '10000',
    AI_DEVICE_REGISTRATIONS_PER_IP_PER_HOUR: '10000',
    AI_FREE_REQUESTS_PER_MINUTE: '1000',
    AI_FREE_REQUESTS_PER_DAY: '1000',
    AI_PROVIDER_TIMEOUT_MS: '1000',
    ...env
  })
  mutate?.(config)
  const logs: string[] = []
  const store = new GatewayStore(':memory:')
  const provider = new OpenRouterAdapter({ baseUrl: config.openrouterBaseUrl, timeoutMs: config.providerTimeoutMs, referer: config.publicReferer, title: config.appTitle, idleTimeoutMs: 1000 })
  const gateway = createGateway({ config, store, provider, log: createLogger({ level: 'debug', sink: (l) => logs.push(l) }) })
  const server = createServer(gateway.handle)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    config,
    store,
    gateway,
    logs,
    close: () =>
      new Promise<void>((r) => {
        gateway.dispose()
        server.closeAllConnections?.()
        server.close(() => {
          store.close()
          r()
        })
      })
  }
}

export async function register(gw: TestGateway): Promise<string> {
  const res = await fetch(`${gw.url}/api/auth/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'darwin', appVersion: '0.1.0' }) })
  if (res.status !== 201) throw new Error(`register failed ${res.status}`)
  return ((await res.json()) as { token: string }).token
}

export function call(gw: TestGateway, path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['content-type'] = headers['content-type'] || 'application/json'
  return fetch(`${gw.url}${path}`, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) })
}

export const userMsg = (content = 'Hi') => ({ role: 'user', content })

export function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .map((block) => {
      const ev = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return ev && data ? { event: ev, data: JSON.parse(data) } : null
    })
    .filter(Boolean) as { event: string; data: Record<string, unknown> }[]
}
