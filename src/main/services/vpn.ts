import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { assertSafeProfileId } from '../../platform/types'
import type { Persistence } from './persistence'
import { readJsonSafe, writeJsonAtomic } from './fs-atomic'
import {
  friendlyVpnError,
  nextVpnState,
  normalizeVpnStore,
  parseWireGuardConfig,
  selectServer,
  serverFromConfig,
  type AutoConnectMode,
  type Ipv6Policy,
  type ParsedWgConfig,
  type VpnCapability,
  type VpnHealth,
  type VpnServer,
  type VpnState,
  type VpnStatus,
  type VpnHelperStatus,
  type VpnStore
} from '../../shared/vpn'
import { createVpnPlatformAdapter, vpnPlatformKind, VpnAdapterError, type VpnPlatformAdapter } from './vpn-platform'
import { notInstalledHelper, type HelperInfo } from '../../shared/vpn-helper'
import type { VpnHelperClient } from './vpn-helper/client'

/** Minimal secret store contract (satisfied by SecureStorage; fakeable in tests). */
export interface SecretStore {
  available(): boolean
  set(key: string, value: string): void
  get(key: string): string | null
  delete(key: string): void
}

export interface VpnEmitter {
  (event: { type: 'status'; status: VpnStatus }): void
}

interface Runtime {
  state: VpnState
  interfaceName: string | null
  connectedSince: number | null
  health: VpnHealth | null
  reconnectCount: number
  lastError: string | null
  healthTimer: ReturnType<typeof setInterval> | null
  busy: boolean
}

export interface VpnServiceOptions {
  adapter?: VpnPlatformAdapter
  /** Privileged helper client; used to report helper availability in status. */
  helper?: VpnHelperClient
  platformKind?: 'macos' | 'windows' | 'linux'
  healthPollMs?: number
  handshakeTimeoutMs?: number
  handshakePollMs?: number
  autoDetect?: boolean
}

const HANDSHAKE_STALE_SEC = 180

export class VpnService {
  private adapter: VpnPlatformAdapter
  private helper: VpnHelperClient | null
  private helperInfo: HelperInfo = notInstalledHelper()
  private platform: 'macos' | 'windows' | 'linux'
  private capability: VpnCapability = 'unknown'
  private stores = new Map<string, VpnStore>()
  private runtimes = new Map<string, Runtime>()
  private healthPollMs: number
  private handshakeTimeoutMs: number
  private handshakePollMs: number

  constructor(
    private persist: Persistence,
    private secure: SecretStore,
    private emit: VpnEmitter,
    opts: VpnServiceOptions = {}
  ) {
    this.adapter = opts.adapter || createVpnPlatformAdapter()
    this.helper = opts.helper || null
    this.platform = opts.platformKind || vpnPlatformKind()
    this.healthPollMs = opts.healthPollMs ?? 5000
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 8000
    this.handshakePollMs = opts.handshakePollMs ?? 500
    if (opts.autoDetect !== false) void this.detectCapability()
  }

  async detectCapability(): Promise<VpnCapability> {
    if (this.helper) {
      try {
        this.helperInfo = await this.helper.detect()
      } catch {
        this.helperInfo = notInstalledHelper()
      }
    }
    try {
      this.capability = await this.adapter.detectCapability()
    } catch {
      this.capability = 'unavailable'
    }
    // Re-derive resting state for any known profiles.
    for (const id of this.runtimes.keys()) this.settleRestingState(id)
    return this.capability
  }

  /* -------------------- persistence -------------------- */

  private path(profileId: string) {
    const dir = this.persist.profileDir(assertSafeProfileId(profileId))
    mkdirSync(dir, { recursive: true })
    return join(dir, 'vpn.json')
  }

  private store(profileId: string): VpnStore {
    let s = this.stores.get(profileId)
    if (s) return s
    s = normalizeVpnStore(readJsonSafe<unknown>(this.path(profileId), null))
    this.stores.set(profileId, s)
    return s
  }

  private persistStore(profileId: string) {
    writeJsonAtomic(this.path(profileId), this.store(profileId))
  }

  private runtime(profileId: string): Runtime {
    let r = this.runtimes.get(profileId)
    if (r) return r
    r = {
      state: 'not_configured',
      interfaceName: null,
      connectedSince: null,
      health: null,
      reconnectCount: 0,
      lastError: null,
      healthTimer: null,
      busy: false
    }
    this.runtimes.set(profileId, r)
    this.settleRestingStateFor(profileId, r)
    return r
  }

  /* -------------------- secrets -------------------- */

  private secretKey(profileId: string, serverId: string, kind: 'priv' | 'psk') {
    return `vpn:${profileId}:${serverId}:${kind}`
  }

