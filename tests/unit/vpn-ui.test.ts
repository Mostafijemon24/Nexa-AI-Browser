import { describe, expect, it } from 'vitest'
import { vpnUiProjection, vpnToneColor, type VpnUiInput } from '../../src/shared/vpn-ui'
import type { VpnState } from '../../src/shared/vpn'

const configured = (state: VpnState): VpnUiInput => ({ state, capability: 'available', hasServers: true })

describe('vpn-ui projection — state labels', () => {
  it('projects each state to the correct label + tone', () => {
    expect(vpnUiProjection(configured('off')).label).toBe('OFF')
    expect(vpnUiProjection(configured('connecting')).label).toBe('CONNECTING…')
    expect(vpnUiProjection(configured('protected')).label).toBe('PROTECTED')
    expect(vpnUiProjection(configured('disconnecting')).label).toBe('DISCONNECTING…')
    expect(vpnUiProjection(configured('error')).label).toBe('ERROR')
    expect(vpnUiProjection(configured('protected')).tone).toBe('ok')
    expect(vpnUiProjection(configured('connecting')).tone).toBe('warn')
    expect(vpnUiProjection(configured('error')).tone).toBe('err')
  })
})

describe('vpn-ui projection — NOT_CONFIGURED routing', () => {
  it('reports NOT CONFIGURED when the engine is unavailable', () => {
    const p = vpnUiProjection({ state: 'off', capability: 'unavailable', hasServers: true })
    expect(p.label).toBe('NOT CONFIGURED')
    expect(p.primary).toBe('configure')
    expect(p.canConnect).toBe(false)
    expect(p.commands).toEqual(['configure', 'settings'])
  })
  it('reports NOT CONFIGURED when no server is configured', () => {
    const p = vpnUiProjection({ state: 'off', capability: 'available', hasServers: false })
    expect(p.label).toBe('NOT CONFIGURED')
    expect(p.primary).toBe('configure')
    expect(p.canConnect).toBe(false)
  })
  it('reports NOT CONFIGURED for the not_configured state directly', () => {
    const p = vpnUiProjection({ state: 'not_configured', capability: 'available', hasServers: false })
    expect(p.label).toBe('NOT CONFIGURED')
    expect(p.canConnect).toBe(false)
    expect(p.canDisconnect).toBe(false)
  })
})

describe('vpn-ui projection — action guards', () => {
  it('OFF offers connect only (never disconnect)', () => {
    const p = vpnUiProjection(configured('off'))
    expect(p.primary).toBe('connect')
    expect(p.canConnect).toBe(true)
    expect(p.canDisconnect).toBe(false)
    expect(p.commands).toContain('connect')
    expect(p.commands).not.toContain('disconnect')
  })

  it('PROTECTED offers disconnect/reconnect, never connect (no duplicate connect)', () => {
    const p = vpnUiProjection(configured('protected'))
    expect(p.primary).toBe('disconnect')
    expect(p.canConnect).toBe(false)
    expect(p.canDisconnect).toBe(true)
    expect(p.canReconnect).toBe(true)
    expect(p.commands).toEqual(['disconnect', 'reconnect', 'settings'])
  })

  it('CONNECTING is busy and only allows cancel (guards duplicate connect)', () => {
    const p = vpnUiProjection(configured('connecting'))
    expect(p.busy).toBe(true)
    expect(p.primary).toBe('cancel')
    expect(p.canConnect).toBe(false)
    expect(p.canDisconnect).toBe(true)
  })

  it('DISCONNECTING is busy and exposes no connect/disconnect (guards duplicate)', () => {
    const p = vpnUiProjection(configured('disconnecting'))
    expect(p.busy).toBe(true)
    expect(p.canConnect).toBe(false)
    expect(p.canDisconnect).toBe(false)
    expect(p.primary).toBe('none')
  })

  it('ERROR offers retry', () => {
    const p = vpnUiProjection(configured('error'))
    expect(p.primary).toBe('retry')
    expect(p.canReconnect).toBe(true)
    expect(p.commands).toContain('reconnect')
  })
})

describe('vpn-ui projection — security invariants', () => {
  it('never yields a PROTECTED label unless the backend state is protected', () => {
    const states: VpnState[] = ['not_configured', 'off', 'connecting', 'disconnecting', 'error']
    for (const s of states) {
      expect(vpnUiProjection(configured(s)).label).not.toBe('PROTECTED')
    }
    expect(vpnUiProjection(configured('protected')).label).toBe('PROTECTED')
  })
  it('never allows connect and disconnect simultaneously', () => {
    const states: VpnState[] = ['not_configured', 'off', 'connecting', 'protected', 'disconnecting', 'error']
    for (const s of states) {
      const p = vpnUiProjection(configured(s))
      expect(p.canConnect && p.canDisconnect).toBe(false)
    }
  })
})

describe('vpn-ui tone color', () => {
  it('maps tones to design tokens', () => {
    expect(vpnToneColor('ok')).toBe('var(--success)')
    expect(vpnToneColor('warn')).toBe('var(--warning)')
    expect(vpnToneColor('err')).toBe('var(--error)')
    expect(vpnToneColor('idle')).toBe('var(--text-3)')
  })
})
