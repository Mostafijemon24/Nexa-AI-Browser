import type { VpnPlatformAdapter } from './base'
import { MacOSVpnAdapter } from './macos'
import { LinuxVpnAdapter } from './linux'
import { WindowsVpnAdapter } from './windows'

export type { VpnPlatformAdapter, TunnelSpec } from './base'
export { VpnAdapterError } from './base'

export function createVpnPlatformAdapter(platform: NodeJS.Platform = process.platform): VpnPlatformAdapter {
  if (platform === 'darwin') return new MacOSVpnAdapter()
  if (platform === 'win32') return new WindowsVpnAdapter()
  return new LinuxVpnAdapter()
}

export function vpnPlatformKind(platform: NodeJS.Platform = process.platform): 'macos' | 'windows' | 'linux' {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  return 'linux'
}