  private loadFullConfig(profileId: string, server: VpnServer): ParsedWgConfig {
    const privateKey = this.secure.get(this.secretKey(profileId, server.id, 'priv'))
    if (!privateKey) throw new VpnAdapterError('invalid_config')
    const presharedKey = server.hasPresharedKey ? this.secure.get(this.secretKey(profileId, server.id, 'psk')) || undefined : undefined
    return {
      privateKey,
      presharedKey,
      address: server.address,
      dns: server.dns,
      mtu: server.mtu,
      peerPublicKey: server.publicKey,
      endpoint: server.endpoint,
      allowedIPs: server.allowedIPs,
      persistentKeepalive: server.persistentKeepalive
    }
  }

  /* -------------------- state helpers -------------------- */

  private settleRestingState(profileId: string) {
    this.settleRestingStateFor(profileId, this.runtime(profileId))
  }

  private settleRestingStateFor(profileId: string, rt: Runtime) {
    // Only adjust resting states; never touch active connecting/protected/disconnecting.
    if (rt.state === 'connecting' || rt.state === 'protected' || rt.state === 'disconnecting') return
    const store = this.store(profileId)
    const configured = this.capability === 'available' && store.servers.length > 0
    rt.state = configured ? (rt.state === 'error' ? 'error' : 'off') : 'not_configured'
  }

  private ifaceName(profileId: string): string {
    const short = profileId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'p'
    return `nexa${short}`
  }

  private buildStatus(profileId: string): VpnStatus {
    const rt = this.runtime(profileId)
    const store = this.store(profileId)
    const server = selectServer(store.servers, store.settings.selectedServerId)
    return {
      profileId,
      state: rt.state,
      capability: this.capability,
      platform: this.platform,
      selectedServerId: store.settings.selectedServerId,
      serverName: server?.name ?? null,
      connectedSince: rt.connectedSince,
      health: rt.health,
      // Kill switch enforcement is not verified in P4 -> enforced:false (EXPERIMENTAL).
      killSwitch: { enabled: store.settings.killSwitch, enforced: false },
      dnsProtection: { enabled: store.settings.dnsProtection, verified: rt.health?.dnsVerified === 'verified' },
      ipv6: store.settings.ipv6,
      autoConnect: store.settings.autoConnect,
      lastError: rt.lastError,
      reconnectCount: rt.reconnectCount,
      helper: this.helperStatus()
    }
  }

  private helperStatus(): VpnHelperStatus {
    return {
      installed: this.helperInfo.installed,
      authorized: this.helperInfo.authorized,
      version: this.helperInfo.version,
      state: this.helperInfo.state
    }
  }

  private emitStatus(profileId: string) {
    this.emit({ type: 'status', status: this.buildStatus(profileId) })
  }

  private transition(profileId: string, event: Parameters<typeof nextVpnState>[1]): boolean {
    const rt = this.runtime(profileId)
    const to = nextVpnState(rt.state, event)
    if (!to) return false
    rt.state = to
    return true
  }

  /* -------------------- lifecycle -------------------- */

  async connect(profileId: string): Promise<VpnStatus> {
    assertSafeProfileId(profileId)
    if (this.capability === 'unknown') await this.detectCapability()
    if (this.capability !== 'available') throw new VpnAdapterError('wg_unavailable')

    const store = this.store(profileId)
    const server = selectServer(store.servers, store.settings.selectedServerId)
    if (!server) throw new VpnAdapterError(store.servers.length === 0 ? 'no_config' : 'no_server')

    const rt = this.runtime(profileId)
    if (rt.busy) throw new VpnAdapterError('busy')
    if (!this.transition(profileId, 'connect')) throw new VpnAdapterError('busy')
    rt.busy = true
    rt.lastError = null
    this.emitStatus(profileId)

    const iface = this.ifaceName(profileId)
    rt.interfaceName = iface
    try {
      const cfg = this.loadFullConfig(profileId, server)
      await this.adapter.up({
        interfaceName: iface,
        config: cfg,
        killSwitch: store.settings.killSwitch,
        dnsProtection: store.settings.dnsProtection,
        ipv6: store.settings.ipv6
      })
      const health = await this.verifyHealth(iface, store.settings)
      if (!this.transition(profileId, 'established')) throw new VpnAdapterError('interface_failed')
      rt.connectedSince = Date.now()
      rt.health = health
      rt.busy = false
      this.startHealthPolling(profileId)
      this.emitStatus(profileId)
      return this.buildStatus(profileId)
    } catch (err) {
      rt.busy = false
      const code = err instanceof VpnAdapterError ? err.code : 'interface_failed'
      // Best-effort teardown so we never leave an orphan interface.
      try {
        await this.adapter.down(iface)
      } catch {
        /* ignore */
      }
      this.transition(profileId, 'fail')
      rt.state = 'error'
      rt.connectedSince = null
      rt.health = null
      rt.lastError = friendlyVpnError(code)
      this.emitStatus(profileId)
      return this.buildStatus(profileId)
    }
  }

