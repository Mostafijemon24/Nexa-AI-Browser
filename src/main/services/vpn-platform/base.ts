import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ParsedWgConfig, Ipv6Policy, VpnCapability, VpnHealth } from '../../../shared/vpn'

export interface TunnelSpec {
  interfaceName: string
  /** main-process only; never serialized to renderer */
  config: ParsedWgConfig
  killSwitch: boolean
  dnsProtection: boolean
  ipv6: Ipv6Policy
}

export interface VpnPlatformAdapter {
  readonly kind: 'macos' | 'windows' | 'linux'
  /** Real, unprivileged probe for the presence of WireGuard tooling. */
  detectCapability(): Promise<VpnCapability>
  /** Create + configure the tunnel. Requires elevated privileges. */
  up(spec: TunnelSpec): Promise<void>
  /** Tear the tunnel down and restore network state. */
  down(interfaceName: string): Promise<void>
  /** Read live tunnel health (handshake age, transfer). */
  probeHealth(interfaceName: string): Promise<Partial<VpnHealth>>
}

/** Error carrying a stable, sanitized code (never a raw path/stderr). */
export class VpnAdapterError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

/**
 * Promisified execFile. IMPORTANT: never uses a shell — args are always an
 * array, so imported config values can never be interpreted as shell input.
 */
export function execFileP(
  cmd: string,
  args: string[],
  timeoutMs = 15_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, shell: false }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException
        if (e.code === 'ENOENT') return reject(new VpnAdapterError('wg_unavailable'))
        if (e.code === 'EACCES' || e.code === 'EPERM') return reject(new VpnAdapterError('permission_denied'))
        // Map common wg-quick permission failures surfaced via exit code.
        if (/permission denied|must be run as root|operation not permitted/i.test(stderr || '')) {
          return reject(new VpnAdapterError('permission_denied'))
        }
        return reject(new VpnAdapterError('interface_failed'))
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** Detect a command by asking it for its version (unprivileged, no shell). */
export async function commandAvailable(cmd: string, versionArg = '--version'): Promise<boolean> {
  try {
    await execFileP(cmd, [versionArg], 5000)
    return true
  } catch (e) {
    // A non-zero exit still means the binary exists; only ENOENT means missing.
    return !(e instanceof VpnAdapterError && e.code === 'wg_unavailable')
  }
}

/** Render a wg-quick config file from a parsed config (no secrets logged). */
export function buildWgQuickConfig(cfg: ParsedWgConfig, ipv6: Ipv6Policy): string {
  const lines: string[] = ['[Interface]', `PrivateKey = ${cfg.privateKey}`, `Address = ${cfg.address.join(', ')}`]
  if (cfg.dns.length) lines.push(`DNS = ${cfg.dns.join(', ')}`)
  if (cfg.mtu) lines.push(`MTU = ${cfg.mtu}`)
  lines.push('', '[Peer]', `PublicKey = ${cfg.peerPublicKey}`)
  if (cfg.presharedKey) lines.push(`PresharedKey = ${cfg.presharedKey}`)
  let allowed = cfg.allowedIPs
  if (ipv6 === 'block') allowed = allowed.filter((a) => !a.includes(':'))
  lines.push(`AllowedIPs = ${allowed.join(', ')}`)
  lines.push(`Endpoint = ${cfg.endpoint}`)
  if (cfg.persistentKeepalive !== undefined) lines.push(`PersistentKeepalive = ${cfg.persistentKeepalive}`)
  return lines.join('\n') + '\n'
}

/** Parse `wg show <iface> dump` into health fields. */
export function parseWgDump(dump: string): Partial<VpnHealth> {
  const lines = dump.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return { interfaceUp: lines.length >= 1 }
  // First peer line: pubkey psk endpoint allowed-ips latest-handshake rx tx keepalive
  const peer = lines[1].split('\t')
  const latestHandshake = Number(peer[4] || 0)
  const rx = Number(peer[5] || 0)
  const tx = Number(peer[6] || 0)
  const now = Math.floor(Date.now() / 1000)
  return {
    interfaceUp: true,
    endpoint: peer[2] && peer[2] !== '(none)' ? peer[2] : null,
    handshakeAgeSec: latestHandshake > 0 ? now - latestHandshake : null,
    rxBytes: Number.isFinite(rx) ? rx : null,
    txBytes: Number.isFinite(tx) ? tx : null
  }
}

/**
 * Shared wg-quick based adapter for macOS + Linux. Uses a per-run config file
 * written 0600 into a private temp dir; the file is removed after `up`.
 */
export abstract class WgQuickAdapter implements VpnPlatformAdapter {
  abstract readonly kind: 'macos' | 'linux'
  protected wg = 'wg'
  protected wgQuick = 'wg-quick'

  async detectCapability(): Promise<VpnCapability> {
    const [hasWg, hasQuick] = await Promise.all([commandAvailable(this.wg), commandAvailable(this.wgQuick)])
    return hasWg && hasQuick ? 'available' : 'unavailable'
  }

  private confDir() {
    const dir = join(tmpdir(), 'nexa-vpn')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  async up(spec: TunnelSpec): Promise<void> {
    const dir = this.confDir()
    const path = join(dir, `${spec.interfaceName}.conf`)
    writeFileSync(path, buildWgQuickConfig(spec.config, spec.ipv6), { mode: 0o600 })
    try {
      await execFileP(this.wgQuick, ['up', path], 20_000)
    } finally {
      // The kernel holds the config; the on-disk copy (with the private key) is
      // removed immediately so the secret does not linger on disk.
      try {
        rmSync(path, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  async down(interfaceName: string): Promise<void> {
    await execFileP(this.wgQuick, ['down', interfaceName], 20_000)
  }

  async probeHealth(interfaceName: string): Promise<Partial<VpnHealth>> {
    const { stdout } = await execFileP(this.wg, ['show', interfaceName, 'dump'], 5000)
    return parseWgDump(stdout)
  }
}
