import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Filesystem-only contract tests. The renderer design-system modules live in the
// web tsconfig project (with the @shared alias), so we validate them as source text
// here rather than importing across project boundaries into the node test project.
const DS = resolve(__dirname, '../../src/renderer/src/design-system')
const TOKENS = readFileSync(resolve(DS, 'tokens.css'), 'utf8')
const THEME = readFileSync(resolve(DS, 'theme.ts'), 'utf8')

describe('design tokens (tokens.css)', () => {
  it('defines the full semantic color set in :root and a dark theme override', () => {
    for (const t of ['--bg', '--surface', '--surface-2', '--elevated', '--border', '--border-2', '--text', '--text-2', '--text-3', '--accent', '--success', '--warning', '--error']) {
      expect(TOKENS).toContain(`${t}:`)
    }
    expect(TOKENS).toContain("[data-theme='dark']")
  })

  it('defines the STEP 1 semantic interaction + sizing + motion tokens (single source of truth)', () => {
    for (const t of ['--surface-hover', '--surface-active', '--on-accent', '--focus', '--ctl-h', '--ctl-h-sm', '--field-h', '--motion-fast', '--motion-base', '--ease']) {
      expect(TOKENS).toContain(`${t}:`)
    }
  })

  it('never references the non-existent --text-1 token (regression guard)', () => {
    expect(TOKENS).not.toContain('--text-1')
  })

  it('consumes control-height tokens in the shared control classes', () => {
    expect(TOKENS).toContain('height: var(--ctl-h)')
    expect(TOKENS).toContain('height: var(--ctl-h-sm)')
    expect(TOKENS).toContain('height: var(--field-h)')
  })

  it('uses semantic focus + on-accent tokens rather than raw literals in the class layer', () => {
    expect(TOKENS).toContain('outline: 2px solid var(--focus)')
    expect(TOKENS).toContain('color: var(--on-accent)')
    expect(TOKENS).not.toContain('background: #fff')
    expect(TOKENS).not.toContain('color: #fff')
  })

  it('respects reduced-motion (accessibility)', () => {
    expect(TOKENS).toContain('prefers-reduced-motion: reduce')
  })
})

