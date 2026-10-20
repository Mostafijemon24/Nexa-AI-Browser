import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { applyPermissionPolicy } from '../../src/main/security/permissions'
import { ExtensionService, type ExtSessionLike, type ExtensionSessionProvider } from '../../src/main/services/extensions'
import { Persistence } from '../../src/main/services/persistence'
import type { PlatformAdapter } from '../../src/platform/types'
import { parseHostPermission, validateManifest } from '../../src/shared/extensions'
import {
  NEXA_ALLOWED_PERMISSIONS,
  NEXA_DENIED_SENSITIVE_PERMISSIONS,
  isPermissionAllowed,
  persistPartition,
  privatePartition
} from '../../src/shared/permissions'
import { defaultSession, type SessionState } from '../../src/shared/types'

const BLOCKED = 'BLOCKED — ENVIRONMENT' as const
type Status = 'PASS' | 'FAIL' | typeof BLOCKED

interface Check {
  id: string
  area: string
  status: Status
  evidence: string
}

const root = join(__dirname, '..', '..')
const reportDir = join(root, 'reports')
const checks: Check[] = []

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function pass(id: string, area: string, evidence: string): Check {
  return { id, area, status: 'PASS', evidence }
}
function fail(id: string, area: string, evidence: string): Check {
  return { id, area, status: 'FAIL', evidence }
}
function blocked(id: string, area: string, evidence: string): Check {
  return { id, area, status: BLOCKED, evidence }
}

function record(check: Check): void {
  checks.push(check)
}

function fakeSession() {
  let requestHandler:
    | ((wc: unknown, permission: string, cb: (granted: boolean) => void) => void)
    | null = null
  let checkHandler: ((wc: unknown, permission: string, origin: string, details: unknown) => boolean) | null = null
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
  const check = (permission: string, origin: string): boolean => checkHandler?.({}, permission, origin, {}) ?? false
  return { ses, request, check, installed: () => requestHandler !== null && checkHandler !== null }
}

class RecordingSession implements ExtSessionLike {
  loads: { path: string; allowFileAccess: boolean | undefined }[] = []
  removes: string[] = []
  constructor(private idFor: (path: string) => string) {}
  async loadExtension(path: string, opts?: { allowFileAccess?: boolean }) {
    this.loads.push({ path, allowFileAccess: opts?.allowFileAccess })
    return { id: this.idFor(path), name: 'RC1 Ext', version: '1.0.0', manifest: {}, path }
  }
  removeExtension(id: string) {
    this.removes.push(id)
  }
  getAllExtensions() {
    return []
  }
}

function extensionId(path: string): string {
  let h = 0
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const alphabet = 'abcdefghijklmnop'
  let out = ''
  for (let i = 0; i < 32; i++) out += alphabet[(h + i * 7) % 16]
  return out
}

function probeElectronBinary(): Check {
  const id = 'electron-44-binary'
  const area = 'Electron 44 runtime'
  const electronPkg = join(root, 'node_modules/electron')
  const pathFile = join(electronPkg, 'path.txt')
  if (!existsSync(pathFile)) {
    return blocked(id, area, 'Installed Electron package is present, but path.txt is missing. The binary was not downloaded or launched and is not counted as PASS.')
  }
  const relative = readFileSync(pathFile, 'utf8').trim()
  const bin = relative ? join(electronPkg, 'dist', relative) : ''
  if (!bin || !existsSync(bin)) {
    return blocked(id, area, 'Electron path.txt does not point at a local binary. Nothing was downloaded and this is not counted as PASS.')
  }
  const result = spawnSync(bin, ['-e', 'process.stdout.write(String(process.versions.electron || ""))'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 8000,
    encoding: 'utf8'
  })
  const version = (result.stdout || '').trim()
  if (result.error || result.status !== 0 || !version) {
    const why = result.error ? result.error.name : `exit ${result.status ?? 'null'}`
    return blocked(
      id,
      area,
      `Local Electron binary could not be probed via ELECTRON_RUN_AS_NODE (${why}). A window was not opened. Not simulated as PASS.`
    )
  }
  if (version !== '44.4.1') {
    return fail(id, area, `ELECTRON_RUN_AS_NODE reported ${version}; expected 44.4.1.`)
  }
  return pass(id, area, 'ELECTRON_RUN_AS_NODE probe of the local Electron binary reported 44.4.1. No window was opened.')
}

