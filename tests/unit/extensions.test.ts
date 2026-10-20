import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERMISSION_MAP,
  FORBIDDEN_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  chromeToNexaPermissions,
  parseHostPermission,
  normalizeHostPermissions,
  isBroadHostAccess,
  matchesHost,
  hostPatternToRegex,
  validateManifest,
  classifyRisk,
  buildExtensionRecord,
  canTransition,
  canRunInPrivate,
  normalizeExtensionRecords,
  toExtensionInfo,
  isValidExtensionId,
  permissionLabel,
  type ExtensionManifest
} from '../../src/shared/extensions'

const VALID_ID = 'a'.repeat(32)

function mv3(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'Test Extension',
    version: '1.2.3',
    description: 'A test',
    ...over
  }
}

/* ----------------------------- permissions ----------------------------- */

describe('permission taxonomy', () => {
  it('maps chrome permissions to the NEXA taxonomy', () => {
    expect(PERMISSION_MAP.tabs).toBe('READ_TABS')
    expect(PERMISSION_MAP.scripting).toBe('SCRIPTING')
    expect(PERMISSION_MAP.declarativeNetRequest).toBe('WEB_REQUEST')
    const { nexa, blocked } = chromeToNexaPermissions(['tabs', 'storage', 'cookies', 'unknownPerm'])
    expect(nexa).toContain('READ_TABS')
    expect(nexa).toContain('STORAGE')
    expect(nexa).toContain('COOKIES')
    expect(nexa).toContain('UNKNOWN')
    expect(blocked).toEqual([])
  })

  it('flags forbidden permissions (never mapped, tracked as blocked)', () => {
    expect(FORBIDDEN_PERMISSIONS.has('debugger')).toBe(true)
    expect(FORBIDDEN_PERMISSIONS.has('nativeMessaging')).toBe(true)
    const { nexa, blocked } = chromeToNexaPermissions(['storage', 'debugger', 'proxy'])
    expect(blocked).toEqual(['debugger', 'proxy'])
    expect(nexa).toEqual(['STORAGE'])
  })

  it('high-risk set + labels', () => {
    expect(HIGH_RISK_PERMISSIONS.has('SCRIPTING')).toBe(true)
    expect(HIGH_RISK_PERMISSIONS.has('STORAGE')).toBe(false)
    expect(permissionLabel('COOKIES')).toMatch(/cookies/i)
  })
})

/* --------------------------- host permissions --------------------------- */

describe('host permission parsing', () => {
  it('accepts valid http/https/wildcard patterns', () => {
    expect(parseHostPermission('https://example.com/*').valid).toBe(true)
    expect(parseHostPermission('https://*.example.com/*').valid).toBe(true)
    expect(parseHostPermission('*://example.com/*').valid).toBe(true)
    expect(parseHostPermission('<all_urls>')).toMatchObject({ valid: true, allUrls: true })
  })

  it('rejects dangerous / unsupported schemes', () => {
    expect(parseHostPermission('file:///*')).toMatchObject({ valid: false, reason: 'forbidden_scheme' })
    expect(parseHostPermission('chrome://settings/*')).toMatchObject({ valid: false, reason: 'forbidden_scheme' })
    expect(parseHostPermission('devtools://*/*')).toMatchObject({ valid: false, reason: 'forbidden_scheme' })
    expect(parseHostPermission('javascript://x')).toMatchObject({ valid: false, reason: 'forbidden_scheme' })
    expect(parseHostPermission('data:text/html,x')).toMatchObject({ valid: false })
    expect(parseHostPermission('ftp://host/')).toMatchObject({ valid: false, reason: 'forbidden_scheme' })
  })

  it('rejects malformed hosts', () => {
    expect(parseHostPermission('https://ex*ample.com/*')).toMatchObject({ valid: false, reason: 'bad_host_wildcard' })
    expect(parseHostPermission('notaurl')).toMatchObject({ valid: false })
  })

  it('normalizes and tracks rejected + broad', () => {
    const n = normalizeHostPermissions(['https://a.com/*', 'file:///*', '<all_urls>'])
    expect(n.normalized).toEqual(['https://a.com/*', '<all_urls>'])
    expect(n.rejected).toHaveLength(1)
    expect(n.broad).toBe(true)
    expect(isBroadHostAccess(['https://a.com/*'])).toBe(false)
    expect(isBroadHostAccess(['https://*/*'])).toBe(true)
  })

  it('matches URLs against granted host patterns', () => {
    expect(matchesHost(['https://*.example.com/*'], 'https://sub.example.com/page')).toBe(true)
    expect(matchesHost(['https://*.example.com/*'], 'https://example.com/x')).toBe(true)
    expect(matchesHost(['https://example.com/*'], 'https://evil.com/')).toBe(false)
    expect(matchesHost(['<all_urls>'], 'https://anything.dev/x')).toBe(true)
    expect(hostPatternToRegex('file:///*')).toBeNull()
  })
})