describe('browser shell states (STEP 2)', () => {
  it('tabs have a non-active hover state distinct from the active state', () => {
    expect(TOKENS).toContain('.tab:not(.active):hover')
    expect(TOKENS).toContain('.tab.active')
  })

  it('per-tab close affordance has default + hover states', () => {
    expect(TOKENS).toContain('.tab-x')
    expect(TOKENS).toContain('.tab-x:hover')
  })

  it('address bar focuses the container (not the raw input) and suppresses the inner ring', () => {
    expect(TOKENS).toContain('.omnibox:focus-within')
    expect(TOKENS).toContain('.omnibox input:focus-visible')
    expect(TOKENS).toContain('.omnibox:hover')
  })

  it('provides token-driven context-menu primitives', () => {
    for (const c of ['.menu', '.menu-item', '.menu-item:hover', '.menu-sep', '.menu-item.danger']) {
      expect(TOKENS).toContain(c)
    }
  })

  it('shell state classes use tokens, not hardcoded colors', () => {
    const shell = TOKENS.slice(TOKENS.indexOf('.tab {'))
    // no raw hex fills introduced in the shell/menu class layer
    expect(/background:\s*#[0-9a-f]{3,6}/i.test(shell)).toBe(false)
  })
})

describe('app surfaces (STEP 3)', () => {
  const APP = readFileSync(resolve(__dirname, '../../src/renderer/src/App.tsx'), 'utf8')

  it('command palette supports keyboard navigation + activedescendant a11y', () => {
    expect(APP).toContain('onKeyDown={onKey}')
    expect(APP).toContain("e.key === 'ArrowDown'")
    expect(APP).toContain("e.key === 'ArrowUp'")
    expect(APP).toContain("e.key === 'Enter'")
    expect(APP).toContain('aria-activedescendant')
    expect(APP).toContain('role="listbox"')
    expect(APP).toContain('role="option"')
  })

  it('command palette groups commands into ordered categories', () => {
    expect(APP).toContain('PALETTE_GROUPS')
    expect(APP).toContain('function paletteGroup')
  })

  it('sidebar exposes MAIN / TOOLS hierarchy with active semantics', () => {
    expect(APP).toContain("group: 'MAIN'")
    expect(APP).toContain("group: 'TOOLS'")
    expect(APP).toContain("aria-current={active ? 'page' : undefined}")
  })

  it('interactive card buttons have hover/active states without affecting static cards', () => {
    expect(TOKENS).toContain('button.card:hover')
    expect(TOKENS).toContain('button.card:active')
  })
})

describe('theme engine (theme.ts) — derivation contract', () => {
  it('derives per-mode accent variants at runtime (color intelligence)', () => {
    expect(THEME).toContain('color-mix(in srgb, ${opts.accent} 68%, #fff)') // dark accent-2
    expect(THEME).toContain('color-mix(in srgb, ${opts.accent} 82%, #000)') // light accent-2
  })

  it('maps the user-selectable radius scale', () => {
    for (const r of ['sharp', 'compact', 'balanced', 'rounded']) expect(THEME).toContain(`${r}:`)
  })

  it('maps the density padding scale', () => {
    for (const d of ['compact', 'comfortable', 'spacious']) expect(THEME).toContain(`${d}:`)
  })

  it('supports solid / gradient / glass address-bar styles', () => {
    expect(THEME).toContain("=== 'gradient'")
    expect(THEME).toContain("=== 'glass'")
    expect(THEME).toContain('--addr-backdrop')
  })

  it('sets data-theme and data-motion attributes', () => {
    expect(THEME).toContain("setAttribute('data-theme'")
    expect(THEME).toContain("setAttribute('data-motion'")
  })
})

// Click-to-Go address-bar surface (STEP 4). Source-text guards only.
const APP = readFileSync(resolve(__dirname, '../../src/renderer/src/App.tsx'), 'utf8')

describe('Click-to-Go address bar (STEP 4)', () => {
  it('drives the address bar from the shared deterministic resolver (single source of truth)', () => {
    expect(APP).toContain("from '@shared/click-to-go'")
    expect(APP).toContain('resolveClickToGo(addr')
    expect(APP).toContain('function Omnibox()')
  })

  it('adds the suggestion dropdown surface using existing tokens', () => {
    expect(TOKENS).toContain('.omni-pop')
    expect(TOKENS).toContain('var(--elevated)')
    // reuses the accent-weak selected state shared with the command palette
    expect(APP).toContain("selected ? 'var(--accent-weak)' : 'transparent'")
  })

  it('implements combobox/listbox/option a11y with active-descendant + expanded', () => {
    expect(APP).toContain("role=\"combobox\"")
    expect(APP).toContain('role="listbox"')
    expect(APP).toContain('role="option"')
    expect(APP).toContain('aria-expanded={show}')
    expect(APP).toContain('aria-activedescendant')
    expect(APP).toContain('aria-selected={selected}')
  })

  it('supports the required keyboard model (Arrow/Enter/Escape)', () => {
    for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'"]) expect(APP).toContain(k)
  })

  it('has no generic execution boundary — only registered ids / validated urls execute', () => {
    for (const forbidden of ['executeShell', 'executeJS(', 'openFile(', 'clickToGo.execute', 'eval(']) {
      expect(APP).not.toContain(forbidden)
    }
    expect(APP).toContain('function executeClickToGo(')
  })
})

// Worker Assistant integration (STEP 5). Source-text guards only.
const STORE = readFileSync(resolve(__dirname, '../../src/renderer/src/state/store.ts'), 'utf8')

describe('Worker Assistant (STEP 5)', () => {
  it('reuses the shared deterministic worker core (single source of truth)', () => {
    expect(APP).toContain("from '@shared/worker'")
    expect(STORE).toContain("from '@shared/worker'")
    expect(APP).toContain('function WorkerPanel()')
    expect(APP).toContain('function workerScanLive(')
  })

  it('reuses the existing observation capture + buildObservation (no new DOM crawler)', () => {
    expect(APP).toContain('runJs(OBSERVE_SRC)')
    expect(APP).toContain('scanObservation(')
    expect(APP).toContain('setWorkerScanner(workerScanLive)')
  })

  it('fills only through existing agent tools (type/select_option/set_checkbox) — no new execution path', () => {
    expect(STORE).toContain('runWorkerActions')
    // uses the already-registered agent executor, not a new bridge
    expect(STORE).toContain('agentExecutor(a.tool, args)')
    for (const forbidden of ['executeShell', 'executeJS(', 'new Function(', 'clickToGo.execute', 'worker.execute(']) {
      expect(STORE).not.toContain(forbidden)
    }
  })

  it('never submits — no submit/click-final action in the worker fill path', () => {
    // the worker maps only to fill tools; agent-level submit remains NOT CONFIGURED
    expect(STORE).toMatch(/tool === 'set_checkbox'[\s\S]*tool === 'select_option'/)
    expect(STORE).not.toContain("agentExecutor('click'")
  })

  it('respects private mode + profile isolation (history skipped in private; reset on switch)', () => {
    expect(STORE).toContain('if (!isPrivate)')
    expect(STORE).toContain('workerHistory: []')
    expect(STORE).toContain('workerCtx = null')
  })

  it('one-shot AI completion is scoped (does not touch chat panel state)', () => {
    expect(STORE).toContain('aiComplete(messages')
    expect(STORE).toContain('event.requestId !== requestId')
  })

  it('Worker panel exposes accessible roles + live status', () => {
    expect(APP).toContain('aria-label="Worker Assistant"')
    expect(APP).toContain('aria-live="polite"')
  })

  it('Command Palette + Click-to-Go share one registry (no duplicate command lists)', () => {
    expect(APP).toContain('Worker: Open Worker Assistant')
    expect(APP).toContain("label.startsWith('Worker:')")
    // click-to-go worker command routed via the shared registry panel field
    expect(APP).toContain("def.panel === 'worker'")
  })
})

// Secure Vault Autofill (STEP 6). Source-text security guards.
const PRELOAD = readFileSync(resolve(__dirname, '../../src/preload/index.ts'), 'utf8')
const REGISTER = readFileSync(resolve(__dirname, '../../src/main/ipc/register.ts'), 'utf8')

describe('Secure Vault Autofill (STEP 6)', () => {
  it('reuses the shared deterministic core + existing vault (no new password manager)', () => {
    expect(APP).toContain("from '@shared/vault-autofill'")
    expect(STORE).toContain("from '@shared/vault-autofill'")
    expect(REGISTER).toContain("from '../services/vault'")
    expect(REGISTER).toContain('vault.reveal(')
  })

  it('IPC is capability-specific + request-only — NO generic secret getters', () => {
    // A dedicated autofill request channel exists.
    expect(PRELOAD).toContain('autofill: (payload')
    expect(REGISTER).toContain('channels.vaultAutofill')
    // No generic/secret-returning vault IPC surfaces.
    for (const forbidden of ['getPassword', 'readVault', 'executeVaultCommand', 'getSecret', 'window.nexa.getPassword']) {
      expect(PRELOAD).not.toContain(forbidden)
    }
  })

  it('the secret NEVER returns to the renderer (main returns only { filled })', () => {
    // The autofill handler resolves with a boolean status, not a password.
    expect(REGISTER).toContain('return ok({ filled })')
    // The revealed secret is passed ONLY into the main-side injector, never returned.
    expect(REGISTER).toMatch(/secret:\s*vault\.reveal\(/)
    expect(REGISTER).not.toMatch(/return ok\(\{\s*filled[^}]*password/)
    // The renderer runner + store expose only ok/filled — never a secret field.
    expect(APP).toContain('filled: !!res.data.filled')
    expect(STORE).not.toMatch(/vaultSecret|decryptedSecret|plaintextPassword/)
  })

  it('main revalidates profile identity + gates permission + verifies live origin', () => {
    expect(REGISTER).toContain('loadProfilesIndex().activeProfile')
    expect(REGISTER).toContain("data.mode === 'ask'") // ASK blocked
    expect(REGISTER).toContain('vault.isUnlocked(')
    expect(REGISTER).toContain('guest.getURL()') // authoritative live origin
    expect(REGISTER).toContain('matchCredentialOrigin(')
    expect(REGISTER).toContain('hostWebContents') // guest belongs to our window
  })

  it('the secret is injected in MAIN via a fixed snippet, never via the renderer/AI', () => {
    expect(REGISTER).toContain('function injectCredential(')
    expect(REGISTER).toContain('guest.executeJavaScript(code, true)')
    // No secret logging patterns anywhere in main IPC.
    for (const forbidden of ['console.log(secret', 'console.log(password', 'JSON.stringify(vault', 'console.log(pw']) {
      expect(REGISTER).not.toContain(forbidden)
    }
  })

  it('never auto-submits — injection only sets values + input/change events', () => {
    expect(REGISTER).toContain("dispatchEvent(new Event('input'")
    expect(REGISTER).toContain("dispatchEvent(new Event('change'")
    expect(REGISTER).not.toMatch(/\.submit\(\)/)
    expect(REGISTER).not.toContain('form.submit')
  })

  it('targets fields by the existing observation eid — no AI selectors / coordinates', () => {
    expect(APP).toContain('findLoginFields(')
    expect(REGISTER).toContain('data-nx-eid')
    expect(REGISTER).not.toContain('new Function(')
  })

  it('vault autofill UI is accessible + routed through the shared command registry', () => {
    expect(APP).toContain('function VaultAutofillPopover()')
    expect(APP).toContain('role="dialog"')
    expect(APP).toContain('aria-label="NEXA Vault autofill"')
    expect(APP).toContain("def.panel === 'vault'")
  })

  it('private mode / profile isolation: autofill keeps no history + resets on switch', () => {
    // Autofill records no history in any mode (private-safe by construction).
    expect(STORE).not.toContain('vaultAutofillHistory')
    // State is reset on profile switch.
    expect(STORE).toContain("vaultAutofillState: 'idle'")
  })
})

// Privacy Center & Diagnostics (STEP 7). Source-text security guards.
const PRIVACY = readFileSync(resolve(__dirname, '../../src/shared/privacy.ts'), 'utf8')
const PRIVACY_VIEW = readFileSync(resolve(__dirname, '../../src/renderer/src/views/PrivacyCenter.tsx'), 'utf8')

describe('Privacy Center (STEP 7)', () => {
  it('reuses existing protection + VPN telemetry (no second engine)', () => {
    expect(STORE).toContain("from '@shared/privacy'")
    // protection telemetry reused from the store snapshot, not re-blocked
    expect(STORE).toContain('st.protectionPrivate')
    expect(STORE).toContain('const v = st.vpn')
    // no new blocking/tracker engine
    expect(PRIVACY).not.toContain('blockRequest')
    expect(PRIVACY).not.toContain('webRequest')
  })

  it('diagnostics are deterministic + require NO AI', () => {
    for (const forbidden of ['aiComplete', 'aiChat', 'ollama', 'ai.chat']) {
      expect(PRIVACY).not.toContain(forbidden)
    }
    // the run orchestration never invokes AI
    expect(STORE).toContain('runPrivacyCheck')
  })

  it('capability-specific IPC only — no generic execute/network/shell/eval', () => {
    expect(PRELOAD).toContain('diagnose: (payload')
    expect(REGISTER).toContain('channels.privacyDiagnose')
    for (const forbidden of ['runCommand', 'networkRequest', 'fetchAnything', 'execute:', 'eval(', 'new Function(']) {
      expect(PRELOAD).not.toContain(forbidden)
      expect(PRIVACY).not.toContain(forbidden)
    }
  })

  it('main revalidates profile + returns only safe metadata (cookie COUNT, never values)', () => {
    expect(REGISTER).toContain('loadProfilesIndex().activeProfile')
    // cookie count only — never cookie values
    expect(REGISTER).toContain('cookies.get({ url: liveUrl })')
    expect(REGISTER).toContain('cookieCount')
    expect(REGISTER).not.toMatch(/cookie\.value|c\.value|cookies\[0\]\.value/)
  })

  it('never fabricates protection: honest states only, no fake positive labels', () => {
    for (const fake of ['ANONYMOUS', '100% protected', 'Fingerprint Protected', 'No Tracking']) {
      expect(PRIVACY).not.toContain(fake)
      expect(PRIVACY_VIEW).not.toContain(fake)
    }
    // public IP is not fabricated; a private IP is never called public
    expect(PRIVACY).toContain("isPublic: kind === 'public'")
    expect(STORE).toContain("publicIp: 'NOT_CONFIGURED'")
  })

  it('no fingerprint spoofing / randomization / evasion', () => {
    for (const forbidden of ['randomize', 'spoof', 'Math.random', 'fakeUserAgent', 'rotateIdentity']) {
      expect(PRIVACY).not.toContain(forbidden)
      expect(APP).not.toMatch(new RegExp(`${forbidden}[^\\n]*fingerprint`, 'i'))
    }
    // WebRTC probe uses empty iceServers (no external STUN) — local detection only
    expect(APP).toContain('iceServers: []')
  })

  it('is wired into view, palette, click-to-go and settings (all functional)', () => {
    expect(APP).toContain("tab.view === 'privacy'")
    expect(APP).toContain('Privacy: Open Privacy Center')
    expect(APP).toContain('setPrivacyProbe(privacyProbeLive)')
    expect(PRIVACY_VIEW).toContain('runPrivacyCheck()')
  })

  it('private mode / profile isolation: no persistence, reset on switch', () => {
    // privacyReport is renderer-only state; nothing is written to disk/persist
    expect(STORE).not.toContain('savePrivacy')
    expect(STORE).not.toContain('privacyHistory')
    // reset on profile switch
    expect(STORE).toContain("privacyState: 'idle'")
    expect(STORE).toContain('privacyReport: null')
  })

  it('Privacy Center UI is accessible (aria-live status + semantic headings)', () => {
    expect(PRIVACY_VIEW).toContain('aria-live="polite"')
    expect(PRIVACY_VIEW).toContain('<h1')
  })
})

// Google Drive & Cloud Download (STEP 8). Source-text security guards.
const DRIVE_CORE = readFileSync(resolve(__dirname, '../../src/shared/drive.ts'), 'utf8')
const DRIVE_SVC = readFileSync(resolve(__dirname, '../../src/main/services/drive.ts'), 'utf8')
const DRIVE_VIEW = readFileSync(resolve(__dirname, '../../src/renderer/src/views/Drive.tsx'), 'utf8')
const DOWNLOADS_SVC = readFileSync(resolve(__dirname, '../../src/main/services/downloads.ts'), 'utf8')

describe('Google Drive (STEP 8)', () => {
  it('tokens never enter renderer state / storage / URLs', () => {
    // Store carries only safe connection metadata (DriveConnectionMeta), no tokens.
    expect(STORE).not.toMatch(/access_token|refresh_token|client_secret|authorization_code/)
    expect(STORE).not.toMatch(/accessToken|refreshToken/)
    expect(DRIVE_VIEW).not.toMatch(/access_token|refresh_token|accessToken|refreshToken/)
    // Pure core holds no secrets either.
    expect(DRIVE_CORE).not.toMatch(/accessToken|refreshToken|client_secret/)
    // No token persistence in web storage.
    expect(STORE).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
  })

  it('tokens live only in main + OS-backed SecureStorage', () => {
    expect(DRIVE_SVC).toContain('this.secure.set(TOKEN_KEY')
    expect(DRIVE_SVC).toContain('this.secure.get(TOKEN_KEY')
    // the renderer-facing status() returns DriveConnectionMeta (no token fields)
    expect(DRIVE_SVC).toMatch(/status\([^)]*\):\s*DriveConnectionMeta/)
  })

  it('uses minimum read-only scope; no write/delete/gmail/calendar', () => {
    expect(DRIVE_CORE).toContain('auth/drive.readonly')
    for (const bad of ['auth/gmail', 'auth/calendar', 'auth/contacts', 'auth/photos']) {
      expect(DRIVE_CORE).not.toContain(bad)
    }
    // No write-operation URL builders / methods exist.
    for (const forbidden of ['files.delete', 'files.create', 'files.update', 'permissions.create', 'DELETE']) {
      expect(DRIVE_SVC).not.toContain(forbidden)
    }
  })

  it('OAuth is main-authoritative with PKCE + state + loopback redirect', () => {
    expect(DRIVE_SVC).toContain("createHash('sha256')") // PKCE S256 verifier→challenge
    expect(DRIVE_SVC).toContain('codeChallenge: challenge')
    expect(DRIVE_CORE).toContain("code_challenge_method: 'S256'")
    expect(DRIVE_SVC).toContain('validateState(')
    expect(DRIVE_SVC).toContain('parseCallback(')
    // renderer never asserts auth success — it only awaits main's returned meta
    expect(STORE).not.toContain("state: 'CONNECTED'")
  })

  it('download reuses the EXISTING P2 engine (no second download manager)', () => {
    // Handoff goes through DownloadService.enqueueUrl → session.downloadURL.
    expect(DOWNLOADS_SVC).toContain('enqueueUrl(')
    expect(DOWNLOADS_SVC).toContain('sess.downloadURL(')
    expect(DRIVE_SVC).toContain('this.enqueue(')
    // No parallel Drive download engine / queue.
    for (const forbidden of ['DriveDownloadService', 'DriveDownloadManager', 'DriveQueue', 'DriveProgressEngine']) {
      expect(DRIVE_SVC).not.toContain(forbidden)
    }
  })

  it('Drive API response is authoritative for downloads (no renderer URL trust)', () => {
    // download() validates fileId + fetches authoritative metadata before enqueue.
    expect(DRIVE_SVC).toContain('isValidFileId(args.fileId)')
    expect(DRIVE_SVC).toContain('normalizeDriveFile(await metaRes.json())')
    // renderer sends only fileId, never a URL
    expect(STORE).toContain('fileId: file.id')
    expect(STORE).not.toMatch(/drive\.download\([^)]*downloadUrl/)
  })

  it('capability-specific IPC only — no generic execute/eval/shell', () => {
    expect(PRELOAD).toContain('getStatus: (payload')
    expect(REGISTER).toContain('channels.driveDownload')
    for (const bad of ['drive.execute', 'drive.request', 'drive.fetch', 'drive.api', 'eval(', 'new Function(']) {
      expect(PRELOAD).not.toContain(bad)
      expect(DRIVE_CORE).not.toContain(bad)
      expect(DRIVE_SVC).not.toContain(bad)
    }
  })

  it('main revalidates active profile for every Drive op', () => {
    expect(DRIVE_SVC).toContain('assertActive(')
    expect(DRIVE_SVC).toContain("throw new Error('profile_mismatch')")
  })

  it('disconnect never deletes Drive files; only revokes local authorization', () => {
    expect(DRIVE_SVC).toContain('GOOGLE_REVOKE_ENDPOINT')
    expect(DRIVE_SVC).toContain('clearTokens')
    expect(DRIVE_SVC).not.toMatch(/method:\s*'DELETE'/)
  })

  it('honest states + no fake cloud (NOT_CONFIGURED without credentials)', () => {
    expect(DRIVE_SVC).toContain("state: 'NOT_CONFIGURED'")
    expect(DRIVE_SVC).toContain('process.env.NEXA_GOOGLE_CLIENT_ID')
    // no hard-coded client id / secret
    expect(DRIVE_SVC).not.toMatch(/apps\.googleusercontent\.com/)
    expect(DRIVE_CORE).not.toMatch(/client_secret\s*[:=]\s*['"][A-Za-z0-9_-]{6,}/)
  })

  it('open-in-Drive uses strict https google-owned validation', () => {
    expect(DRIVE_CORE).toContain('isSafeHttpsUrl')
    expect(DRIVE_VIEW).toContain('shell.openExternal')
    // no dangerous URL schemes handed to navigation
    expect(DRIVE_VIEW).not.toMatch(/javascript:|vbscript:/i)
  })

  it('AI is not part of the Drive path', () => {
    for (const bad of ['aiComplete', 'aiChat', 'ollama']) {
      expect(DRIVE_SVC).not.toContain(bad)
      expect(DRIVE_CORE).not.toContain(bad)
    }
  })

  it('profile isolation: Drive state resets on profile switch', () => {
    expect(STORE).toContain('driveMeta: null')
    expect(STORE).toContain('driveFiles: []')
  })

  it('Drive UI is accessible (aria-live + labelled controls)', () => {
    expect(DRIVE_VIEW).toContain('aria-live="polite"')
    expect(DRIVE_VIEW).toContain('aria-label')
  })
})

// ---------------------------------------------------------------------------
// Turbo Mode & Navigation Performance (STEP 9). Source-text security guards.
const TURBO_CORE = readFileSync(resolve(__dirname, '../../src/shared/turbo.ts'), 'utf8')

describe('Turbo Mode (STEP 9)', () => {
  it('is not a second engine and reuses the existing P2 download path', () => {
    // No parallel networking/download/cache/DNS/proxy engine introduced by Turbo.
    for (const bad of [
      'TurboDownloadEngine',
      'TurboHttpEngine',
      'TurboCacheEngine',
      'TurboDnsResolver',
      'TurboProxy',
      'TurboRenderer',
      'cloudRender',
      'remoteChromium'
    ]) {
      expect(TURBO_CORE).not.toContain(bad)
      expect(STORE).not.toContain(bad)
    }
    // Drive/downloads still go through P2 — Turbo adds no download bridge.
    expect(PRELOAD).not.toMatch(/turbo\.(download|fetch|request|execute|eval)/)
  })

  it('preconnect is main-authoritative, capability-specific, non-generic IPC', () => {
    // Renderer bridge exposes ONLY preconnect (no generic execute/fetch/eval).
    expect(PRELOAD).toContain('channels.turboPreconnect')
    for (const bad of ['turbo.execute', 'turbo.fetch', 'turbo.request', 'turbo.api', 'turbo.eval']) {
      expect(PRELOAD).not.toContain(bad)
    }
    // Main re-validates the active profile + rejects unsafe/sensitive origins.
    expect(REGISTER).toContain('channels.turboPreconnect')
    expect(REGISTER).toContain('preconnectTarget(')
    expect(REGISTER).toContain('loadProfilesIndex().activeProfile')
    expect(REGISTER).toContain('.preconnect({ url: origin')
    // Only the active profile may warm connections.
    expect(REGISTER).toContain('if (d.profileId !== active) return ok({ preconnected: false })')
  })

  it('never speculatively connects to sensitive / unsafe destinations', () => {
    // Sensitive segments are enforced in the pure policy.
    for (const seg of ['login', 'signin', 'checkout', 'payment', 'oauth', 'authorize', 'token', 'password']) {
      expect(TURBO_CORE).toContain(seg)
    }
    // Dangerous schemes are rejected up-front.
    for (const scheme of ['javascript:', 'data:', 'file:', 'chrome:', 'about:']) {
      expect(TURBO_CORE).toContain(scheme)
    }
    // Preconnect refuses private mode + sensitive URLs.
    expect(TURBO_CORE).toContain('if (!ctx.enabled || ctx.privateMode) return null')
    expect(TURBO_CORE).toContain('if (isSensitiveNavigation(url)) return null')
  })

  it('private mode + profile isolation: prediction/metrics never persist or leak', () => {
    // Store never warms connections for a private tab.
    expect(STORE).toContain('if (active?.private) return')
    // Turbo metrics are in-memory only (no localStorage/persist of perf).
    expect(STORE).not.toMatch(/persist[A-Za-z]*\([^)]*turboLastPerf/)
    // Profile switch resets Turbo prediction/metrics + module guards.
    expect(STORE).toContain('turboLastPerf: null')
    expect(STORE).toContain('lastNav = null')
    expect(STORE).toContain('lastPreconnect = ')
  })

  it('honest state model + no fabricated metrics/claims', () => {
    expect(TURBO_CORE).toContain("case 'ON':")
    expect(TURBO_CORE).toContain('Not available')
    expect(TURBO_CORE).toContain("return 'Unavailable'")
    // No marketing/perf lies anywhere in the Turbo core.
    expect(TURBO_CORE).not.toMatch(/10x|10×|faster than|1 second|guaranteed/i)
  })

  it('duplicate navigation is bounded + deterministic', () => {
    expect(STORE).toContain('isDuplicateNavigation(lastNav')
    expect(TURBO_CORE).toContain('NAV_DEDUPE_MS')
  })

  it('Turbo failure never blocks navigation (fire-and-forget preconnect)', () => {
    expect(STORE).toMatch(/turbo\.preconnect\([\s\S]*?\)\.catch\(\(\) => \{\}\)/)
  })

  it('navigation timing uses standard Performance API, local-only (no upload/AI)', () => {
    expect(APP).toContain("performance.getEntriesByType('navigation')")
    for (const bad of ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'aiComplete', 'ollama']) {
      expect(TURBO_CORE).not.toContain(bad)
    }
  })

  it('no unsafe execution primitives in Turbo core', () => {
    for (const bad of ['eval(', 'new Function(', 'child_process', 'execFile(', 'fs.readFile', 'fs.writeFile']) {
      expect(TURBO_CORE).not.toContain(bad)
    }
  })

  it('Turbo UI is accessible + reduced-motion safe (no giant/neon card)', () => {
    expect(APP).toContain('role="progressbar"')
    expect(APP).toContain('aria-label="Page loading"')
    expect(TOKENS).toContain('.nav-progress-bar')
    expect(TOKENS).toContain('prefers-reduced-motion')
  })
})

// ---------------------------------------------------------------------------
// Per-Profile Timezone, Locale & Language (STEP 10). Source-text security guards.
const REGIONAL_CORE = readFileSync(resolve(__dirname, '../../src/shared/regional.ts'), 'utf8')
const REGIONAL_SVC = readFileSync(resolve(__dirname, '../../src/main/services/regional.ts'), 'utf8')
const SETTINGS = readFileSync(resolve(__dirname, '../../src/renderer/src/views/Settings.tsx'), 'utf8')

describe('Regional profiles (STEP 10)', () => {
  it('is NOT a fingerprint-spoofing / anti-detection system', () => {
    // Code-specific spoofing primitives (not prose): none may appear in regional code.
    const forbidden = [
      'navigator.webdriver',
      'getImageData',
      'toDataURL',
      'HTMLCanvasElement',
      'WebGLRenderingContext',
      'getParameter(',
      'new AudioContext',
      'randomizeFingerprint',
      'Math.random('
    ]
    for (const bad of forbidden) {
      expect(REGIONAL_CORE).not.toContain(bad)
      expect(REGIONAL_SVC).not.toContain(bad)
    }
  })

  it('timezone validation is delegated to the Intl runtime (no homemade DB)', () => {
    // Validation constructs an Intl.DateTimeFormat and relies on it throwing.
    expect(REGIONAL_CORE).toContain("new Intl.DateTimeFormat('en-US', { timeZone: v })")
    expect(REGIONAL_CORE).toContain('Intl.getCanonicalLocales')
    // Registry comes from the runtime, not a network request.
    expect(REGIONAL_CORE).toContain("supportedValuesOf")
    expect(REGIONAL_CORE).not.toMatch(/fetch\(|XMLHttpRequest|https?:\/\//)
  })

  it('capability is reported honestly (tz/locale PARTIAL, never faked as applied)', () => {
    expect(REGIONAL_CORE).toContain("locale: 'PARTIALLY_SUPPORTED'")
    expect(REGIONAL_CORE).toContain("timezone: 'PARTIALLY_SUPPORTED'")
    expect(REGIONAL_CORE).toContain("INVALID_CONFIGURATION")
    // UI surfaces the honest, layered statement.
    expect(SETTINGS).toContain('PROCESS-GLOBAL IN CHROMIUM')
    expect(SETTINGS).toContain('NOT FINGERPRINT PROTECTION')
  })

  it('applies language only via the capability-specific session API (no header interceptor)', () => {
    expect(REGIONAL_SVC).toContain('sess.setUserAgent(sess.getUserAgent(), accept)')
    // No generic network/header mutation.
    for (const bad of ['onBeforeSendHeaders', 'onHeadersReceived', 'webRequest', 'set-all-headers']) {
      expect(REGIONAL_SVC).not.toContain(bad)
    }
  })

  it('capability-specific IPC only — no generic execute/eval/shell', () => {
    expect(PRELOAD).toContain('channels.regionalApply')
    expect(REGISTER).toContain('channels.regionalApply')
    for (const bad of ['regional.execute', 'regional.run', 'regional.request', 'browser.execute', 'eval(', 'new Function(']) {
      expect(PRELOAD).not.toContain(bad)
      expect(REGIONAL_CORE).not.toContain(bad)
      expect(REGIONAL_SVC).not.toContain(bad)
    }
  })

  it('main applies the ACTIVE profile only (no cross-profile leakage)', () => {
    expect(REGISTER).toContain('const active = persist.loadProfilesIndex().activeProfile')
    expect(REGISTER).toContain('return ok(regional.apply(active))')
    expect(REGIONAL_SVC).toContain('assertSafeProfileId(profileId)')
  })

  it('profile isolation: regional caps reset on profile switch', () => {
    expect(STORE).toContain('regionalCaps: null')
    expect(STORE).toContain('void get().regionalApply()')
  })

  it('no unsafe primitives / page injection in regional code', () => {
    for (const bad of ['child_process', 'execFile(', 'fs.readFile', 'fs.writeFile', 'executeJavaScript', 'Date.prototype', 'Intl.DateTimeFormat =']) {
      expect(REGIONAL_CORE).not.toContain(bad)
      expect(REGIONAL_SVC).not.toContain(bad)
    }
  })

  it('regional settings are persisted via existing prefs (no second store)', () => {
    expect(STORE).toContain('get().persistPrefs()')
    expect(STORE).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
  })
})

// ---------------------------------------------------------------------------
// Dashboard Customization & Unified Browser Home (STEP 11). Source-text guards.
const DASHBOARD_CORE = readFileSync(resolve(__dirname, '../../src/shared/dashboard.ts'), 'utf8')
const NEWTAB = readFileSync(resolve(__dirname, '../../src/renderer/src/views/NewTab.tsx'), 'utf8')

describe('Dashboard control center (STEP 11)', () => {
  it('is a pure UI-composition layer — no backend engine / IPC / I/O in the core', () => {
    for (const bad of [
      'DashboardService',
      'DashboardAPI',
      'child_process',
      'require(',
      'import(',
      'fetch(',
      'window.nexa',
      'localStorage',
      'sessionStorage'
    ]) {
      expect(DASHBOARD_CORE).not.toContain(bad)
    }
    // No unsafe execution primitives anywhere in the dashboard layer.
    for (const bad of ['eval(', 'new Function(', 'executeJavaScript(', 'shell:']) {
      expect(DASHBOARD_CORE).not.toContain(bad)
      expect(NEWTAB).not.toContain(bad)
    }
  })

  it('treats persisted layout as untrusted input (validation on read)', () => {
    // Core exposes explicit validation + migration.
    expect(DASHBOARD_CORE).toContain('export function normalizeDashboardLayout')
    expect(DASHBOARD_CORE).toContain('export function migrateDashboardLayout')
    expect(DASHBOARD_CORE).toContain('DASHBOARD_LAYOUT_VERSION')
    // The New Tab view validates the persisted layout before rendering.
    expect(NEWTAB).toContain('normalizeDashboardLayout(p?.dash.visible)')
    // Store validates on hydrate and when writing a new layout.
    expect(STORE).toContain('migrateDashboardLayout(prof.dash?.visible, prof.dash?.v)')
    expect(STORE).toContain('visible: normalizeDashboardLayout(visible)')
  })

  it('per-profile persistence uses the existing profile index (no global storage)', () => {
    expect(STORE).toContain('void get().persistIndex()')
    expect(NEWTAB).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
  })

  it('consumes real existing state — never fabricates status', () => {
    // Reads existing store projections rather than inventing values.
    expect(NEWTAB).toContain('s.activeProtection()')
    expect(NEWTAB).toContain('s.turboState()')
    expect(NEWTAB).toContain('s.aiStatus')
    expect(NEWTAB).toContain('s.driveMeta')
    expect(NEWTAB).toContain('s.privacyReport')
    expect(NEWTAB).toContain('vpnUiProjection')
    // No fabricated marketing metrics / fake percentages.
    expect(NEWTAB).not.toMatch(/10x|10×|50% faster|faster than|1 second|guaranteed|Math\.random\(/i)
  })

  it('honest empty / not-configured states (no fake sample data)', () => {
    expect(NEWTAB).toContain('No downloads yet')
    expect(NEWTAB).toContain('No blocked requests yet')
    expect(NEWTAB).toContain("Drive isn't connected")
    expect(NEWTAB).toContain('No collections yet')
    expect(NEWTAB).toContain('No recent activity')
  })

  it('Worker widget preserves the confirm-to-submit workflow (no silent submit)', () => {
    expect(NEWTAB).toContain('workerScanPage()')
    expect(NEWTAB).toContain('setWorkerOpen(true)')
    // Dashboard must not auto-submit or fill without the existing confirm flow.
    expect(NEWTAB).not.toContain('submitForm')
    expect(NEWTAB).not.toContain('autoSubmit')
  })

  it('uses semantic design tokens, not hard-coded colors', () => {
    expect(NEWTAB).not.toMatch(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/)
    expect(NEWTAB).not.toContain('--text-1')
    expect(NEWTAB).toContain('var(--accent-2)')
  })

  it('is accessible (semantic headings, labelled sections/inputs)', () => {
    expect(NEWTAB).toContain('aria-label={title}')
    expect(NEWTAB).toContain('<h3')
    expect(NEWTAB).toContain('aria-label="Search or enter address"')
  })

  it('boots without network / AI / polling (deterministic, instant)', () => {
    for (const bad of ['setInterval(', 'fetch(', 'ollama']) {
      expect(NEWTAB).not.toContain(bad)
    }
  })

  it('integrates with the existing Command Palette (no duplicate systems)', () => {
    expect(APP).toContain("label: 'Open Dashboard'")
    expect(APP).toContain("label: 'Customize Dashboard'")
  })
})

/* --------------------------------------------------------------------------- */
/* STEP 12 — Multi-Provider AI: security & architecture source guards.          */
/* --------------------------------------------------------------------------- */

const AI_CORE = readFileSync(resolve(__dirname, '../../src/shared/ai-providers.ts'), 'utf8')
const AI_ADAPTERS = readFileSync(resolve(__dirname, '../../src/main/services/ai-provider-adapters.ts'), 'utf8')
const AI_REGISTRY = readFileSync(resolve(__dirname, '../../src/main/services/ai-registry.ts'), 'utf8')
const AI_SERVICE = readFileSync(resolve(__dirname, '../../src/main/services/ai.ts'), 'utf8')
const AI_CHANNELS = readFileSync(resolve(__dirname, '../../src/shared/channels.ts'), 'utf8')
const AI_SETTINGS = readFileSync(resolve(__dirname, '../../src/renderer/src/views/Settings.tsx'), 'utf8')

describe('Multi-Provider AI (STEP 12)', () => {
  it('provider core is pure (no Electron / IPC / network / secrets)', () => {
    // (`apiKey` legitimately appears once as the IPC validation field name.)
    for (const bad of ['electron', 'ipcMain', 'ipcRenderer', 'fetch(', 'safeStorage', 'process.env', 'child_process']) {
      expect(AI_CORE).not.toContain(bad)
    }
    // Deterministic routing / privacy / capability primitives are exported.
    expect(AI_CORE).toContain('export function routeAIRequest')
    expect(AI_CORE).toContain('export function planContextBudget')
    expect(AI_CORE).toContain('export function normalizeProfileAIConfig')
  })

  it('cloud endpoints are locked to known hosts (no arbitrary URLs)', () => {
    expect(AI_CORE).toContain('export function assertKnownHost')
    // Every cloud request in the adapters asserts the locked host first.
    expect(AI_ADAPTERS).toContain("assertKnownHost('openai'")
    expect(AI_ADAPTERS).toContain("assertKnownHost('anthropic'")
    // No generic fetch(url) proxy / execute bridge.
    expect(AI_ADAPTERS).not.toContain('ai.fetch')
    expect(AI_ADAPTERS).not.toContain('provider.execute')
  })

  it('no generic ai.execute / provider.execute / http bridge channels', () => {
    for (const bad of ['ai.execute', 'provider.execute', 'ai.fetch', 'http.request']) {
      expect(AI_CHANNELS).not.toContain(bad)
    }
    // IPC is capability-specific.
    expect(AI_CHANNELS).toContain("aiProviderConfigure: 'ai.provider.configure'")
    expect(AI_CHANNELS).toContain("aiConfigGet: 'ai.config.get'")
  })

  it('API keys never reach the renderer, localStorage/sessionStorage, or config JSON', () => {
    // Preload bridge forwards only opaque payloads; no key echo helpers.
    expect(PRELOAD).not.toMatch(/getApiKey|revealKey|readKey/i)
    // Renderer store never writes an API key into persistent/zustand state.
    expect(STORE).not.toMatch(/set\(\{[^}]*apiKey/)
    expect(STORE).not.toMatch(/localStorage|sessionStorage/)
    // The transient key is only forwarded to the main process, then cleared.
    expect(AI_SETTINGS).toContain('type="password"')
    expect(AI_SETTINGS).toContain('never retained')
  })

  it('keys are stored ONLY in SecureStorage (never in profile JSON)', () => {
    expect(AI_REGISTRY).toContain('this.secure.set(keyName(id)')
    // Config writer and key store are distinct paths; config file never gets a key.
    expect(AI_REGISTRY).toContain("join(dir, 'ai-config.json')")
    expect(AI_REGISTRY).not.toMatch(/writeJsonAtomic\([^)]*apiKey/)
  })

  it('adapters/registry/service never log prompts, keys or secrets', () => {
    for (const src of [AI_ADAPTERS, AI_REGISTRY, AI_SERVICE]) {
      expect(src).not.toMatch(/console\.log\([^)]*(apiKey|key|prompt|secret|Authorization)/i)
      expect(src).not.toContain('executeJavaScript(')
      expect(src).not.toContain('eval(')
    }
  })

  it('preserves the untrusted-content contract for every provider', () => {
    // The shared message builders (used for all providers) keep the injection guard.
    const AI_SHARED = readFileSync(resolve(__dirname, '../../src/shared/ai.ts'), 'utf8')
    expect(AI_SHARED).toContain('wrapUntrusted')
    expect(AI_SHARED).toContain('INJECTION_GUARD')
  })

  it('routing is done in the service, never by the model (deterministic)', () => {
    expect(AI_SERVICE).toContain('this.registry.route(')
    // The default (no-registry) path stays local-only Ollama for backward compat.
    expect(AI_SERVICE).toContain("providerId === 'ollama' || !this.registry")
  })
})

/* --------------------------------------------------------------------------- */
/* STEP 13 — Browser Extensions: security & architecture source guards.         */
/* --------------------------------------------------------------------------- */

const EXT_CORE = readFileSync(resolve(__dirname, '../../src/shared/extensions.ts'), 'utf8')
const EXT_SVC = readFileSync(resolve(__dirname, '../../src/main/services/extensions.ts'), 'utf8')
const EXT_CHANNELS = readFileSync(resolve(__dirname, '../../src/shared/channels.ts'), 'utf8')
const EXT_PRELOAD = readFileSync(resolve(__dirname, '../../src/preload/index.ts'), 'utf8')
const EXT_SETTINGS = readFileSync(resolve(__dirname, '../../src/renderer/src/views/Settings.tsx'), 'utf8')

describe('Browser Extensions (STEP 13)', () => {
  it('extension core is pure (no Electron / IPC / network / node fs)', () => {
    // ('electron' appears only as a forbidden host scheme string, never imported.)
    for (const bad of ["from 'electron'", "require('electron')", 'ipcMain', 'ipcRenderer', 'fetch(', 'child_process', "require('fs')", "from 'node:fs'"]) {
      expect(EXT_CORE).not.toContain(bad)
    }
    // Core exports the security-critical primitives.
    expect(EXT_CORE).toContain('export function validateManifest')
    expect(EXT_CORE).toContain('export function parseHostPermission')
    expect(EXT_CORE).toContain('export function classifyRisk')
    expect(EXT_CORE).toContain('export const FORBIDDEN_PERMISSIONS')
  })

  it('dangerous host schemes are rejected in the parser', () => {
    for (const scheme of ['file', 'chrome', 'devtools', 'electron', 'javascript', 'data']) {
      expect(EXT_CORE).toContain(`'${scheme}'`)
    }
    expect(EXT_CORE).toContain('FORBIDDEN_HOST_SCHEMES')
  })

  it('no generic extension execute / invoke / fetch / fs / shell bridge', () => {
    for (const bad of ['extension.execute', 'extension.invoke', 'extension.ipc', 'extension.fetch', 'extension.fs', 'extension.shell']) {
      expect(EXT_CHANNELS).not.toContain(bad)
      expect(EXT_PRELOAD).not.toContain(bad)
    }
    // IPC is capability-specific.
    expect(EXT_CHANNELS).toContain("extInstall: 'ext.install'")
    expect(EXT_CHANNELS).toContain("extSetEnabled: 'ext.setEnabled'")
  })

  it('the service never uses eval / child_process / shell / arbitrary JS', () => {
    expect(EXT_SVC).not.toMatch(/\beval\(/)
    expect(EXT_SVC).not.toContain('new Function')
    expect(EXT_SVC).not.toContain('child_process')
    expect(EXT_SVC).not.toContain('shell:')
    expect(EXT_SVC).not.toContain('executeJavaScript(')
    // Extensions load with file access disabled + no secret logging.
    expect(EXT_SVC).toContain('allowFileAccess: false')
    expect(EXT_SVC).not.toMatch(/console\.log\([^)]*(apiKey|secret|cookie|password|token)/i)
  })

  it('extension identity is validated main-side, never trusted from renderer', () => {
    expect(EXT_SVC).toContain('isValidExtensionId')
    // The install path validates the manifest BEFORE loading any code.
    expect(EXT_SVC).toContain('validateManifest')
    expect(EXT_SVC.indexOf('validateManifest')).toBeLessThan(EXT_SVC.indexOf('loadExtension('))
  })

  it('private mode is opt-in and profile-scoped (uses existing partitions)', () => {
    expect(EXT_SVC).toContain('canRunInPrivate')
    expect(EXT_SVC).toContain('persist:nexa-')
    expect(EXT_SVC).toContain('nexa-private-')
  })

  it('preload extension bridge exposes only metadata operations', () => {
    for (const op of ['list:', 'install:', 'setEnabled:', 'setPrivate:', 'setSiteAccess:', 'remove:']) {
      expect(EXT_PRELOAD).toContain(op)
    }
    // No key/secret echo helpers on the extension bridge.
    expect(EXT_PRELOAD).not.toMatch(/getApiKey|revealSecret|readVault/i)
  })

  it('Extensions manager UI is honest (no fake Web Store / no fake data)', () => {
    expect(EXT_SETTINGS).toContain('MANIFEST V3 · LOCAL UNPACKED ONLY')
    // The old hardcoded fake extension list is gone.
    expect(EXT_SETTINGS).not.toContain("name: 'Dark Reader'")
    expect(EXT_SETTINGS).not.toContain('Chrome Web Store')
    expect(EXT_SETTINGS).toContain('installExtension()')
  })
})
