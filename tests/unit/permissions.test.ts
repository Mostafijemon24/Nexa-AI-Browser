import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPermissionAllowed,
  NEXA_ALLOWED_PERMISSIONS,
  NEXA_DENIED_SENSITIVE_PERMISSIONS,
  persistPartition,
  privatePartition
} from '../../src/shared/permissions'
import { applyPermissionPolicy } from '../../src/main/security/permissions'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Minimal fake session capturing the two handlers the policy installs. */
function fakeSession() {
  let requestHandler:
    | ((wc: unknown, permission: string, cb: (granted: boolean) => void) => void)
    | null = null
  let checkHandler: ((wc: unknown, permission: string, origin: string, details: unknown) => boolean) | null =
    null
  const ses = {
    setPermissionRequestHandler: (h: typeof requestHandler) => {
      requestHandler = h
    },
    setPermissionCheckHandler: (h: typeof checkHandler) => {
      checkHandler = h
    }
  }
  const request = (permission: string): boolean => {
    let out = false
    requestHandler?.({}, permission, (granted) => {
      out = granted
    })
    return out
  }
  const check = (permission: string, origin = 'https://example.com'): boolean =>
    checkHandler?.({}, permission, origin, {}) ?? false
  return { ses, request, check, installed: () => requestHandler !== null && checkHandler !== null }
}

describe('permission policy — decision logic', () => {
  it('allows exactly the documented low-risk set', () => {
    for (const p of NEXA_ALLOWED_PERMISSIONS) expect(isPermissionAllowed(p)).toBe(true)
  })

  it('denies every documented sensitive permission', () => {
    for (const p of NEXA_DENIED_SENSITIVE_PERMISSIONS) expect(isPermissionAllowed(p)).toBe(false)
  })

  it('denies by default for unknown / arbitrary permissions', () => {
    for (const p of ['', 'anything', 'geolocation ', 'MEDIA', 'camera', 'microphone', 'usb', 'hid']) {
      expect(isPermissionAllowed(p)).toBe(false)
    }
  })

  it('does not allow sensitive device permissions', () => {
    expect(isPermissionAllowed('geolocation')).toBe(false)
    expect(isPermissionAllowed('media')).toBe(false)
    expect(isPermissionAllowed('display-capture')).toBe(false)
    expect(isPermissionAllowed('serial')).toBe(false)
    expect(isPermissionAllowed('usb')).toBe(false)
  })
})

describe('permission policy — applier installs on any session', () => {
  it('installs both request and check handlers', () => {
    const f = fakeSession()
    applyPermissionPolicy(f.ses as never)
    expect(f.installed()).toBe(true)
  })

  it('request handler grants only allowed permissions and denies the rest', () => {
    const f = fakeSession()
    applyPermissionPolicy(f.ses as never)
    expect(f.request('clipboard-sanitized-write')).toBe(true)
    expect(f.request('fullscreen')).toBe(true)
    expect(f.request('geolocation')).toBe(false)
    expect(f.request('media')).toBe(false)
  })

  it('check handler mirrors the request decision (deny by default)', () => {
    const f = fakeSession()
    applyPermissionPolicy(f.ses as never)
    expect(f.check('notifications')).toBe(true)
    expect(f.check('geolocation')).toBe(false)
    expect(f.check('usb')).toBe(false)
  })

  it('ignores the requesting origin supplied by the renderer', () => {
    const f = fakeSession()
    applyPermissionPolicy(f.ses as never)
    // A hostile origin cannot widen the decision — geolocation stays denied.
    expect(f.check('geolocation', 'https://evil.example')).toBe(false)
    expect(f.check('geolocation', 'https://trusted.example')).toBe(false)
  })
})

describe('partition helpers — profile isolation', () => {
  it('produces distinct persistent partitions per profile', () => {
    expect(persistPartition('alpha')).toBe('persist:nexa-alpha')
    expect(persistPartition('beta')).toBe('persist:nexa-beta')
    expect(persistPartition('alpha')).not.toBe(persistPartition('beta'))
  })

  it('produces distinct private partitions per profile that are never persistent', () => {
    expect(privatePartition('alpha')).toBe('nexa-private-alpha')
    expect(privatePartition('alpha')).not.toContain('persist:')
    expect(privatePartition('alpha')).not.toBe(privatePartition('beta'))
  })

  it('persistent and private partitions never collide for the same profile', () => {
    expect(persistPartition('alpha')).not.toBe(privatePartition('alpha'))
  })
})

describe('SEC-1 wiring — every NEXA session gets the policy', () => {
  const index = read('src/main/index.ts')

  it('applies the policy to the default session', () => {
    expect(index).toContain('applyPermissionPolicy(session.defaultSession)')
  })

  it('applies the policy to persistent and private profile partitions', () => {
    expect(index).toContain('applyPermissionPolicy(session.fromPartition(persistPartition(id)))')
    expect(index).toContain('applyPermissionPolicy(session.fromPartition(privatePartition(id)))')
  })

  it('no longer relies on the old default-session-only inline handler', () => {
    expect(index).not.toContain("permission === 'clipboard-sanitized-write' || permission === 'notifications'")
  })
})
