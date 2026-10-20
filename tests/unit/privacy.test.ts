import { describe, expect, it } from 'vitest'
import {
  aggregatePrivacy,
  buildFingerprint,
  classifyFingerprintSurface,
  classifyHttps,
  classifyIp,
  FINGERPRINT_SIGNAL_KEYS,
  isDiagnosableOrigin,
  isPublicIp,
  normalizeDns,
  normalizeWebrtc,
  parseLiveOrigin,
  summarizeInterfaces
} from '../../src/shared/privacy'

describe('classifyIp — public vs local, IPv4/IPv6', () => {
  it('classifies private IPv4 ranges (never public)', () => {
    for (const ip of ['10.0.0.1', '10.255.1.1', '172.16.0.1', '172.31.9.9', '192.168.1.5', '100.64.0.1']) {
      const c = classifyIp(ip)
      expect(c.family).toBe('ipv4')
      expect(c.kind).toBe('private')
      expect(c.isPublic).toBe(false)
    }
  })
  it('classifies loopback / link-local / special IPv4', () => {
    expect(classifyIp('127.0.0.1').kind).toBe('loopback')
    expect(classifyIp('169.254.10.10').kind).toBe('link-local')
    expect(classifyIp('0.0.0.0').kind).toBe('special')
    expect(classifyIp('224.0.0.1').kind).toBe('special')
  })
  it('classifies public IPv4', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('1.1.1.1')).toBe(true)
    expect(classifyIp('93.184.216.34').isPublic).toBe(true)
  })
  it('classifies IPv6 loopback / link-local / unique-local / public', () => {
    expect(classifyIp('::1').kind).toBe('loopback')
    expect(classifyIp('fe80::1').kind).toBe('link-local')
    expect(classifyIp('fd00::1').kind).toBe('unique-local')
    expect(classifyIp('fc00::1').kind).toBe('unique-local')
    const pub = classifyIp('2606:4700:4700::1111')
    expect(pub.family).toBe('ipv6')
    expect(pub.isPublic).toBe(true)
  })
  it('handles zone ids and brackets; rejects garbage', () => {
    expect(classifyIp('fe80::1%en0').kind).toBe('link-local')
    expect(classifyIp('[::1]').kind).toBe('loopback')
    expect(classifyIp('not-an-ip').family).toBe('unknown')
    expect(isPublicIp('192.168.0.1')).toBe(false)
  })
})

describe('classifyHttps — from the live URL only', () => {
  it('ACTIVE for https/wss, NONE for http/ws, UNKNOWN otherwise', () => {
    expect(classifyHttps('https://example.com')).toBe('ACTIVE')
    expect(classifyHttps('http://example.com')).toBe('NONE')
    expect(classifyHttps('about:blank')).toBe('UNKNOWN')
    expect(classifyHttps('')).toBe('UNKNOWN')
    expect(classifyHttps('file:///x')).toBe('UNKNOWN')
  })
})

describe('summarizeInterfaces — never labels private as public', () => {
  it('summarizes families, ipv6 availability and local counts', () => {
    const s = summarizeInterfaces([
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '192.168.1.20', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '2606:4700::1', family: 'IPv6', internal: false }
    ])
    expect(s.ipv4Count).toBe(2)
    expect(s.ipv6Count).toBe(2)
    expect(s.ipv6Available).toBe(true) // routable/global v6 present
    expect(s.routableIpv6Count).toBe(1)
    // 192.168.x + fe80 are local; the global v6 is not "local"
    expect(s.localCount).toBe(2)
  })
  it('no routable ipv6 when only loopback/link-local present', () => {
    const s = summarizeInterfaces([
      { address: '127.0.0.1', internal: true },
      { address: 'fe80::abcd', internal: false }
    ])
    expect(s.ipv6Available).toBe(false)
    expect(s.routableIpv6Count).toBe(0)
  })
})

describe('normalizeWebrtc — honest exposure verdict', () => {
  it('UNAVAILABLE when RTCPeerConnection is absent', () => {
    expect(normalizeWebrtc([], { available: false }).status).toBe('UNAVAILABLE')
  })
  it('NO_EXPOSURE_DETECTED for mDNS-only (.local) candidates', () => {
    const r = normalizeWebrtc([{ address: 'a1b2c3d4.local', type: 'host' }])
    expect(r.status).toBe('NO_EXPOSURE_DETECTED')
    expect(r.obfuscatedCount).toBe(1)
    expect(r.localIpExposed).toBe(false)
  })
  it('POTENTIAL_EXPOSURE when a private (local) IP surfaces', () => {
    const r = normalizeWebrtc([{ address: '192.168.1.10', type: 'host' }])
    expect(r.status).toBe('POTENTIAL_EXPOSURE')
    expect(r.localIpExposed).toBe(true)
    expect(r.ipv4Exposed).toBe(true)
  })
  it('POTENTIAL_EXPOSURE when a public IP surfaces (srflx)', () => {
    const r = normalizeWebrtc([{ address: '203.0.113.7', type: 'srflx' }])
    expect(r.status).toBe('POTENTIAL_EXPOSURE')
    expect(r.publicIpExposed).toBe(true)
  })
  it('UNKNOWN when no candidates at all', () => {
    expect(normalizeWebrtc([]).status).toBe('UNKNOWN')
  })
})

