import { WgQuickAdapter } from './base'

/**
 * macOS uses the userspace `wireguard-go` backend driven by `wg-quick`
 * (installed via Homebrew `wireguard-tools` or the WireGuard.app). Tunnel
 * creation requires elevated privileges; NEXA never bundles the binary.
 */
export class MacOSVpnAdapter extends WgQuickAdapter {
  readonly kind = 'macos' as const
}