  private async verifyHealth(iface: string, settings: VpnStore['settings']): Promise<VpnHealth> {
    const deadline = Date.now() + this.handshakeTimeoutMs
    let last: Partial<VpnHealth> = {}
    // Poll for real handshake evidence before declaring PROTECTED.
     
    while (true) {
      last = await this.adapter.probeHealth(iface)
      if (last.interfaceUp && last.handshakeAgeSec !== null && last.handshakeAgeSec !== undefined) break
      if (Date.now() >= deadline) throw new VpnAdapterError('handshake_timeout')
      await new Promise((r) => setTimeout(r, this.handshakePollMs))
    }
    return {
      handshakeAgeSec: last.handshakeAgeSec ?? null,
      rxBytes: last.rxBytes ?? null,
      txBytes: last.txBytes ?? null,
      latencyMs: last.latencyMs ?? null,
      endpoint: last.endpoint ?? null,
      interfaceUp: true,
      // Public IP + DNS verification require external checks not performed in P4.
      publicIpVerified: 'unknown',
      dnsVerified: settings.dnsProtection ? 'unknown' : 'unverified'
    }
  }

  async disconnect(profileId: string): Promise<VpnStatus> {
    assertSafeProfileId(profileId)
    const rt = this.runtime(profileId)
    if (rt.state === 'off' || rt.state === 'not_configured') return this.buildStatus(profileId)
    if (rt.busy && rt.state === 'disconnecting') throw new VpnAdapterError('busy')
    this.stopHealthPolling(profileId)
    rt.busy = true
    this.transition(profileId, 'disconnect')
    this.emitStatus(profileId)
    const iface = rt.interfaceName || this.ifaceName(profileId)
    try {
      await this.adapter.down(iface)
      rt.state = 'disconnecting'
      this.transition(profileId, 'settled_off')
      rt.connectedSince = null
      rt.health = null
      rt.interfaceName = null
      rt.lastError = null
      rt.busy = false
      this.settleRestingState(profileId)
      this.emitStatus(profileId)
      return this.buildStatus(profileId)
    } catch (err) {
      rt.busy = false
      const code = err instanceof VpnAdapterError ? err.code : 'teardown_failed'
      rt.state = 'error'
      rt.lastError = friendlyVpnError(code)
      this.emitStatus(profileId)
      return this.buildStatus(profileId)
    }
  }

  async reconnect(profileId: string): Promise<VpnStatus> {
    assertSafeProfileId(profileId)
    const rt = this.runtime(profileId)
    if (rt.busy) throw new VpnAdapterError('busy')
    rt.reconnectCount++
    if (rt.state === 'protected' || rt.state === 'error' || rt.state === 'connecting') {
      await this.disconnect(profileId).catch(() => undefined)
    }
    return this.connect(profileId)
  }

  /* -------------------- health polling / recovery -------------------- */

  private startHealthPolling(profileId: string) {
    const rt = this.runtime(profileId)
    this.stopHealthPolling(profileId)
    if (this.healthPollMs <= 0) return
    rt.healthTimer = setInterval(() => void this.pollHealth(profileId), this.healthPollMs)
  }

  private stopHealthPolling(profileId: string) {
    const rt = this.runtime(profileId)
    if (rt.healthTimer) {
      clearInterval(rt.healthTimer)
      rt.healthTimer = null
    }
  }

  /** One health probe cycle (also callable via getStatistics). */
  async pollHealth(profileId: string): Promise<VpnStatus> {
    const rt = this.runtime(profileId)
    if (rt.state !== 'protected' || !rt.interfaceName) return this.buildStatus(profileId)
    try {
      const h = await this.adapter.probeHealth(rt.interfaceName)
      const stale = h.handshakeAgeSec !== null && h.handshakeAgeSec !== undefined && h.handshakeAgeSec > HANDSHAKE_STALE_SEC
      if (h.interfaceUp === false || stale) {
        rt.state = 'error'
        rt.lastError = friendlyVpnError('handshake_timeout')
        rt.health = { ...(rt.health as VpnHealth), interfaceUp: !!h.interfaceUp }
        this.stopHealthPolling(profileId)
        this.emitStatus(profileId)
        return this.buildStatus(profileId)
      }
      rt.health = {
        handshakeAgeSec: h.handshakeAgeSec ?? rt.health?.handshakeAgeSec ?? null,
        rxBytes: h.rxBytes ?? rt.health?.rxBytes ?? null,
        txBytes: h.txBytes ?? rt.health?.txBytes ?? null,
        latencyMs: h.latencyMs ?? rt.health?.latencyMs ?? null,
        endpoint: h.endpoint ?? rt.health?.endpoint ?? null,
        interfaceUp: true,
        publicIpVerified: rt.health?.publicIpVerified ?? 'unknown',
        dnsVerified: rt.health?.dnsVerified ?? 'unknown'
      }
      this.emitStatus(profileId)
    } catch {
      // A failed probe alone does not flip to error; the next tick re-checks.
    }
    return this.buildStatus(profileId)
  }

