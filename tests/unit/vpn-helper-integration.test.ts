import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VpnService, type SecretStore } from '../../src/main/services/vpn'
import { Persistence } from '../../src/main/services/persistence'
import type { PlatformAdapter } from '../../src/platform/types'
import { StdioHelperClient, type HelperTransport } from '../../src/main/services/vpn-helper/client'
import { HelperVpnAdapter } from '../../src/main/services/vpn-helper/adapter'
import { decodeMessages, encodeMessage } from '../../src/main/services/vpn-helper/protocol'
import { handleHelperRequest, type CommandResult, type CommandRunner, type HelperDeps, type TempConfig } from '../../src/main/services/vpn-helper/handler'

const KEY = 'A'.repeat(42) + 'A='
const KEY2 = 'B'.repeat(42) + 'E='
const CONFIG = `[Interface]
PrivateKey = ${KEY}
Address = 10.0.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${KEY2}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`

/** Fake wg/wg-quick. Handshake presence is controlled per-test. */
class FakeRunner implements CommandRunner {
  calls: string[][] = []
  handshake = true
  failUp = false
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args)
    switch (args[0]) {
      case '--version':
        return { code: 0, stdout: 'wireguard-tools v1.0.0', stderr: '' }
      case 'up':
        return this.failUp ? { code: 1, stdout: '', stderr: 'operation failed' } : { code: 0, stdout: '', stderr: '' }
      case 'down':
        return { code: 0, stdout: '', stderr: '' }
      case 'show': {
        const hs = this.handshake ? Math.floor(Date.now() / 1000) - 5 : 0
        return { code: 0, stdout: `PRIV\tPUB\t51820\toff\nPEERPUB\t(none)\t1.2.3.4:51820\t0.0.0.0/0\t${hs}\t2048\t1024\t25`, stderr: '' }
      }
      default:
        return { code: 0, stdout: '', stderr: '' }
    }
  }
}

class FakeTempConfig implements TempConfig {
  write(interfaceName: string): string {
    return `/tmp/nexa/${interfaceName}.conf`
  }
  cleanup(): void {}
}

/** In-process transport that pipes framed lines through the real handler. */
class LoopbackTransport implements HelperTransport {
  private msgCb?: (line: string) => void
  private closeCb?: () => void
  constructor(private deps: HelperDeps) {}
  send(line: string): void {
    const { messages } = decodeMessages(line)
    for (const m of messages) void handleHelperRequest(m, this.deps).then((res) => this.msgCb?.(encodeMessage(res)))
  }
  onMessage(cb: (line: string) => void): void {
    this.msgCb = cb
  }
  onClose(cb: () => void): void {
    this.closeCb = cb
  }
  close(): void {
    this.closeCb?.()
  }
}

class MemSecure implements SecretStore {
  m = new Map<string, string>()
  available() {
    return true
  }
  set(k: string, v: string) {
    this.m.set(k, v)
  }
  get(k: string) {
    return this.m.get(k) ?? null
  }
  delete(k: string) {
    this.m.delete(k)
  }
}

let root: string
function fakePlatform(): PlatformAdapter {
  return {
    kind: 'linux',
    appDataDir: () => root,
    profileDir: (id: string) => join(root, 'profiles', id),
    downloadsDir: () => join(root, 'downloads'),
    notify: () => {},
    openPath: async () => ''
  }
}

let services: VpnService[] = []
function build(runner = new FakeRunner()) {
  const deps: HelperDeps = { runner, tempConfig: new FakeTempConfig(), paths: { wg: 'wg', wgQuick: 'wg-quick' }, platform: 'linux' }
  const client = new StdioHelperClient(() => new LoopbackTransport(deps), { defaultTimeoutMs: 2000 })
  const adapter = new HelperVpnAdapter('linux', client)
  const svc = new VpnService(new Persistence(fakePlatform()), new MemSecure(), () => {}, {
    adapter,
    helper: client,
    platformKind: 'linux',
    healthPollMs: 0,
    handshakeTimeoutMs: 300,
    handshakePollMs: 10,
    autoDetect: false
  })
  services.push(svc)
  return { svc, runner, client }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-vpnh-'))
  services = []
  mkdirSync(join(root, 'downloads'), { recursive: true })
})
afterEach(() => {
  for (const s of services) s.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('helper integration — capability + helper status', () => {
  it('reports the helper as installed and WireGuard as available through the real protocol', async () => {
    const { svc } = build()
    await svc.detectCapability()
    const status = svc.getStatus('alpha')
    expect(status.capability).toBe('available')
    expect(status.helper.state).toBe('installed')
    expect(status.helper.installed).toBe(true)
  })
})

describe('helper integration — transactional connect', () => {
  it('reaches PROTECTED only after a verified handshake', async () => {
    const { svc, runner } = build()
    svc.importConfig('alpha', 'Test', CONFIG)
    const status = await svc.connect('alpha')
    expect(status.state).toBe('protected')
    expect(status.health?.interfaceUp).toBe(true)
    expect(runner.calls.some((a) => a[0] === 'up')).toBe(true)
    expect(runner.calls.some((a) => a[0] === 'show')).toBe(true)
  })

  it('never leaks the private key into the renderer-facing status', async () => {
    const { svc } = build()
    svc.importConfig('alpha', 'Test', CONFIG)
    const status = await svc.connect('alpha')
    expect(JSON.stringify(status)).not.toContain(KEY)
  })

  it('rolls back and reports ERROR when the tunnel fails to come up', async () => {
    const runner = new FakeRunner()
    runner.failUp = true
    const { svc } = build(runner)
    svc.importConfig('alpha', 'Test', CONFIG)
    const status = await svc.connect('alpha')
    expect(status.state).toBe('error')
    // rollback: a down must have been issued after the failed up
    expect(runner.calls.filter((a) => a[0] === 'down').length).toBeGreaterThanOrEqual(1)
    expect(status.lastError).toBeTruthy()
  })

  it('reports ERROR on handshake timeout (no fake PROTECTED)', async () => {
    const runner = new FakeRunner()
    runner.handshake = false
    const { svc } = build(runner)
    svc.importConfig('alpha', 'Test', CONFIG)
    const status = await svc.connect('alpha')
    expect(status.state).toBe('error')
    expect(runner.calls.some((a) => a[0] === 'down')).toBe(true)
  })
})

describe('helper integration — disconnect / reconnect', () => {
  it('disconnect is idempotent', async () => {
    const { svc } = build()
    svc.importConfig('alpha', 'Test', CONFIG)
    await svc.connect('alpha')
    const s1 = await svc.disconnect('alpha')
    expect(s1.state).toBe('off')
    const s2 = await svc.disconnect('alpha')
    expect(s2.state).toBe('off')
  })

  it('reconnect brings the tunnel back to PROTECTED', async () => {
    const { svc } = build()
    svc.importConfig('alpha', 'Test', CONFIG)
    await svc.connect('alpha')
    const status = await svc.reconnect('alpha')
    expect(status.state).toBe('protected')
    expect(status.reconnectCount).toBeGreaterThanOrEqual(1)
  })
})

describe('helper integration — profile isolation', () => {
  it('keeps tunnels and config isolated per profile', async () => {
    const { svc } = build()
    svc.importConfig('alpha', 'A', CONFIG)
    await svc.connect('alpha')
    // beta has no config -> not_configured, unaffected by alpha
    expect(svc.getStatus('beta').state).toBe('not_configured')
    expect(svc.getServers('beta')).toHaveLength(0)
    expect(svc.getStatus('alpha').state).toBe('protected')
  })
})