/* --------------------------- manifest validation ------------------------- */

describe('manifest validation (MV3)', () => {
  it('accepts a well-formed MV3 manifest', () => {
    const v = validateManifest(mv3({ permissions: ['storage', 'tabs'], host_permissions: ['https://example.com/*'], action: { default_title: 'X' } }))
    expect(v.valid).toBe(true)
    expect(v.support).toBe('PARTIALLY_SUPPORTED')
    expect(v.manifest?.permissions).toEqual(['storage', 'tabs'])
    expect(v.manifest?.host_permissions).toEqual(['https://example.com/*'])
  })

  it('rejects MV2 as UNSUPPORTED (never executed)', () => {
    const v = validateManifest(mv3({ manifest_version: 2 }))
    expect(v.valid).toBe(false)
    expect(v.support).toBe('UNSUPPORTED')
    expect(v.errors).toContain('manifest_v2_unsupported')
  })

  it('rejects invalid name/version', () => {
    expect(validateManifest(mv3({ name: '' })).errors).toContain('invalid_name')
    expect(validateManifest(mv3({ version: 'x.y' })).errors).toContain('invalid_version')
  })

  it('rejects MV2-style background', () => {
    const v = validateManifest(mv3({ background: { scripts: ['bg.js'] } }))
    expect(v.valid).toBe(false)
    expect(v.errors).toContain('mv2_background_unsupported')
  })

  it('accepts MV3 service worker background', () => {
    const v = validateManifest(mv3({ background: { service_worker: 'sw.js', type: 'module' } }))
    expect(v.valid).toBe(true)
    expect(v.manifest?.background?.service_worker).toBe('sw.js')
  })

  it('validates content scripts (matches required + valid)', () => {
    expect(validateManifest(mv3({ content_scripts: [{ js: ['c.js'] }] })).errors).toContain('content_script_missing_matches')
    expect(validateManifest(mv3({ content_scripts: [{ matches: ['file:///*'], js: ['c.js'] }] })).errors).toContain('content_script_invalid_matches')
    const ok = validateManifest(mv3({ content_scripts: [{ matches: ['https://a.com/*'], js: ['c.js'], run_at: 'document_idle' }] }))
    expect(ok.valid).toBe(true)
    expect(ok.manifest?.content_scripts[0].matches).toEqual(['https://a.com/*'])
  })

  it('marks manifests requesting forbidden permissions as BLOCKED', () => {
    const v = validateManifest(mv3({ permissions: ['storage', 'debugger'] }))
    expect(v.support).toBe('BLOCKED')
    expect(v.valid).toBe(false)
  })

  it('handles non-object input safely', () => {
    expect(validateManifest(null).valid).toBe(false)
    expect(validateManifest('nope').support).toBe('UNSUPPORTED')
  })
})

/* -------------------------- risk classification -------------------------- */

describe('risk classification', () => {
  it('BLOCKED when forbidden permission present', () => {
    expect(classifyRisk(['STORAGE'], false, ['debugger'])).toBe('BLOCKED')
  })
  it('HIGH for scripting + broad host, or identity', () => {
    expect(classifyRisk(['SCRIPTING', 'HOST_ACCESS'], true)).toBe('HIGH')
    expect(classifyRisk(['IDENTITY'], false)).toBe('HIGH')
  })
  it('MEDIUM for a high-risk permission without broad host', () => {
    expect(classifyRisk(['COOKIES'], false)).toBe('MEDIUM')
    expect(classifyRisk(['READ_HISTORY'], false)).toBe('MEDIUM')
  })
  it('LOW for benign permissions', () => {
    expect(classifyRisk(['STORAGE', 'NOTIFICATIONS', 'ALARMS'], false)).toBe('LOW')
  })
})

/* ---------------------------- record building ---------------------------- */

describe('extension record', () => {
  it('builds a record from a validated manifest + identity', () => {
    const v = validateManifest(mv3({ permissions: ['scripting'], host_permissions: ['<all_urls>'] }))
    const rec = buildExtensionRecord({ id: VALID_ID, path: '/x', source: 'LOCAL_FOLDER', manifest: v.manifest as ExtensionManifest, installedAt: 1 })
    expect(rec.enabled).toBe(false) // never auto-enabled
    expect(rec.permissions).toContain('HOST_ACCESS')
    expect(rec.riskClass).toBe('HIGH')
    expect(rec.lifecycle).toBe('INSTALLED')
    expect(rec.siteAccess).toBe('always') // broad host default
  })

  it('a blocked-permission record lands in BLOCKED lifecycle', () => {
    const v = validateManifest(mv3({ permissions: ['storage'] }))
    // simulate a manifest that carried a forbidden permission via chrome list
    const rec = buildExtensionRecord({ id: VALID_ID, path: '/x', source: 'LOCAL_FOLDER', manifest: { ...(v.manifest as ExtensionManifest), permissions: ['storage', 'debugger'] }, installedAt: 1 })
    expect(rec.blockedPermissions).toEqual(['debugger'])
    expect(rec.riskClass).toBe('BLOCKED')
    expect(rec.lifecycle).toBe('BLOCKED')
  })

  it('validates extension ids strictly', () => {
    expect(isValidExtensionId(VALID_ID)).toBe(true)
    expect(isValidExtensionId('z'.repeat(32))).toBe(false) // z out of a-p
    expect(isValidExtensionId('short')).toBe(false)
  })
})