describe('normalizeDns — conservative leak verdict', () => {
  it('NOT_CONFIGURED when no servers', () => {
    expect(normalizeDns([]).status).toBe('NOT_CONFIGURED')
  })
  it('UNAVAILABLE when explicitly unavailable', () => {
    expect(normalizeDns(['1.1.1.1'], { available: false }).status).toBe('UNAVAILABLE')
  })
  it('UNKNOWN without VPN (cannot verify a leak)', () => {
    const r = normalizeDns(['8.8.8.8'])
    expect(r.status).toBe('UNKNOWN')
    expect(r.resolvers[0].kind).toBe('public')
  })
  it('NO_LEAK_DETECTED when VPN connected and resolvers are tunnel-side (non-public)', () => {
    expect(normalizeDns(['10.0.0.1'], { vpnConnected: true }).status).toBe('NO_LEAK_DETECTED')
  })
  it('POTENTIAL_LEAK when VPN connected but a public resolver is used', () => {
    expect(normalizeDns(['10.0.0.1', '8.8.8.8'], { vpnConnected: true }).status).toBe('POTENTIAL_LEAK')
  })
})

describe('fingerprint surface — deterministic thresholds', () => {
  it('maps counts to documented surface bands', () => {
    expect(classifyFingerprintSurface(0)).toBe('UNKNOWN')
    expect(classifyFingerprintSurface(3)).toBe('LOW SIGNAL SURFACE')
    expect(classifyFingerprintSurface(6)).toBe('MODERATE SIGNAL SURFACE')
    expect(classifyFingerprintSurface(12)).toBe('HIGH SIGNAL SURFACE')
  })
  it('buildFingerprint counts available signals over the fixed key set', () => {
    const fp = buildFingerprint({ userAgent: true, platform: true, timezone: true, screen: true })
    expect(fp.totalCount).toBe(FINGERPRINT_SIGNAL_KEYS.length)
    expect(fp.availableCount).toBe(4)
    expect(fp.surface).toBe('LOW SIGNAL SURFACE')
    // unknown keys are ignored; missing keys are false
    expect(fp.signals.audio).toBe(false)
  })
})

describe('aggregatePrivacy — no fake score, conservative headline', () => {
  it('STRONG only when verified positives and no concerns', () => {
    const a = aggregatePrivacy({
      https: 'ACTIVE',
      protection: { status: 'ACTIVE', blocked: 5, requests: 10 },
      vpn: { status: 'PROTECTED', handshakeVerified: true, killSwitch: 'ON' },
      dns: 'NO_LEAK_DETECTED',
      webrtc: 'NO_EXPOSURE_DETECTED'
    })
    expect(a.headline).toBe('STRONG')
    expect(a.concerns).toBe(0)
    expect(a.verified).toBeGreaterThanOrEqual(3)
  })
  it('MIXED when both verified and concerns exist', () => {
    const a = aggregatePrivacy({
      https: 'ACTIVE',
      protection: { status: 'ACTIVE', blocked: 1, requests: 3 },
      vpn: { status: 'NOT_CONFIGURED', handshakeVerified: false, killSwitch: 'NOT_CONFIGURED' },
      dns: 'UNKNOWN',
      webrtc: 'POTENTIAL_EXPOSURE'
    })
    expect(a.headline).toBe('MIXED')
    expect(a.concerns).toBeGreaterThan(0)
  })
  it('UNKNOWN when nothing verified and nothing concerning', () => {
    const a = aggregatePrivacy({
      https: 'UNKNOWN',
      protection: { status: 'UNKNOWN', blocked: 0, requests: 0 },
      vpn: { status: 'UNKNOWN', handshakeVerified: false, killSwitch: 'NOT_CONFIGURED' },
      dns: 'UNKNOWN',
      webrtc: 'UNKNOWN'
    })
    expect(a.headline).toBe('UNKNOWN')
  })
  it('ATTENTION when only concerns exist', () => {
    const a = aggregatePrivacy({
      https: 'NONE',
      protection: { status: 'NOT_CONFIGURED', blocked: 0, requests: 0 },
      vpn: { status: 'NOT_CONFIGURED', handshakeVerified: false, killSwitch: 'NOT_CONFIGURED' },
      dns: 'POTENTIAL_LEAK',
      webrtc: 'POTENTIAL_EXPOSURE'
    })
    expect(a.headline).toBe('ATTENTION')
    expect(a.verified).toBe(0)
  })
})

describe('origin authority', () => {
  it('parses http(s) origins and rejects others', () => {
    expect(parseLiveOrigin('https://a.example.com:8443/p?x=1')).toMatchObject({
      scheme: 'https',
      host: 'a.example.com',
      port: '8443'
    })
    expect(parseLiveOrigin('about:blank')).toBeNull()
    expect(parseLiveOrigin('file:///x')).toBeNull()
    expect(parseLiveOrigin('')).toBeNull()
    expect(isDiagnosableOrigin('https://example.com')).toBe(true)
    expect(isDiagnosableOrigin('chrome://settings')).toBe(false)
  })
})