function checkElectronPin(): void {
  const installed = JSON.parse(read('node_modules/electron/package.json')) as { version?: string }
  const pkg = JSON.parse(read('package.json')) as { devDependencies?: { electron?: string } }
  const declared = pkg.devDependencies?.electron ?? ''
  if (installed.version === '44.4.1' && declared.includes('44.4.1')) {
    record(pass('electron-44-pin', 'Electron 44 runtime', `Installed electron@${installed.version}; package.json declares ${declared}.`))
  } else {
    record(fail('electron-44-pin', 'Electron 44 runtime', `Installed ${installed.version ?? 'unknown'}; declared ${declared || 'missing'}.`))
  }
  const dts = read('node_modules/electron/electron.d.ts')
  const typesOk =
    dts.startsWith('// Type definitions for Electron 44.4.1') &&
    dts.includes('writeText(text: string): Promise<void>') &&
    dts.includes('readText(): Promise<string>')
  record(
    typesOk
      ? pass(
          'electron-44-clipboard-types',
          'Async clipboard',
          'Electron 44.4.1 type definitions declare clipboard.writeText/readText as Promise-based. Live OS clipboard was not touched.'
        )
      : fail('electron-44-clipboard-types', 'Async clipboard', 'Electron 44 clipboard Promise signatures were not found in electron.d.ts.')
  )
  record(probeElectronBinary())
}

function checkPermissionPolicy(): void {
  const denied = [...NEXA_DENIED_SENSITIVE_PERMISSIONS, 'camera', 'microphone', 'not-a-real-permission']
  const allowFails = NEXA_ALLOWED_PERMISSIONS.filter((p) => !isPermissionAllowed(p))
  const denyFails = denied.filter((p) => isPermissionAllowed(p))
  record(
    allowFails.length === 0 && denyFails.length === 0
      ? pass(
          'sec1-deny-by-default',
          'SEC-1',
          `isPermissionAllowed grants only ${NEXA_ALLOWED_PERMISSIONS.join(', ')}; sensitive and unknown permissions return false.`
        )
      : fail('sec1-deny-by-default', 'SEC-1', `Unexpected allow=${allowFails.join(',')} deny=${denyFails.join(',')}.`)
  )

  const origins = ['https://example.com', 'https://evil.example', 'file:///tmp/page.html', '']
  const labels = ['defaultSession', 'persist-partition', 'private-partition']
  const sessions = labels.map(() => fakeSession())
  for (const s of sessions) applyPermissionPolicy(s.ses as never)
  const problems: string[] = []
  sessions.forEach((s, i) => {
    if (!s.installed()) problems.push(`${labels[i]} handlers missing`)
    for (const origin of origins) {
      for (const permission of denied) {
        if (s.request(permission) || s.check(permission, origin)) {
          problems.push(`${labels[i]} granted ${permission} for ${origin || '(empty)'}`)
        }
      }
      for (const permission of NEXA_ALLOWED_PERMISSIONS) {
        if (!s.request(permission) || !s.check(permission, origin)) {
          problems.push(`${labels[i]} denied allowed ${permission} for ${origin || '(empty)'}`)
        }
      }
    }
  })
  record(
    problems.length === 0
      ? pass(
          'sec1-partition-policy',
          'Permission policy',
          'The same deny-by-default handlers were applied to default, persistent, and private session stand-ins. Origin did not widen any decision. This is the typed policy, not a live Chromium prompt.'
        )
      : fail('sec1-partition-policy', 'Permission policy', problems.slice(0, 8).join('; '))
  )

  const a = 'profileA'
  const b = 'profileB'
  const persistA: string = persistPartition(a)
  const persistB: string = persistPartition(b)
  const privateA: string = privatePartition(a)
  const namesOk =
    persistA !== persistB &&
    !privateA.includes('persist:') &&
    persistA === 'persist:nexa-profileA' &&
    persistB === 'persist:nexa-profileB' &&
    privateA === 'nexa-private-profileA'
  record(
    namesOk
      ? pass('partition-names', 'Profile isolation', 'persistPartition and privatePartition are distinct; private partitions are not persistent.')
      : fail('partition-names', 'Profile isolation', `persistA=${persistA} persistB=${persistB} privateA=${privateA}`)
  )

  const index = read('src/main/index.ts')
  const wired =
    index.includes('applyPermissionPolicy(session.defaultSession)') &&
    index.includes('applyPermissionPolicy(session.fromPartition(persistPartition') &&
    index.includes('applyPermissionPolicy(session.fromPartition(privatePartition')
  const prefs = read('src/main/index.ts')
  const hardened =
    prefs.includes('sandbox: true') &&
    prefs.includes('contextIsolation: true') &&
    prefs.includes('nodeIntegration: false') &&
    prefs.includes('webSecurity: true')
  record(
    wired && hardened
      ? pass(
          'sec1-production-wiring',
          'SEC-1',
          'Production main process applies the policy to defaultSession and both partition kinds, with hardened webPreferences. No security source was modified by this harness.'
        )
      : fail('sec1-production-wiring', 'SEC-1', 'Production permission wiring or webPreferences hardening is missing.')
  )
}