  /** Re-validate after sleep/wake or network change. */
  async revalidate(profileId: string): Promise<VpnStatus> {
    const rt = this.runtime(profileId)
    if (rt.state !== 'protected') return this.buildStatus(profileId)
    return this.pollHealth(profileId)
  }

  /* -------------------- configuration -------------------- */

  importConfig(profileId: string, name: string, configText: string): VpnServer {
    assertSafeProfileId(profileId)
    if (!this.secure.available()) throw new VpnAdapterError('secure_storage_unavailable')
    const cfg = parseWireGuardConfig(configText) // throws WgParseError on invalid input
    const id = randomUUID()
    // Secrets go to OS-backed secure storage ONLY — never persisted in vpn.json.
    this.secure.set(this.secretKey(profileId, id, 'priv'), cfg.privateKey)
    if (cfg.presharedKey) this.secure.set(this.secretKey(profileId, id, 'psk'), cfg.presharedKey)
    const server = serverFromConfig(id, name, cfg)
    const store = this.store(profileId)
    store.servers.push(server)
    if (!store.settings.selectedServerId) store.settings.selectedServerId = id
    this.persistStore(profileId)
    this.settleRestingState(profileId)
    this.emitStatus(profileId)
    return server
  }

  async removeConfig(profileId: string, serverId: string): Promise<VpnStatus> {
    assertSafeProfileId(profileId)
    const store = this.store(profileId)
    const idx = store.servers.findIndex((s) => s.id === serverId)
    if (idx < 0) throw new VpnAdapterError('not_found')
    // If this server is the active tunnel, tear it down first.
    const rt = this.runtime(profileId)
    if (rt.state === 'protected' && store.settings.selectedServerId === serverId) {
      await this.disconnect(profileId).catch(() => undefined)
    }
    this.secure.delete(this.secretKey(profileId, serverId, 'priv'))
    this.secure.delete(this.secretKey(profileId, serverId, 'psk'))
    store.servers.splice(idx, 1)
    if (store.settings.selectedServerId === serverId) {
      store.settings.selectedServerId = store.servers[0]?.id ?? null
    }
    this.persistStore(profileId)
    this.settleRestingState(profileId)
    this.emitStatus(profileId)
    return this.buildStatus(profileId)
  }

  selectServerById(profileId: string, serverId: string): VpnStatus {
    assertSafeProfileId(profileId)
    const store = this.store(profileId)
    if (!store.servers.some((s) => s.id === serverId)) throw new VpnAdapterError('not_found')
    store.settings.selectedServerId = serverId
    this.persistStore(profileId)
    this.emitStatus(profileId)
    return this.buildStatus(profileId)
  }

  getServers(profileId: string): VpnServer[] {
    assertSafeProfileId(profileId)
    return this.store(profileId).servers.map((s) => ({ ...s }))
  }

  getSettings(profileId: string) {
    assertSafeProfileId(profileId)
    return { ...this.store(profileId).settings }
  }

  updateSettings(
    profileId: string,
    patch: { autoConnect: AutoConnectMode; killSwitch: boolean; dnsProtection: boolean; ipv6: Ipv6Policy; disconnectOnExit: boolean }
  ): VpnStatus {
    assertSafeProfileId(profileId)
    const store = this.store(profileId)
    store.settings = { ...store.settings, ...patch }
    this.persistStore(profileId)
    this.emitStatus(profileId)
    return this.buildStatus(profileId)
  }

  getStatus(profileId: string): VpnStatus {
    assertSafeProfileId(profileId)
    this.runtime(profileId) // ensure initialized + resting state settled
    return this.buildStatus(profileId)
  }

  async getStatistics(profileId: string): Promise<VpnStatus> {
    assertSafeProfileId(profileId)
    return this.pollHealth(profileId)
  }

  /* -------------------- shutdown -------------------- */

  /** Disconnect any active tunnels that requested disconnect-on-exit. */
  async shutdown(): Promise<void> {
    for (const [profileId, rt] of this.runtimes) {
      this.stopHealthPolling(profileId)
      if (rt.state === 'protected' || rt.state === 'connecting') {
        const store = this.stores.get(profileId)
        if (store?.settings.disconnectOnExit) {
          try {
            await this.adapter.down(rt.interfaceName || this.ifaceName(profileId))
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  dispose() {
    for (const id of this.runtimes.keys()) this.stopHealthPolling(id)
  }
}
