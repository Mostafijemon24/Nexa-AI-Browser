# NEXA STEP 13 — Extension Architecture Audit

*Source-of-truth audit performed before implementation. Repository code +
installed Electron typings are authoritative.*

## 1. Runtime & rendering

| Aspect | Finding |
|--------|---------|
| Electron | `^37.4.0` (installed `37.10.3`) → Chromium ~130 |
| Rendering surface | Web pages render in `<webview partition="persist:nexa-<id>">` (`App.tsx` `createElement('webview', …)`), `webviewTag: true`. Main window: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`, CSP applied to app frames. |
| Per-profile sessions | `persist:nexa-<id>` (persistent) and `nexa-private-<id>` (in-memory). Services attach via `session.fromPartition(...)` (downloads, protection, regional). |
| Extension API | Electron 37 exposes **`session.extensions`** (`loadExtension(path, {allowFileAccess})`, `removeExtension(id)`, `getExtension(id)`, `getAllExtensions()`, events `extension-loaded`/`ready`/`unloaded`). Confirmed in `electron.d.ts` (class `Extensions`). |

**Key consequence:** because tabs are `<webview>`s bound to a per-profile
partition, an extension loaded into that partition's `session.extensions` will
apply its content scripts / action to those tabs. A **real** runtime is feasible,
scoped per profile via existing partitions — no new rendering surface needed.

## 2. Electron/Chromium extension capability (honest)

Electron implements a **subset** of the Chrome Extensions API and only supports
**unpacked** extensions (no `.crx`, no Web Store, no signature/auto-update).
Support is best-effort and version-dependent. This phase treats capability as:
`SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED` and never claims full Chrome
compatibility. Detailed per-API status → `NEXA_STEP_13_EXTENSION_COMPATIBILITY.md`.

Notable realities:
- **MV3 background service workers**: supported by modern Electron; lifecycle is
  Chromium-managed (we never fake it).
- **Content scripts**: supported for the extension's session; run in an isolated
  world (no Node, no `window.nexa`).
- **Action popups**: Electron does **not** auto-render a toolbar popup for
  `<webview>` embedders → PARTIALLY_SUPPORTED (metadata/click surfaced; hosted
  popup UI is a documented limitation this phase does not fully render).
- **`chrome.storage`/`runtime`/`i18n`/`alarms`**: generally supported.
- **`webRequest`/`declarativeNetRequest`**: partial; **P3 Protection remains
  authoritative** (documented precedence).
- **`tabs`/`scripting`/`cookies`/`downloads`/`history`/`bookmarks`**: partial or
  unsupported depending on Electron; reported honestly, never faked.

## 3. Existing invariants to preserve

- Sandboxed renderer, `contextIsolation`, `nodeIntegration=false`,
  `webSecurity=true`, CSP, typed + Zod-validated + main-authorized IPC.
- Profile isolation (`assertSafeProfileId`, per-profile dirs + partitions),
  private partitions (non-persistent), P2 downloads engine, P3 protection,
  P4 VPN (helper socket + safeStorage keys), P5/P12 AI + provider keys,
  P6 Vault crypto + autofill, P7 Privacy, P8 Drive OAuth, P9 Turbo,
  P10 Regional, P11 Dashboard.
- Service pattern: `persist.profileDir(id)` + `readJsonSafe`/`writeJsonAtomic`;
  events pushed to renderer over a dedicated channel.

## 4. IPC / preload

- `channels.ts` central registry; `register.ts` `ipcMain.handle` with Zod parse +
  `ok()/err()` wrapper; `preload/index.ts` exposes namespaced `window.nexa.*`;
  `nexa.d.ts` types. Extensions must add a **capability-specific** namespace only
  — no generic `extension.execute/invoke/ipc/fetch/fs/shell`.

## 5. Security posture for extensions (design)

- Extensions run inside the **Chromium sandbox** of the profile session; they get
  the standard `chrome.*` subset only. They **never** receive `window.nexa`, Node,
  filesystem, shell, IPC, vault secrets, VPN keys, AI provider keys, or Drive
  OAuth tokens.
- NEXA does **not** expose a `nexa.*` bridge to extensions in this phase (safest
  default). If ever added, it must be capability-scoped with schemas + risk class.
- Renderer-provided extension IDs are **never trusted**; the main process is the
  authority (validates manifest + resolves identity from the loaded `Extension`).
- Install is explicit: local unpacked folder → validate manifest → permission
  review → user confirm → load. No silent/remote install, no Web Store.
- Private mode: extensions are **disabled by default**; only loaded into the
  private partition when the user explicitly enables per-extension private access.

## 6. STEP 13 plan (additive)

1. Pure core `src/shared/extensions.ts`: MV3 manifest validator, permission
   taxonomy + risk classification, host-permission parser/normalizer + match
   validation (reject `file:`/`chrome:`/`devtools:`/`javascript:`/`data:`),
   lifecycle state machine, extension record/identity types, honest support/state
   enums, source types, private-mode + site-access policy. Fully unit-tested.
2. Main `ExtensionService`: per-profile persisted records (`extensions.json`),
   install/validate/enable/disable/remove via a `session.extensions` provider
   (injectable → testable without Electron), private-mode gating, failure
   isolation, honest health. No second download engine; protection stays
   authoritative.
3. Capability-specific IPC + preload + `nexa.d.ts` (metadata only).
4. UI: Settings → Extensions manager (dense list, install local, permission
   review, site access where supported, private toggle), Dashboard widget,
   palette commands, Click-to-Go, compact extensions menu.
5. Minimal real MV3 test extension (`test-extension/`).
6. Tests + source guards + docs (COMPATIBILITY, SECURITY_AUDIT, TEST_MATRIX,
   FINAL) + rolling-audit updates.
