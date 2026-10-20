import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VpnService, type SecretStore } from '../../src/main/services/vpn'
import { VpnAdapterError, type TunnelSpec, type VpnPlatformAdapter } from '../../src/main/services/vpn-platform'
import { Persistence } from '../../src/main/services/persistence'
import type { PlatformAdapter } from '../../src/platform/types'
import type { VpnCapability, VpnHealth } from '../../src/shared/vpn'

const VALID_KEY = 'A'.repeat(42) + 'A='
const VALID_KEY2 = 'B'.repeat(42) + 'E='
const CONFIG = `[Interface]
PrivateKey = ${VALID_KEY}
Address = 10.0.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${VALID_KEY2}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`

class MemSecure implements SecretStore {
  m = new Map<string, string>()
  isAvailable = true
  available() {
    return this.isAvailable
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

class FakeAdapter implements VpnPlatformAdapter {
  readonly kind = 'linux' as const
  capability: VpnCapability = 'available'
  handshake: number | null = 1
  interfaceUp = true
  failUpCode: string | null = null
  upGate: Promise<void> | null = null
  upCalls = 0
  downCalls = 0
  async detectCapability(): Promise<VpnCapability> {
    return this.capability
  }
  async up(_spec: TunnelSpec): Promise<void> {
    this.upCalls++
    if (this.upGate) await this.upGate
    if (this.failUpCode) throw new VpnAdapterError(this.failUpCode)
  }
  async down(): Promise<void> {
    this.downCalls++
  }
  async probeHealth(): Promise<Partial<VpnHealth>> {
    return { interfaceUp: this.interfaceUp, handshakeAgeSec: this.handshake, rxBytes: 1000, txBytes: 500, endpoint: '1.2.3.4:51820' }
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
function makeService(adapter: FakeAdapter, secure = new MemSecure(), persist = new Persistence(fakePlatform())) {
  const svc = new VpnService(persist, secure, () => {}, {
    adapter,
    platformKind: 'linux',
    healthPollMs: 0,
    handshakeTimeoutMs: 200,
    handshakePollMs: 10,
    autoDetect: false
  })
  services.push(svc)
  return svc
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexa-vpn-'))
  services = []
  mkdirSync(join(root, 'downloads'), { recursive: true })
})
afterEach(() => {
  for (const s of services) s.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('VpnService — configuration', () => {
  it('is not_configured with no servers', async () => {
    const a = new FakeAdapter()
    const svc = makeService(a)
    await svc.detectCapability()
    expect(svc.getStatus('alpha').state).toBe('not_configured')
  })

  it('reports NOT CONFIGURED capability when WireGuard is missing', async () => {
    const a = new FakeAdapter()
    a.capability = 'unavailable'
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    // capability unavailable keeps the whole feature not_configured
    expect(svc.getStatus('alpha').state).toBe('not_configured')
    await expect(svc.connect('alpha')).rejects.toThrow('wg_unavailable')
  })

  it('imports a valid config, stores secrets securely, exposes no private key', async () => {
    const a = new FakeAdapter()
    const secure = new MemSecure()
    const svc = makeService(a, secure)
    await svc.detectCapability()
    const server = svc.importConfig('alpha', 'Tokyo', CONFIG)
    expect(server.publicKey).toBe(VALID_KEY2)
    // private key is in secure storage, NOT in the returned record or status
    expect(JSON.stringify(server)).not.toContain(VALID_KEY)
    expect(JSON.stringify(svc.getStatus('alpha'))).not.toContain(VALID_KEY)
    expect(secure.get(`vpn:alpha:${server.id}:priv`)).toBe(VALID_KEY)
    expect(svc.getStatus('alpha').state).toBe('off')
  })

  it('rejects an invalid config', async () => {
    const svc = makeService(new FakeAdapter())
    await svc.detectCapability()
    expect(() => svc.importConfig('alpha', 'Bad', 'not a config')).toThrow()
  })

  it('refuses to import when secure storage is unavailable (no plaintext keys)', async () => {
    const secure = new MemSecure()
    secure.isAvailable = false
    const svc = makeService(new FakeAdapter(), secure)
    await svc.detectCapability()
    expect(() => svc.importConfig('alpha', 'Tokyo', CONFIG)).toThrow('secure_storage_unavailable')
  })
})

describe('VpnService — lifecycle', () => {
  it('connect without a config returns a safe error', async () => {
    const svc = makeService(new FakeAdapter())
    await svc.detectCapability()
    await expect(svc.connect('alpha')).rejects.toThrow('no_config')
  })

  it('connects to PROTECTED only after health verification', async () => {
    const a = new FakeAdapter()
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    const status = await svc.connect('alpha')
    expect(status.state).toBe('protected')
    expect(status.connectedSince).toBeTruthy()
    expect(status.health?.interfaceUp).toBe(true)
    expect(a.upCalls).toBe(1)
    // honest: public IP + DNS verification not performed
    expect(status.health?.publicIpVerified).toBe('unknown')
    expect(status.dnsProtection.verified).toBe(false)
  })

  it('goes to ERROR and tears down when the handshake never happens', async () => {
    const a = new FakeAdapter()
    a.handshake = null // no handshake evidence -> timeout
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    const status = await svc.connect('alpha')
    expect(status.state).toBe('error')
    expect(status.lastError).toMatch(/did not respond|could not be verified/)
    expect(a.downCalls).toBeGreaterThanOrEqual(1) // teardown attempted, no orphan
  })

  it('disconnects back to OFF', async () => {
    const a = new FakeAdapter()
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    await svc.connect('alpha')
    const status = await svc.disconnect('alpha')
    expect(status.state).toBe('off')
    expect(status.connectedSince).toBeNull()
    expect(a.downCalls).toBeGreaterThanOrEqual(1)
  })

  it('reconnects (error -> connecting -> protected)', async () => {
    const a = new FakeAdapter()
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    await svc.connect('alpha')
    const status = await svc.reconnect('alpha')
    expect(status.state).toBe('protected')
    expect(status.reconnectCount).toBe(1)
  })

  it('serializes operations — a concurrent connect is rejected as busy', async () => {
    const a = new FakeAdapter()
    const gate = deferred()
    a.upGate = gate.promise
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    const first = svc.connect('alpha') // hangs in up()
    await expect(svc.connect('alpha')).rejects.toThrow('busy')
    gate.resolve()
    const status = await first
    expect(status.state).toBe('protected')
  })
})

describe('VpnService — recovery, settings, isolation', () => {
  it('revalidate after network change / wake flips to error if the interface dropped', async () => {
    const a = new FakeAdapter()
    const svc = makeService(a)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    await svc.connect('alpha')
    a.interfaceUp = false
    const status = await svc.revalidate('alpha')
    expect(status.state).toBe('error')
  })

  it('persists settings; kill switch is never reported as enforced (EXPERIMENTAL)', async () => {
    const svc = makeService(new FakeAdapter())
    await svc.detectCapability()
    const status = svc.updateSettings('alpha', {
      autoConnect: 'launch',
      killSwitch: true,
      dnsProtection: true,
      ipv6: 'block',
      disconnectOnExit: true
    })
    expect(status.killSwitch.enabled).toBe(true)
    expect(status.killSwitch.enforced).toBe(false)
    expect(svc.getSettings('alpha').autoConnect).toBe('launch')
  })

  it('isolates servers, secrets and status per profile', async () => {
    const a = new FakeAdapter()
    const secure = new MemSecure()
    const svc = makeService(a, secure)
    await svc.detectCapability()
    const s = svc.importConfig('alpha', 'Tokyo', CONFIG)
    expect(svc.getServers('alpha')).toHaveLength(1)
    expect(svc.getServers('beta')).toHaveLength(0)
    expect(secure.get(`vpn:alpha:${s.id}:priv`)).toBe(VALID_KEY)
    expect(secure.get(`vpn:beta:${s.id}:priv`)).toBeNull()
  })

  it('rejects unsafe profile ids', async () => {
    const svc = makeService(new FakeAdapter())
    expect(() => svc.getStatus('../../etc')).toThrow()
  })

  it('recovers config across a restart but never restores a live tunnel', async () => {
    const persist = new Persistence(fakePlatform())
    const secure = new MemSecure()
    const a = new FakeAdapter()
    const svc = makeService(a, secure, persist)
    await svc.detectCapability()
    svc.importConfig('alpha', 'Tokyo', CONFIG)
    await svc.connect('alpha')
    expect(svc.getStatus('alpha').state).toBe('protected')

    // Simulated restart: new service, same persistence + secrets.
    const a2 = new FakeAdapter()
    const svc2 = makeService(a2, secure, new Persistence(fakePlatform()))
    await svc2.detectCapability()
    expect(svc2.getServers('alpha')).toHaveLength(1) // config persisted
    expect(svc2.getStatus('alpha').state).toBe('off') // tunnel NOT auto-restored
  })

  it('removing the active config disconnects and clears its secret', async () => {
    const a = new FakeAdapter()
    const secure = new MemSecure()
    const svc = makeService(a, secure)
    await svc.detectCapability()
    const s = svc.importConfig('alpha', 'Tokyo', CONFIG)
    await svc.connect('alpha')
    await svc.removeConfig('alpha', s.id)
    expect(svc.getServers('alpha')).toHaveLength(0)
    expect(secure.get(`vpn:alpha:${s.id}:priv`)).toBeNull()
    expect(svc.getStatus('alpha').state).toBe('not_configured')
  })
})
