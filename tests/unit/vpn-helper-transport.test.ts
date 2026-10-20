import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { HELPER_PROTOCOL_VERSION } from '../../src/shared/vpn-helper'
import { StdioHelperClient } from '../../src/main/services/vpn-helper/client'
import { SocketHelperTransport } from '../../src/main/services/vpn-helper/transport'
import { decodeMessages, encodeMessage } from '../../src/main/services/vpn-helper/protocol'
import { handleHelperRequest, type CommandResult, type CommandRunner, type HelperDeps, type TempConfig } from '../../src/main/services/vpn-helper/handler'

function endpointPath(): string {
  const id = randomUUID().slice(0, 8)
  return process.platform === 'win32' ? `\\\\.\\pipe\\nexa-test-${id}` : `/tmp/nexa-test-${id}.sock`
}

class FakeRunner implements CommandRunner {
  async run(_cmd: string, args: string[]): Promise<CommandResult> {
    if (args[0] === '--version') return { code: 0, stdout: 'wireguard-tools v1.0.0', stderr: '' }
    if (args[0] === 'down') return { code: 0, stdout: '', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
}
const FakeTemp: TempConfig = { write: (i) => `/tmp/${i}.conf`, cleanup: () => {} }
const deps: HelperDeps = { runner: new FakeRunner(), tempConfig: FakeTemp, paths: { wg: 'wg', wgQuick: 'wg-quick' }, platform: 'linux' }

type ReplyFn = (req: { requestId: string; op: string }) => unknown

interface ServerHandle {
  server: net.Server
  path: string
  /** Forcibly drop live client connections (simulates helper crash/restart). */
  dropConnections(): void
}

/** A real net server that frames like the production helper. */
function startServer(path: string, reply?: ReplyFn): ServerHandle {
  const conns = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    conns.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('close', () => conns.delete(socket))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const { messages, rest } = decodeMessages(buffer)
      buffer = rest
      for (const m of messages) {
        if (reply) {
          const r = reply(m as { requestId: string; op: string })
          if (r) socket.write(encodeMessage(r as never))
        } else {
          void handleHelperRequest(m, deps).then((res) => socket.write(encodeMessage(res)))
        }
      }
    })
    socket.on('error', () => socket.destroy())
  })
  server.listen(path)
  return {
    server,
    path,
    dropConnections() {
      for (const s of conns) s.destroy()
      conns.clear()
    }
  }
}

let servers: ServerHandle[] = []
let paths: string[] = []
function serve(reply?: ReplyFn): string {
  const path = endpointPath()
  paths.push(path)
  servers.push(startServer(path, reply))
  return path
}
function client(path: string, timeoutMs = 2000) {
  return new StdioHelperClient(() => new SocketHelperTransport({ path }), { defaultTimeoutMs: timeoutMs })
}

afterEach(() => {
  for (const s of servers) s.server.close()
  servers = []
  for (const p of paths) if (!p.startsWith('\\\\')) try { rmSync(p, { force: true }) } catch { /* ignore */ }
  paths = []
})

describe('production socket transport', () => {
  it('detects the helper as installed over a real socket', async () => {
    const c = client(serve())
    const info = await c.detect()
    expect(info.installed).toBe(true)
    expect(info.state).toBe('installed')
    expect(info.version).toBe(HELPER_PROTOCOL_VERSION)
    c.close()
  })

  it('performs a full request/response round-trip', async () => {
    const c = client(serve())
    const res = await c.request('bringTunnelDown', { interfaceName: 'nexaalpha' })
    expect(res).toMatchObject({ interfaceName: 'nexaalpha', down: true })
    c.close()
  })

  it('reports not installed when the endpoint does not exist', async () => {
    const c = client(endpointPath()) // no server listening
    const info = await c.detect()
    expect(info.installed).toBe(false)
    expect(info.state).toBe('not_installed')
    c.close()
  })

  it('rejects a protocol/version mismatch as an identity failure', async () => {
    const path = serve((req) => ({ protocol: 999, requestId: req.requestId, ok: true, result: {} }))
    const c = client(path)
    const info = await c.detect()
    expect(info.state).toBe('error')
    expect(info.installed).toBe(true)
    c.close()
  })

  it('times out when the helper never responds', async () => {
    const path = serve(() => undefined) // accept connection, never reply
    const c = client(path, 200)
    await expect(c.request('probeWireGuard', {})).rejects.toThrowError(/VPN_HELPER_TIMEOUT/)
    c.close()
  })

  it('reconnects after the helper socket drops (helper restart)', async () => {
    const path = endpointPath()
    paths.push(path)
    const s1 = startServer(path)
    servers.push(s1)
    const c = client(path)
    expect((await c.detect()).installed).toBe(true)
    // Simulate helper restart: forcibly drop the live connection and the server.
    s1.dropConnections()
    await new Promise<void>((r) => s1.server.close(() => r()))
    if (!path.startsWith('\\\\')) try { rmSync(path, { force: true }) } catch { /* ignore */ }
    const s2 = startServer(path)
    servers.push(s2)
    await new Promise((r) => setTimeout(r, 50))
    // A fresh request must transparently reconnect to the new helper.
    const res = await c.request('bringTunnelDown', { interfaceName: 'nexaalpha' })
    expect(res).toMatchObject({ down: true })
    c.close()
  })
})
