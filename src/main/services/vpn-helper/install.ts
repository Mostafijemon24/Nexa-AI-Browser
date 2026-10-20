import { existsSync } from 'node:fs'
import { helperEndpoint, type HelperEndpoint, type HelperPlatform } from './endpoint'
import { StdioHelperClient, type VpnHelperClient } from './client'
import { SocketHelperTransport } from './transport'

/**
 * Best-effort, unprivileged detection of the installed helper endpoint. This is
 * only a fast negative signal (the socket file is absent ⇒ helper definitely
 * not installed). The authoritative check is a live `detect()` round-trip on
 * the client, which also verifies protocol/version identity.
 *
 * Privileged installation/upgrade/uninstall (SMAppService / Windows Service /
 * polkit+systemd) is a signed production step documented in
 * NEXA_P4_2_SIGNING_AND_INSTALLER.md — NOT EXECUTED in this environment.
 */
export interface HelperInstallState {
  endpoint: HelperEndpoint
  /** For unix sockets, whether the socket file currently exists. */
  endpointPresent: boolean
}

export function detectHelperInstall(platform: HelperPlatform): HelperInstallState {
  const endpoint = helperEndpoint(platform)
  // Named pipes cannot be reliably stat-ed; defer to the live connect probe.
  const endpointPresent = endpoint.kind === 'unix-socket' ? safeExists(endpoint.path) : true
  return { endpoint, endpointPresent }
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Build the PRODUCTION helper client that connects to the installed privileged
 * helper over the platform-native transport. If no helper is installed, the
 * client honestly reports `not_installed` (⇒ VPN NOT_CONFIGURED). It NEVER
 * falls back to a fake/simulated capability.
 */
export function createProductionHelperClient(platform: HelperPlatform): VpnHelperClient {
  const { endpoint } = detectHelperInstall(platform)
  return new StdioHelperClient(() => new SocketHelperTransport({ path: endpoint.path }))
}