/* ------------------------------ lifecycle -------------------------------- */

describe('lifecycle transitions', () => {
  it('allows valid transitions and rejects invalid ones', () => {
    expect(canTransition('INSTALLED', 'ENABLED')).toBe(true)
    expect(canTransition('ENABLED', 'RUNNING')).toBe(true)
    expect(canTransition('ENABLED', 'DISABLED')).toBe(true)
    expect(canTransition('REMOVED', 'ENABLED')).toBe(false)
    expect(canTransition('BLOCKED', 'ENABLED')).toBe(false)
    expect(canTransition('DISABLED', 'ENABLED')).toBe(true)
  })
})

/* --------------------------- private-mode policy -------------------------- */

describe('private-mode policy', () => {
  it('disabled by default; only runs private when explicitly enabled', () => {
    expect(canRunInPrivate({ enabled: true, privateEnabled: false, lifecycle: 'ENABLED' })).toBe(false)
    expect(canRunInPrivate({ enabled: false, privateEnabled: true, lifecycle: 'DISABLED' })).toBe(false)
    expect(canRunInPrivate({ enabled: true, privateEnabled: true, lifecycle: 'ENABLED' })).toBe(true)
    expect(canRunInPrivate({ enabled: true, privateEnabled: true, lifecycle: 'BLOCKED' })).toBe(false)
  })
})

/* ---------------------------- store validation --------------------------- */

describe('persisted record validation (untrusted)', () => {
  it('drops invalid ids, dupes, and coerces fields', () => {
    const recs = normalizeExtensionRecords([
      { id: VALID_ID, name: 'A', version: '1.0', enabled: true, permissions: ['STORAGE'], hostPermissions: [] },
      { id: VALID_ID, name: 'dup' }, // duplicate id
      { id: 'bad-id', name: 'B' }, // invalid id
      'nope'
    ])
    expect(recs).toHaveLength(1)
    expect(recs[0].name).toBe('A')
    expect(recs[0].enabled).toBe(true)
    expect(recs[0].lifecycle).toBe('ENABLED')
  })

  it('forces blocked-permission records to disabled + BLOCKED on read', () => {
    const recs = normalizeExtensionRecords([{ id: VALID_ID, name: 'A', enabled: true, blockedPermissions: ['debugger'] }])
    expect(recs[0].enabled).toBe(false)
    expect(recs[0].lifecycle).toBe('BLOCKED')
  })

  it('non-array → empty', () => {
    expect(normalizeExtensionRecords(null)).toEqual([])
    expect(normalizeExtensionRecords({})).toEqual([])
  })
})

/* --------------------------- renderer-safe view -------------------------- */

describe('bundled test-extension fixture', () => {
  it('the real test-extension/manifest.json validates as MV3', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'test-extension', 'manifest.json'), 'utf8'))
    const v = validateManifest(raw)
    expect(v.valid).toBe(true)
    expect(v.support).toBe('PARTIALLY_SUPPORTED')
    expect(v.manifest?.background?.service_worker).toBe('background.js')
    expect(v.manifest?.content_scripts[0].matches).toEqual(['https://example.com/*'])
    const rec = buildExtensionRecord({ id: VALID_ID, path: '/x', source: 'DEVELOPMENT_LOAD', manifest: v.manifest as ExtensionManifest, installedAt: 1 })
    expect(rec.permissions).toContain('STORAGE')
    expect(rec.riskClass).toBe('MEDIUM') // storage + specific host access
  })
})

describe('toExtensionInfo', () => {
  it('exposes metadata (no absolute path, includes highRisk list)', () => {
    const v = validateManifest(mv3({ permissions: ['cookies', 'scripting'], host_permissions: ['<all_urls>'] }))
    const rec = buildExtensionRecord({ id: VALID_ID, path: '/secret/path', source: 'LOCAL_FOLDER', manifest: v.manifest as ExtensionManifest, installedAt: 1 })
    const info = toExtensionInfo(rec)
    expect((info as unknown as Record<string, unknown>).path).toBeUndefined()
    expect(info.highRisk).toContain('COOKIES')
    expect(info.highRisk).toContain('SCRIPTING')
    expect(info.riskClass).toBe('HIGH')
  })
})
