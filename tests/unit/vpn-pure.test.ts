import { describe, expect, it } from 'vitest'
import {
  defaultVpnSettings,
  friendlyVpnError,
  isValidCidr,
  isValidEndpoint,
  isValidWgKey,
  nextVpnState,
  normalizeVpnStore,
  parseWireGuardConfig,
  reconnectBackoffMs,
  redactWgConfig,
  selectServer,
  serverFromConfig,
  WgParseError,
  type VpnServer
} from '../../src/shared/vpn'

const VALID_KEY = 'A'.repeat(42) + 'A='
const VALID_KEY2 = 'B'.repeat(42) + 'E='

const GOOD_CONFIG = `
[Interface]
PrivateKey = ${VALID_KEY}
Address = 10.0.0.2/32, fd00::2/128
DNS = 1.1.1.1, 1.0.0.1
MTU = 1420

[Peer]
PublicKey = ${VALID_KEY2}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`

describe('state machine', () => {
  it('has no direct off -> protected edge', () => {
    expect(nextVpnState('off', 'established')).toBeNull()
    expect(nextVpnState('off', 'connect')).toBe('connecting')
    expect(nextVpnState('connecting', 'established')).toBe('protected')
  })
  it('handles fail, disconnect and settle transitions', () => {
    expect(nextVpnState('connecting', 'fail')).toBe('error')
    expect(nextVpnState('protected', 'disconnect')).toBe('disconnecting')
    expect(nextVpnState('disconnecting', 'settled_off')).toBe('off')
    expect(nextVpnState('error', 'connect')).toBe('connecting')
  })
  it('configure/reset gate the not_configured state', () => {
    expect(nextVpnState('not_configured', 'configure')).toBe('off')
    expect(nextVpnState('protected', 'reset')).toBe('not_configured')
    expect(nextVpnState('off', 'configure')).toBeNull()
  })
})

describe('validators', () => {
  it('validates WireGuard keys', () => {
    expect(isValidWgKey(VALID_KEY)).toBe(true)
    expect(isValidWgKey('short')).toBe(false)
    expect(isValidWgKey('!'.repeat(44))).toBe(false)
  })
  it('validates CIDRs (v4 + v6)', () => {
    expect(isValidCidr('10.0.0.1/32')).toBe(true)
    expect(isValidCidr('0.0.0.0/0')).toBe(true)
    expect(isValidCidr('::/0')).toBe(true)
    expect(isValidCidr('10.0.0.1/33')).toBe(false)
    expect(isValidCidr('999.1.1.1/24')).toBe(false)
  })
  it('validates endpoints', () => {
    expect(isValidEndpoint('vpn.example.com:51820')).toBe(true)
    expect(isValidEndpoint('1.2.3.4:1194')).toBe(true)
    expect(isValidEndpoint('nohost')).toBe(false)
    expect(isValidEndpoint('host:99999')).toBe(false)
  })
})

describe('config parser', () => {
  it('parses a valid config', () => {
    const cfg = parseWireGuardConfig(GOOD_CONFIG)
    expect(cfg.privateKey).toBe(VALID_KEY)
    expect(cfg.peerPublicKey).toBe(VALID_KEY2)
    expect(cfg.endpoint).toBe('vpn.example.com:51820')
    expect(cfg.address).toEqual(['10.0.0.2/32', 'fd00::2/128'])
    expect(cfg.allowedIPs).toContain('0.0.0.0/0')
    expect(cfg.dns).toEqual(['1.1.1.1', '1.0.0.1'])
    expect(cfg.mtu).toBe(1420)
    expect(cfg.persistentKeepalive).toBe(25)
  })
  it('rejects a missing [Peer]', () => {
    expect(() => parseWireGuardConfig(`[Interface]\nPrivateKey = ${VALID_KEY}\nAddress = 10.0.0.2/32`)).toThrow(WgParseError)
  })
  it('rejects an invalid private key', () => {
    expect(() => parseWireGuardConfig(GOOD_CONFIG.replace(VALID_KEY, 'nope'))).toThrow('invalid_private_key')
  })
  it('rejects an invalid endpoint', () => {
    expect(() => parseWireGuardConfig(GOOD_CONFIG.replace('vpn.example.com:51820', 'bad-endpoint'))).toThrow('invalid_endpoint')
  })
  it('rejects an invalid AllowedIPs', () => {
    expect(() => parseWireGuardConfig(GOOD_CONFIG.replace('0.0.0.0/0, ::/0', 'not-a-cidr'))).toThrow('invalid_allowed_ips')
  })
  it('rejects an out-of-range MTU', () => {
    expect(() => parseWireGuardConfig(GOOD_CONFIG.replace('MTU = 1420', 'MTU = 50'))).toThrow('invalid_mtu')
  })
  it('never executes shell content; comments are stripped', () => {
    const cfg = parseWireGuardConfig(`# danger $(rm -rf /)\n${GOOD_CONFIG}`)
    expect(cfg.privateKey).toBe(VALID_KEY)
  })
})

describe('secret redaction', () => {
  it('redacts private and preshared keys from config text', () => {
    const red = redactWgConfig(GOOD_CONFIG)
    expect(red).not.toContain(VALID_KEY)
    expect(red).toContain('PrivateKey = [redacted]')
    // public key is not secret and remains
    expect(red).toContain(VALID_KEY2)
  })
})

describe('server selection + backoff', () => {
  const mk = (id: string): VpnServer => serverFromConfig(id, id, parseWireGuardConfig(GOOD_CONFIG))
  it('selects by id, falls back to first, null when empty', () => {
    const servers = [mk('a'), mk('b')]
    expect(selectServer(servers, 'b')?.id).toBe('b')
    expect(selectServer(servers, 'missing')?.id).toBe('a')
    expect(selectServer([], 'a')).toBeNull()
  })
  it('computes capped exponential backoff', () => {
    expect(reconnectBackoffMs(0)).toBe(1000)
    expect(reconnectBackoffMs(1)).toBe(2000)
    expect(reconnectBackoffMs(3)).toBe(8000)
    expect(reconnectBackoffMs(20)).toBe(30_000)
  })
})

describe('server record + store', () => {
  it('builds a non-secret server record', () => {
    const cfg = parseWireGuardConfig(GOOD_CONFIG)
    const s = serverFromConfig('id1', 'Tokyo', cfg)
    expect(s.hasPresharedKey).toBe(false)
    expect(JSON.stringify(s)).not.toContain(VALID_KEY) // no private key leaks into the record
    expect(s.publicKey).toBe(VALID_KEY2)
  })
  it('normalizes a junk store to empty defaults', () => {
    expect(normalizeVpnStore('garbage').servers).toEqual([])
    expect(normalizeVpnStore(null).settings).toEqual(defaultVpnSettings())
  })
})

describe('error mapping', () => {
  it('maps codes to sanitized messages (no paths/stack)', () => {
    expect(friendlyVpnError('wg_unavailable')).toMatch(/WireGuard component is unavailable/)
    expect(friendlyVpnError('permission_denied')).toMatch(/permission/i)
    expect(friendlyVpnError('unknown_code')).toBe('The VPN operation could not be completed.')
    expect(friendlyVpnError('handshake_timeout')).not.toMatch(/ENOENT|\/usr|spawn/)
  })
})
