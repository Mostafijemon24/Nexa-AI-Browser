import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createGateway } from './app'
import { ConfigError, loadConfig } from './config'
import { GatewayStore } from './db'
import { createLogger, type LogLevel } from './log'
import { OpenRouterAdapter } from './providers/openrouter'

const log = createLogger({ level: (process.env.AI_LOG_LEVEL as LogLevel) || 'info' })

function main(): void {
  let config
  try {
    config = loadConfig()
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error('invalid gateway configuration', { reason: e.message })
      process.exit(1)
    }
    throw e
  }
  if (!config.openrouterApiKey) log.warn('OPENROUTER_API_KEY is not set — NEXA Free AI will report AI_SERVICE_UNAVAILABLE')
  if (!config.encryptionKey) log.warn('AI_ENCRYPTION_KEY is not set — Premium/BYOK connections are disabled')

  const store = new GatewayStore(config.dbPath)
  const provider = new OpenRouterAdapter({
    baseUrl: config.openrouterBaseUrl,
    timeoutMs: config.providerTimeoutMs,
    referer: config.publicReferer,
    title: config.appTitle
  })
  const gateway = createGateway({ config, store, provider, log })

  const server: Server = config.tls
    ? createHttpsServer({ cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile), minVersion: 'TLSv1.2' }, gateway.handle)
    : createHttpServer(gateway.handle)
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000

  server.listen(config.port, config.host, () => {
    log.info('NEXA AI gateway listening', { host: config.host, port: config.port, env: config.env, tls: !!config.tls, trustProxy: config.trustProxy })
  })

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    gateway.dispose()
    server.close(() => {
      store.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
