# NEXA P0–P13 — Security Audit

*Audit only. No code modified. Findings trace real code paths; no speculative CVEs.*

## Runtime security configuration (verified)

`src/main/index.ts:78–85` — `sandbox:true`, `contextIsolation:true`,
`nodeIntegration:false`, `webSecurity:true`, `webviewTag:true`.
CSP (`index.ts:28–39`, applied to app frames `:88–96`): `default-src 'self'`,
`script-src 'self'` (no `unsafe-inline` for scripts), `object-src 'none'`,
`frame-src 'none'`, `connect-src 'self'`, `base-uri 'self'`, `form-action 'self'`.
`setWindowOpenHandler` denies all and routes only `http/https` to
`shell.openExternal` (`:104–109`).

## Static search results (repository-wide)

| Pattern | Result | Classification |
|---------|--------|----------------|
| `eval(` / `new Function` | **none** in `src` | clean |
| `executeJavaScript` | renderer→`<webview>` + `injectCredential` (main) | controlled (fixed templates) |
| `child_process`/`execFile`/`spawn` | only VPN helper + `vpn-platform/base.ts`, both `shell:false` | controlled |
| `shell:true` | **none** | clean |
| `exec(` | regex `.exec` + agent `exec(tool,args)` dispatcher | not shell |
| web storage (`localStorage`/`sessionStorage`/`indexedDB`) | **none** in renderer | clean |
| sensitive `console.*` (key/token/secret/password) | **none** | clean |
| `as any` / `@ts-ignore` / `@ts-nocheck` | **0 / 0 / 0** | clean |

### `executeJavaScript` — data-flow verdict
- `injectCredential` (`register.ts:109–140`): FIXED snippet template; username/secret
  are `JSON.stringify`-escaped into the code string; result returns only booleans;
  the secret never crosses back to renderer/AI/IPC.
- Agent tools (`App.tsx executeAgentTool`, `runJs`): a **fixed `switch`** of semantic
  actions; model-supplied arguments (eids/text) are `JSON.stringify`-escaped into
  fixed templates. No path executes raw model JavaScript (`args.code/script/js` →
  **none**). Verdict: AI plans → NEXA authorizes → Chromium executes fixed actions.

## Secret handling (verified)

- `SecureStorage` wraps Electron `safeStorage` (`secure-storage.ts:15–32`).
- AI provider keys: `secure.set('ai.key.<id>')`; read only for cloud, passed
  per-call to adapters (`ai-registry.ts:105–149`); never returned to renderer.
- Drive OAuth tokens: `secure.set(TOKEN_KEY(profileId))` (`drive.ts:103`);
  `getStatus` returns only `{state, connected, email, displayName}` — never tokens
  (`drive.ts:119–125`). Bearer used only in main-side `fetch`.
- Vault: PBKDF2 + AES-GCM + safeStorage; `injectCredential` keeps secrets in main.
  `passwordManager.reveal`/`copySecret` return/copy a secret **only on explicit
  user action against an unlocked vault** (by design).
- Deny firewall (`register.ts:1085–1090`): AI/cloud/extension → vault channels always
  throw `denied`.

## Threat register

| Threat | Attack surface | Current protection | Evidence | Residual risk | Recommendation |
|--------|----------------|--------------------|----------|---------------|----------------|
| Renderer RCE via Node | renderer | sandbox + contextIsolation + nodeIntegration off + no ipcRenderer exposure | index.ts:78–85; preload:209 | Low | keep |
| Arbitrary JS from model (agent) | agent tools | fixed switch + JSON-escaped args; no `args.code` path | App.tsx executeAgentTool | Low | keep |
| Secret exfiltration to renderer | IPC | keys/tokens stay in main; status is metadata-only | ai-registry, drive.ts | Low | keep |
| Vault password leak | autofill | fixed-snippet inject; secret never returned | register.ts:109–140 | Low | keep |
| Cross-profile data leak | sessions/persistence | per-profile partitions + `assertSafeProfileId` at every service | 11 services | Low | keep |
| Private-mode persistence | sessions | in-memory `nexa-private-<id>` partition | downloads/protection/extensions | Low | keep |
| Extension escalation | extension runtime | Chromium sandbox, `allowFileAccess:false`, no `nexa.*`, capability IPC | extensions.ts | Low | keep |
| **Device permissions on tabs** | geolocation/camera/mic | `setPermissionRequestHandler` set **only on defaultSession** | index.ts:122 | **Medium** | install handler + `setPermissionCheckHandler` on profile partitions |
| External protocol / popups | window.open, protocols | window-open denied; only http/https → external | index.ts:104–109 | Low | consider guarding `openExternal` scheme allowlist (already http/https) |
| Runtime CVEs | Electron 37 | see Dependencies (npm audit) | audit output | Medium | plan Electron upgrade phase |

### Finding SEC-1 (P2 / Medium) — permission policy not applied to tab partitions
`setPermissionRequestHandler` is installed on `session.defaultSession`
(`index.ts:122–124`), but tab web content runs in `persist:nexa-<id>` /
`nexa-private-<id>` partitions (`App.tsx:1282`). Those partitions have **no**
explicit permission request/check handler, so geolocation/camera/microphone/etc.
requests from live sites fall back to Electron defaults instead of NEXA's
restrictive policy. **Not a confirmed leak**, but the intended policy is not
enforced where content actually runs. *Recommended future action:* register the
same `setPermissionRequestHandler` (and `setPermissionCheckHandler`) on each
profile partition during attach. (Documented only — not fixed, per audit rules.)

### Finding SEC-2 (P2 / Medium, dependency) — Electron/extract-zip advisories
`npm audit` reports 4 (2 high `extract-zip` symlink traversal, transitive of
electron-builder/electron; + Electron advisories). Fix requires Electron 44 (major,
breaking). `extract-zip` is a build/packaging-time transitive, not shipped in the
renderer. Electron advisories are mitigated in-app (no arbitrary `window.open`,
external protocols via `shell.openExternal` limited to http/https, sandbox on).
*Recommended future action:* dedicated dependency-upgrade phase; do not auto-fix.

## No accidental secrets committed
Searches for API keys / client secrets / private keys / OAuth tokens / WireGuard
private keys returned only **variable names / schema fields / env-var references**
(e.g. `NEXA_GOOGLE_CLIENT_ID`), no literal secret values. Clean.
