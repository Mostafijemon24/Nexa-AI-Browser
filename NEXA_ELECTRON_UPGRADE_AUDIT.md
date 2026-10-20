# NEXA — Electron Upgrade Audit (SEC-2)

## Objective
Resolve the runtime dependency advisories flagged in the P0–P13 audit by moving
off Electron 37, without weakening any security invariant or rewriting
architecture.

## Baseline vs target

| | Before | After |
|---|--------|-------|
| Electron | 37.10.3 | **44.4.1** (latest stable) |
| Chromium | ~130 | ~140 (bundled with Electron 44) |
| Node (bundled) | 22.x | 24.x (`@types/node@24`) |
| Node (dev host) | 24.17.0 | 24.17.0 |
| extract-zip | vulnerable transitive | replaced by `@electron-internal/extract-zip` fork |

Note: `electron@37`'s latest patch is 37.10.3 — there is **no** 37.x patch that
clears the advisories; the fix line is Electron 44+.

## Why 44 (not a smaller bump)
`npm audit` remediation pointed to `electron@44.4.1`. Electron 44 is the version
that (a) ships the patched internal extract-zip fork and (b) carries the Chromium
security fixes behind the reported Electron advisories (redirect→file loader,
window.open feature string, sandboxed-iframe popup/external-protocol, DevTools
shell-open, contextBridge prototype setters, DevTools dock-state injection).

## API surface actually used by NEXA (compatibility matrix)

All symbols are long-stable Electron core APIs. Verified against Electron 44's
bundled `electron.d.ts` via `npm run typecheck`.

| API | Used in | Electron 44 status |
|-----|---------|--------------------|
| `app`, `BrowserWindow`, `powerMonitor` | main/index | unchanged |
| `session.defaultSession`, `session.fromPartition` | index, services | unchanged |
| `session.extensions.*` (loadExtension, allowFileAccess) | extensions | present (added E35), unchanged |
| `webRequest.onHeadersReceived` / protection | index, protection | unchanged |
| `setPermissionRequestHandler` / `setPermissionCheckHandler` | security/permissions | unchanged |
| `setWindowOpenHandler` | index | unchanged |
| `will-download` / `DownloadItem` | downloads | unchanged |
| `safeStorage.{isEncryptionAvailable,encryptString,decryptString}` | secure-storage | unchanged |
| `contextBridge.exposeInMainWorld`, `ipcRenderer.invoke/on` | preload | unchanged |
| `ipcMain.handle`, `dialog`, `shell`, `Notification`, `webContents` | ipc/services | unchanged |
| **`clipboard.*`** | vault | **BREAKING → now async (Promise-based)** |

### Breaking change found & fixed
Electron 44 made the entire main-process `clipboard` module **asynchronous**
(`readText()/writeText()/read()/write()/has()` now return Promises).

- Affected code: `src/main/services/vault.ts` `copySecret()` (copy password to
  clipboard + auto-clear after 30 s).
- Fix: `copySecret` is now `async`; `await clipboard.writeText(...)`, and the
  30 s auto-clear reads/clears via the Promise API. The IPC handler
  (`vaultCopy` in `register.ts`) now `await`s `copySecret`.
- Renderer clipboard usage is unaffected — it uses the browser
  `navigator.clipboard` API (already async/awaited).

No other breaking change affected NEXA's surface.

## Security invariants — re-verified post-upgrade
`sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`,
`webSecurity:true` (index.ts:82–85); strict CSP unchanged; typed IPC + Zod
unchanged; `safeStorage` unchanged; profile isolation unchanged; extension
`allowFileAccess:false` on every load (extensions.ts:184–293). No downgrade.

## Dependency security after upgrade

`npm audit`: **2 moderate** remaining, both `vitest`/`@vitest/mocker`
(GHSA-82fw-gwwq-j7x9, path traversal via mock redirect).

| Package | Severity | Direct/Transitive | Exploitability | Remediation |
|---------|----------|-------------------|----------------|-------------|
| `@vitest/mocker` / `vitest` | moderate | dev-only (test runner) | Not shipped in the app; only affects the local test process | `vitest@5` (breaking) — defer to a test-tooling upgrade |

The **runtime** advisories (Electron + extract-zip) are fully resolved. Remaining
advisories are dev/test-only and never ship in the packaged product.

## Verification (headless)

| Check | Result |
|-------|--------|
| `npm run typecheck` (vs Electron 44 types) | PASS |
| `npm run lint` | PASS (0/0) |
| `npm test` | 746/746 PASS |
| `npm run build` | PASS |

## Environment limitation (must validate before release)
The Electron 44 **binary was not downloaded** in this environment
(`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), and there is no display, so runtime/GUI
behavior on Chromium ~140 was **not** exercised. Compile-time + bundling +
unit/service compatibility is proven; **runtime/GUI validation on Electron 44 is
BLOCKED — ENVIRONMENT** and is a required release gate (launch, webview render,
extension load, downloads, permission prompts, clipboard copy path).
