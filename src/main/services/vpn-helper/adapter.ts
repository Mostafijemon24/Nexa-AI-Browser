import type { Ipv6Policy, VpnCapability, VpnHealth } from '../../../shared/vpn'
import { HelperRequestError, type HandshakeResult, type HelperTunnelConfig, type ProbeResult } from '../../../shared/vpn-helper'
import { VpnAdapterError, type TunnelSpec, type VpnPlatformAdapter } from '../vpn-platform/base'
import type { VpnHelperClient } from './client'

/** Translate a stable helper error code into the VpnService's adapter code. */
function toAdapterCode(code: string): string {
  switch (code) {
    case 'VPN_WIREGUARD_UNAVAILABLE':
      return 'wg_unavailable'
    case 'VPN_PERMISSION_DENIED':
      return 'permission_denied'
    case 'VPN_INVALID_CONFIG':
      return 'invalid_config'
    case 'VPN_ROUTE_FAILED':
      return 'route_failed'
    case 'VPN_DNS_FAILED':
      return 'dns_failed'
    case 'VPN_HANDSHAKE_TIMEOUT':
      return 'handshake_timeout'
    case 'VPN_HELPER_NOT_INSTALLED':
    case 'VPN_HELPER_UNAVAILABLE':
    case 'VPN_HELPER_TIMEOUT':
    case 'VPN_HELPER_UNAUTHORIZED':
    case 'VPN_HELPER_VERSION_MISMATCH':
    case 'VPN_HELPER_PROTOCOL_ERROR':
      return 'wg_unavailable'
    default:
      return 'interface_failed'
  }
}

function rethrow(e: unknown): never {
  const code = e instanceof HelperRequestError ? e.code : e instanceof VpnAdapterError ? e.code : 'interface_failed'
  throw new VpnAdapterError(e instanceof HelperRequestError ? toAdapterCode(code) : code)
}

/**
 * VpnPlatformAdapter that performs every privileged step via the authenticated
 * helper channel. `up()` is transactional: on ANY failure it rolls the tunnel
 * back (bring down) before surfacing the error, so the machine is never left in
 * a half-configured state.
 */
export class HelperVpnAdapter implements VpnPlatformAdapter {
  constructor(
    public readonly kind: 'macos' | 'windows' | 'linux',
    private client: VpnHelperClient
  ) {}

  async detectCapability(): Promise<VpnCapability> {
    try {
      const probe = await this.client.request<ProbeResult>('probeWireGuard', {})
      return probe.available ? 'available' : 'unavailable'
    } catch {
      return 'unavailable'
    }
  }

  async up(spec: TunnelSpec): Promise<void> {
    const config = this.toHelperConfig(spec)
    try {
      await this.client.request('bringTunnelUp', { interfaceName: spec.interfaceName, config })
    } catch (e) {
      await this.rollback(spec.interfaceName)
      rethrow(e)
    }
    // Kill switch is best-effort + EXPERIMENTAL; it must never fail the connect.
    if (spec.killSwitch) {
      try {
        await this.client.request('enableKillSwitch', { interfaceName: spec.interfaceName })
      } catch {
        /* experimental; do not fail the transaction */
      }
    }
  }

  async down(interfaceName: string): Promise<void> {
    try {
      await this.client.request('disableKillSwitch', { interfaceName }).catch(() => undefined)
      await this.client.request('bringTunnelDown', { interfaceName })
    } catch (e) {
      const code = e instanceof HelperRequestError ? toAdapterCode(e.code) : 'teardown_failed'
      throw new VpnAdapterError(code)
    }
  }

  async probeHealth(interfaceName: string): Promise<Partial<VpnHealth>> {
    const h = await this.client.request<HandshakeResult>('queryHandshakeState', { interfaceName })
    return {
      interfaceUp: h.interfaceUp,
      handshakeAgeSec: h.handshakeAgeSec,
      rxBytes: h.rxBytes,
      txBytes: h.txBytes,
      endpoint: h.endpoint,
      latencyMs: null
    }
  }

  private async rollback(interfaceName: string): Promise<void> {
    try {
      await this.client.request('bringTunnelDown', { interfaceName })
    } catch {
      /* best-effort rollback */
    }
  }

  private toHelperConfig(spec: TunnelSpec): HelperTunnelConfig {
    const c = spec.config
    const ipv6: Ipv6Policy = spec.ipv6
    return {
      privateKey: c.privateKey,
      presharedKey: c.presharedKey,
      address: c.address,
      dns: spec.dnsProtection ? c.dns : [],
      mtu: c.mtu,
      peerPublicKey: c.peerPublicKey,
      endpoint: c.endpoint,
      allowedIPs: c.allowedIPs,
      persistentKeepalive: c.persistentKeepalive,
      ipv6
    }
  }
}
