import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  VpnAdapterError,
  buildWgQuickConfig,
  commandAvailable,
  execFileP,
  parseWgDump,
  type TunnelSpec,
  type VpnPlatformAdapter
} from './base'
import type { VpnCapability, VpnHealth } from '../../../shared/vpn'

/**
 * Windows uses WireGuardNT via the `wireguard.exe` tunnel service
 * (`/installtunnelservice`). This requires Administrator privileges and a
 * system-installed WireGuard; NEXA never bundles it.
 */
export class WindowsVpnAdapter implements VpnPlatformAdapter {
  readonly kind = 'windows' as const
  private wg = 'wg.exe'
  private wireguard = 'wireguard.exe'

  async detectCapability(): Promise<VpnCapability> {
    // `wg.exe --version` is unprivileged; presence indicates WireGuard tooling.
    const has = await commandAvailable(this.wg)
    return has ? 'available' : 'unavailable'
  }

  private confDir() {
    const dir = join(tmpdir(), 'nexa-vpn')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  async up(spec: TunnelSpec): Promise<void> {
    const dir = this.confDir()
    const path = join(dir, `${spec.interfaceName}.conf`)
    writeFileSync(path, buildWgQuickConfig(spec.config, spec.ipv6), { mode: 0o600 })
    try {
      await execFileP(this.wireguard, ['/installtunnelservice', path], 20_000)
    } catch (e) {
      if (e instanceof VpnAdapterError) throw e
      throw new VpnAdapterError('interface_failed')
    } finally {
      try {
        rmSync(path, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  async down(interfaceName: string): Promise<void> {
    await execFileP(this.wireguard, ['/uninstalltunnelservice', interfaceName], 20_000)
  }

  async probeHealth(interfaceName: string): Promise<Partial<VpnHealth>> {
    const { stdout } = await execFileP(this.wg, ['show', interfaceName, 'dump'], 5000)
    return parseWgDump(stdout)
  }
}
