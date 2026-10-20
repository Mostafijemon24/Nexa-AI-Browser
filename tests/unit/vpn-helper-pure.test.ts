import { describe, expect, it } from 'vitest'
import {
  HELPER_OPS,
  HELPER_PROTOCOL_VERSION,
  HelperRequestError,
  helperErrorMessage,
  isHelperOp,
  isValidInterfaceName,
  redactHelperRequest,
  validateHelperRequest,
  type HelperRequest
} from '../../src/shared/vpn-helper'
import { decodeMessages, encodeMessage } from '../../src/main/services/vpn-helper/protocol'

const KEY = 'A'.repeat(42) + 'A='
const KEY2 = 'B'.repeat(42) + 'E='

function upRequest(overrides: Record<string, unknown> = {}): unknown {
  return {
    protocol: HELPER_PROTOCOL_VERSION,
    requestId: 'r1',
    op: 'bringTunnelUp',
    payload: {
      interfaceName: 'nexaalpha',
      config: {
        privateKey: KEY,
        address: ['10.0.0.2/32'],
        dns: ['1.1.1.1'],
        peerPublicKey: KEY2,
        endpoint: 'vpn.example.com:51820',
        allowedIPs: ['0.0.0.0/0'],
        ipv6: 'block',
        ...overrides
      }
    }
  }
}

describe('vpn-helper — operation allowlist', () => {
  it('exposes only the narrow VPN operations', () => {
    expect([...HELPER_OPS].sort()).toEqual(
      ['bringTunnelDown', 'bringTunnelUp', 'disableKillSwitch', 'enableKillSwitch', 'probeWireGuard', 'queryHandshakeState'].sort()
    )
  })
  it('has no generic exec/shell/run operation', () => {
    for (const bad of ['exec', 'shell', 'run', 'sudo', 'runAdmin', 'system']) {
      expect(isHelperOp(bad)).toBe(false)
    }
  })
})

describe('vpn-helper — interface name allowlist', () => {
  it('accepts NEXA-owned names', () => {
    expect(isValidInterfaceName('nexaalpha')).toBe(true)
    expect(isValidInterfaceName('nexa0')).toBe(true)
  })
  it('rejects arbitrary / injection / traversal names', () => {
    for (const bad of ['eth0', 'wg0', 'nexa', 'nexa;rm -rf', 'nexa/../x', '../nexa', 'nexa$(id)', 'NEXAalpha', 'nexaaaaaaaaaaaaaa']) {
      expect(isValidInterfaceName(bad)).toBe(false)
    }
  })
})

describe('vpn-helper — request validation', () => {
  it('accepts a well-formed bringTunnelUp request', () => {
    const { op, requestId } = validateHelperRequest(upRequest())
    expect(op).toBe('bringTunnelUp')
    expect(requestId).toBe('r1')
  })

  it('rejects an unknown operation', () => {
    expect(() => validateHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'x', op: 'exec', payload: {} })).toThrowError(
      /VPN_UNKNOWN_OPERATION/
    )
  })

  it('rejects a protocol-version mismatch', () => {
    expect(() => validateHelperRequest({ protocol: 999, requestId: 'x', op: 'probeWireGuard', payload: {} })).toThrowError(
      /VPN_HELPER_VERSION_MISMATCH/
    )
  })

  it('rejects oversized requests', () => {
    expect(() => validateHelperRequest(upRequest(), 1_000_000)).toThrowError(/VPN_INVALID_REQUEST/)
  })

  it('rejects a bad interface name before any privileged action', () => {
    const req = upRequest()
    ;(req as { payload: { interfaceName: string } }).payload.interfaceName = 'eth0'
    expect(() => validateHelperRequest(req)).toThrowError(/VPN_INVALID_CONFIG/)
  })

  it('rejects malformed CIDR / endpoint / key as invalid config', () => {
    expect(() => validateHelperRequest(upRequest({ allowedIPs: ['not-a-cidr'] }))).toThrowError(/VPN_INVALID_CONFIG/)
    expect(() => validateHelperRequest(upRequest({ endpoint: 'no-port' }))).toThrowError(/VPN_INVALID_CONFIG/)
    expect(() => validateHelperRequest(upRequest({ privateKey: 'short' }))).toThrowError(/VPN_INVALID_CONFIG/)
  })

  it('rejects unexpected extra payload fields (strict schema)', () => {
    expect(() => validateHelperRequest({ protocol: HELPER_PROTOCOL_VERSION, requestId: 'x', op: 'bringTunnelDown', payload: { interfaceName: 'nexaalpha', extra: 1 } })).toThrowError(
      /VPN_INVALID_REQUEST/
    )
  })

  it('throws HelperRequestError with a stable code', () => {
    try {
      validateHelperRequest({})
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HelperRequestError)
      expect((e as HelperRequestError).code).toBe('VPN_INVALID_REQUEST')
    }
  })
})

describe('vpn-helper — redaction', () => {
  it('never exposes private/preshared keys in a logged request', () => {
    const req: HelperRequest = {
      protocol: HELPER_PROTOCOL_VERSION,
      requestId: 'r1',
      op: 'bringTunnelUp',
      payload: { interfaceName: 'nexaalpha', config: { privateKey: KEY, presharedKey: KEY2, endpoint: 'h:1' } }
    }
    const red = redactHelperRequest(req)
    const json = JSON.stringify(red)
    expect(json).not.toContain(KEY)
    expect(json).not.toContain(KEY2)
    expect(json).toContain('[redacted]')
    // Original is untouched.
    expect((req.payload as { config: { privateKey: string } }).config.privateKey).toBe(KEY)
  })
})

describe('vpn-helper — error messages', () => {
  it('maps codes to safe, non-empty user messages', () => {
    expect(helperErrorMessage('VPN_HANDSHAKE_TIMEOUT')).toMatch(/did not respond/i)
    expect(helperErrorMessage('VPN_HELPER_NOT_INSTALLED')).toMatch(/helper is not installed/i)
    expect(helperErrorMessage('SOMETHING_UNKNOWN')).toMatch(/could not be completed/i)
  })
})

describe('vpn-helper — protocol framing', () => {
  it('round-trips a message', () => {
    const msg = { protocol: HELPER_PROTOCOL_VERSION, requestId: 'r1', op: 'probeWireGuard' as const, payload: {} }
    const { messages, rest } = decodeMessages(encodeMessage(msg))
    expect(rest).toBe('')
    expect(messages).toHaveLength(1)
    expect((messages[0] as { requestId: string }).requestId).toBe('r1')
  })
  it('buffers a partial trailing fragment', () => {
    const a = encodeMessage({ protocol: 1, requestId: 'a', op: 'probeWireGuard', payload: {} })
    const b = encodeMessage({ protocol: 1, requestId: 'b', op: 'probeWireGuard', payload: {} })
    const combined = a + b.slice(0, 5)
    const { messages, rest } = decodeMessages(combined)
    expect(messages).toHaveLength(1)
    expect(rest).toBe(b.slice(0, 5))
  })
  it('skips a corrupt frame without throwing', () => {
    const good = encodeMessage({ protocol: 1, requestId: 'ok', op: 'probeWireGuard', payload: {} })
    const { messages } = decodeMessages('not json\n' + good)
    expect(messages).toHaveLength(1)
    expect((messages[0] as { requestId: string }).requestId).toBe('ok')
  })
})
