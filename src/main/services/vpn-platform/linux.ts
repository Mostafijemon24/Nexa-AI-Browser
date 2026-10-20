import { WgQuickAdapter } from './base'

/**
 * Linux uses the in-kernel WireGuard module driven by `wg-quick` (from the
 * `wireguard-tools` package). Tunnel creation requires root/CAP_NET_ADMIN.
 */
export class LinuxVpnAdapter extends WgQuickAdapter {
  readonly kind = 'linux' as const
}