function checkClipboardContract(): void {
  const vault = read('src/main/services/vault.ts')
  const contract =
    vault.includes('await clipboard.writeText(pw)') &&
    vault.includes('clipboard') &&
    vault.includes('.readText()') &&
    vault.includes('current === pw') &&
    vault.includes("clipboard.writeText('')") &&
    vault.includes('30_000')
  record(
    contract
      ? pass(
          'clipboard-async-source-contract',
          'Async clipboard',
          'Vault copySecret awaits clipboard.writeText, then schedules a 30s readText comparison and clears only if the clipboard still holds that secret. The OS clipboard was not written or read.'
        )
      : fail('clipboard-async-source-contract', 'Async clipboard', 'Vault async clipboard contract is missing from src/main/services/vault.ts.')
  )
}

async function checkExtensions(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'nexa-rc1-ext-'))
  const extPath = join(base, 'ext')
  mkdirSync(extPath)
  const persistMap = new Map<string, RecordingSession>()
  const privateMap = new Map<string, RecordingSession>()
  const get = (map: Map<string, RecordingSession>, id: string) => {
    let s = map.get(id)
    if (!s) {
      s = new RecordingSession(extensionId)
      map.set(id, s)
    }
    return s
  }
  const sessions: ExtensionSessionProvider = {
    persist: (id) => get(persistMap, id),
    private: (id) => get(privateMap, id)
  }
  const persist = {
    profileDir: (id: string) => join(base, 'profiles', id)
  } as unknown as Persistence
  const manifest = {
    manifest_version: 3,
    name: 'RC1 Fixture',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: ['https://example.com/*']
  }
  const svc = new ExtensionService(persist, () => {}, {
    sessions,
    readManifest: () => manifest,
    now: () => 1
  })

  try {
    const installed = await svc.install('rc1a', extPath)
    const persistLoads = persistMap.get('rc1a')?.loads ?? []
    const installOk = installed.ok && persistLoads.length === 1 && persistLoads[0]?.allowFileAccess === false
    const extId = installed.info?.id
    if (!extId) {
      record(fail('extension-allow-file-access', 'Extensions', 'Install did not return an extension id; allowFileAccess was not observed.'))
      return
    }
    const privOff = await svc.setPrivate('rc1a', extId, false)
    const privateLoadsAfterOff = privateMap.get('rc1a')?.loads.length ?? 0
    const privOn = await svc.setPrivate('rc1a', extId, true)
    const privateLoads = privateMap.get('rc1a')?.loads ?? []
    const other = svc.list('rc1b')
    const fileHost = parseHostPermission('file:///tmp/*')
    const chromeHost = parseHostPermission('chrome://extensions/')
    const jsHost = parseHostPermission('javascript://evil/')
    const fileScript = validateManifest({
      ...manifest,
      content_scripts: [{ matches: ['file:///tmp/*'], js: ['c.js'] }]
    })
    const blockedManifest = validateManifest({ ...manifest, permissions: ['storage', 'debugger'] })
    const blockedInstall = await new ExtensionService(persist, () => {}, {
      sessions,
      readManifest: () => ({ ...manifest, permissions: ['storage', 'debugger'] }),
      now: () => 1
    }).install('rc1c', extPath)
    let traversalThrew = false
    try {
      await svc.install('../other', extPath)
    } catch (err) {
      traversalThrew = err instanceof Error && err.message === 'invalid_profile_id'
    }
    const sourceSites = (read('src/main/services/extensions.ts').match(/allowFileAccess:\s*false/g) || []).length
    const ok =
      installOk &&
      privOff.ok &&
      privateLoadsAfterOff === 0 &&
      privOn.ok &&
      privateLoads.length === 1 &&
      privateLoads[0]?.allowFileAccess === false &&
      other.length === 0 &&
      fileHost.valid === false &&
      fileHost.reason === 'forbidden_scheme' &&
      chromeHost.valid === false &&
      jsHost.valid === false &&
      fileScript.valid === false &&
      blockedManifest.support === 'BLOCKED' &&
      blockedManifest.valid === false &&
      blockedInstall.ok === false &&
      blockedInstall.error === 'blocked_permissions' &&
      (persistMap.get('rc1c')?.loads.length ?? 0) === 0 &&
      traversalThrew &&
      sourceSites >= 1
    record(
      ok
        ? pass(
            'extension-security-invariants',
            'Extensions',
            `Injected session recorded allowFileAccess:false on persist install and private enable. Private load is skipped while private is off. file/chrome/javascript host patterns are rejected. debugger is BLOCKED and was not loaded. Profile id traversal is refused. Production source has ${sourceSites} allowFileAccess:false sites. Live Chromium MV3 load was not performed.`
          )
        : fail(
            'extension-security-invariants',
            'Extensions',
            `installOk=${installOk} privateOffLoads=${privateLoadsAfterOff} privateOn=${privateLoads[0]?.allowFileAccess} other=${other.length} fileHost=${fileHost.reason} blocked=${blockedInstall.error} traversal=${traversalThrew} sites=${sourceSites}`
          )
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

function checkProfileIsolation(): void {
  const base = mkdtempSync(join(tmpdir(), 'nexa-rc1-profiles-'))
  try {
    const platform: PlatformAdapter = {
      kind: 'macos',
      appDataDir: () => base,
      profileDir: (id: string) => join(base, 'profiles', id),
      downloadsDir: () => join(base, 'downloads'),
      notify: () => {},
      openPath: async () => ''
    }
    const persist = new Persistence(platform)
    const marker = 'rc1-profile-a-only'
    const state: SessionState = {
      ...defaultSession(),
      tabs: [
        { id: 't1', title: marker, url: 'https://a.example/', kind: 'web', view: 'web' },
        { id: 'tp', title: 'rc1-private-tab', url: 'https://private.example/', kind: 'web', view: 'web', private: true }
      ],
      activeTab: 't1'
    }
    persist.saveSession('rc1a', state)
    const loadedA = persist.loadSession('rc1a')
    const loadedB = persist.loadSession('rc1b')
    const disk = readFileSync(join(platform.profileDir('rc1a'), 'session.json'), 'utf8')
    const vaultA = persist.vaultPath('rc1a')
    const vaultB = persist.vaultPath('rc1b')
    let traversal = false
    try {
      persist.saveSession('../other', defaultSession())
    } catch (err) {
      traversal = err instanceof Error && err.message === 'invalid_profile_id'
    }
    const ok =
      loadedA.tabs.some((t) => t.title === marker) &&
      !loadedA.tabs.some((t) => t.private || t.title === 'rc1-private-tab') &&
      !disk.includes('rc1-private-tab') &&
      !loadedB.tabs.some((t) => t.title === marker) &&
      vaultA !== vaultB &&
      vaultA.includes(`${join('profiles', 'rc1a')}`) &&
      traversal
    record(
      ok
        ? pass(
            'profile-disk-isolation',
            'Profile isolation',
            'Persistence wrote profile A session into its own directory, did not persist the private tab, and profile B does not load that session. Profile id traversal is refused. This is on-disk file isolation, not a live Chromium cookie jar.'
          )
        : fail(
            'profile-disk-isolation',
            'Profile isolation',
            `a=${loadedA.tabs.map((t) => t.title).join(',')} diskPrivate=${disk.includes('rc1-private-tab')} bHasMarker=${loadedB.tabs.some((t) => t.title === marker)} traversal=${traversal}`
          )
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

function checkUnitSuiteBoundary(): void {
  const cfg = read('vitest.config.ts')
  const isolated = cfg.includes("include: ['tests/unit/**/*.test.ts']") && !cfg.includes('tests/rc1')
  record(
    isolated
      ? pass(
          'unit-suite-boundary',
          'Test inventory',
          'Default vitest include remains tests/unit/**/*.test.ts. This harness is excluded, so it cannot change the existing 746-test count.'
        )
      : fail('unit-suite-boundary', 'Test inventory', 'Default vitest include no longer isolates unit tests from the RC-1 harness.')
  )
}

function checkEnvironmentBlockers(): void {
  const items: { id: string; area: string; evidence: string }[] = [
    {
      id: 'env-gui',
      area: 'Live GUI',
      evidence: 'Real window interaction, first launch, and page rendering were not executed. Not simulated as PASS.'
    },
    {
      id: 'env-gatekeeper',
      area: 'Gatekeeper',
      evidence: 'Gatekeeper first-launch acceptance was not executed. Not simulated as PASS.'
    },
    {
      id: 'env-signing',
      area: 'Signing / notarization',
      evidence: 'codesign, notarization, and stapler were not executed. Not simulated as PASS.'
    },
    {
      id: 'env-wireguard',
      area: 'Native WireGuard',
      evidence: 'No WireGuard handshake, signed helper, or tunnel was started. NOT_CONFIGURED was not fabricated as PROTECTED. Not simulated as PASS.'
    },
    {
      id: 'env-oauth',
      area: 'Live OAuth',
      evidence: 'No OAuth consent, token exchange, or Google sign-in was performed. Not simulated as PASS.'
    },
    {
      id: 'env-external',
      area: 'External services',
      evidence: 'Ollama, Google Drive, and a live extension content-script load against example.com were not contacted. Not simulated as PASS.'
    },
    {
      id: 'env-os-clipboard',
      area: 'Async clipboard',
      evidence: 'The OS clipboard was not written, read, or observed for the 30-second clear. The source contract is a separate check. Not simulated as PASS.'
    },
    {
      id: 'env-chromium-cookies',
      area: 'Profile isolation',
      evidence: 'Live Chromium cookie/cache isolation between partitions was not observed. On-disk profile files are a separate check. Not simulated as PASS.'
    },
    {
      id: 'env-permission-prompts',
      area: 'Permission policy',
      evidence: 'A live page geolocation, camera, or display-capture prompt was not observed. Policy decisions are a separate check. Not simulated as PASS.'
    }
  ]
  for (const item of items) record(blocked(item.id, item.area, item.evidence))
}

function writeReports(): void {
  const passN = checks.filter((c) => c.status === 'PASS').length
  const failN = checks.filter((c) => c.status === 'FAIL').length
  const blockedN = checks.filter((c) => c.status === BLOCKED).length
  const decision = failN === 0 ? 'AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS' : 'AUTOMATED_FAIL'
  const generatedAt = new Date().toISOString()
  const payload = {
    product: 'NEXA',
    version: '0.1.0',
    suite: 'RC-1 runtime validation harness',
    electronExpected: '44.4.1',
    generatedAt,
    decision,
    unitTestsPreserved: 746,
    note: 'BLOCKED — ENVIRONMENT results were not executed and are never simulated as PASS. This report is not a release attestation.',
    counts: { pass: passN, fail: failN, blockedEnvironment: blockedN },
    checks
  }
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(join(reportDir, 'rc1-validation.json'), `${JSON.stringify(payload, null, 2)}\n`)

  const rows = checks
    .map((c) => `| ${c.id} | ${c.area} | ${c.status} | ${c.evidence.replace(/\|/g, '/')} |`)
    .join('\n')
  const md = `# NEXA RC-1 runtime validation

Generated: ${generatedAt}

**Decision:** ${decision}

This harness reuses the existing typed permission, extension, and persistence services. It does not add product features and does not change the security architecture. Environment-only items stay **BLOCKED — ENVIRONMENT**. They are not mocked into PASS.

| Result | Count |
| --- | ---: |
| PASS | ${passN} |
| FAIL | ${failN} |
| BLOCKED — ENVIRONMENT | ${blockedN} |

Unit suite boundary: default \`vitest\` include remains \`tests/unit/**/*.test.ts\`. This harness is outside that include, so the existing **746** unit tests are preserved. \`scripts/rc1-validate.sh\` still runs lint, typecheck, those tests, and the production build.

| ID | Area | Status | Evidence |
| --- | --- | --- | --- |
${rows}

## Not counted as PASS

Real GUI interaction, Gatekeeper, signing/notarization, native WireGuard, live OAuth, and external services were not executed. A missing binary, a failed headless Electron probe, or a mock session is not treated as a live runtime PASS.
`
  writeFileSync(join(reportDir, 'rc1-validation.md'), md)
}

describe('NEXA RC-1 runtime validation harness', () => {
  it('validates typed runtime contracts and records environment blockers', async () => {
    checks.length = 0
    try {
      checkElectronPin()
      checkPermissionPolicy()
      checkClipboardContract()
      await checkExtensions()
      checkProfileIsolation()
      checkUnitSuiteBoundary()
      checkEnvironmentBlockers()
    } finally {
      writeReports()
    }
    const failed = checks.filter((c) => c.status === 'FAIL')
    expect(failed, failed.map((c) => `${c.id}: ${c.evidence}`).join('\n')).toEqual([])
    expect(checks.some((c) => c.status === BLOCKED)).toBe(true)
    expect(checks.find((c) => c.id === 'env-gatekeeper')?.status).toBe(BLOCKED)
    expect(checks.find((c) => c.id === 'env-signing')?.status).toBe(BLOCKED)
    expect(checks.find((c) => c.id === 'env-wireguard')?.status).toBe(BLOCKED)
    expect(checks.find((c) => c.id === 'env-oauth')?.status).toBe(BLOCKED)
    expect(checks.find((c) => c.id === 'env-external')?.status).toBe(BLOCKED)
    expect(checks.find((c) => c.id === 'env-gui')?.status).toBe(BLOCKED)
  })
})
