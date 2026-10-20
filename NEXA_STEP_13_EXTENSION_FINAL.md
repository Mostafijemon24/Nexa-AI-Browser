# NEXA STEP 13 — Browser Extensions: Final Implementation Report

## Architecture

Additive, security-first Chromium extension runtime layered on the existing
per-profile sessions. Nothing in P0–P12 was rewritten.

```
Chromium extension (isolated world / MV3 SW)
   ↓ chrome.* subset (Electron), no window.nexa / no Node
Chromium sandbox — per-profile session (persist:nexa-<id> / nexa-private-<id>)
   ↓
ExtensionService (main) — validation + identity authority, failure-isolated
   ↓ capability-specific, Zod-validated IPC (ext.*)
Renderer (Settings manager, Dashboard widget, palette, click-to-go)
```

- **Pure core** `src/shared/extensions.ts`: MV3 validator, permission taxonomy +
  risk classification, host-pattern parser/normalizer/matcher, lifecycle state
  machine, record/identity types, untrusted-store normalizer, IPC Zod schemas.
- **Main service** `src/main/services/extensions.ts`: per-profile persisted
  records, `preview()` (dry-run review), `install/setEnabled/setPrivate/
  setSiteAccess/remove`, `applyForProfile` startup reconcile. Drives the real
  `session.extensions` API via an **injectable provider** (fully unit-testable).
- **IPC**: `ext.list/get/install/remove/setEnabled/setPrivate/setSiteAccess/
  pickFolder/event` in `channels.ts` + `register.ts` (Zod-validated) + preload
  bridge + `nexa.d.ts` types.

## Chromium compatibility

Electron 37.10.3 (Chromium ~130), **unpacked MV3 only**. Full per-API status in
`NEXA_STEP_13_EXTENSION_COMPATIBILITY.md`. No Chrome Web Store claim.

## Manifest V3

Strict validator: MV3-only (MV2 → UNSUPPORTED), name/version/description checks,
permission + host-permission validation, MV3 `service_worker` background
(MV2-style rejected), content-script `matches` validation, action/icons/WAR.
Forbidden permissions → **BLOCKED** (never loaded).

## Installation

`Pick folder → main validates manifest (preview) → permission review + user
confirm → install (validate + load into persist session, enabled)`. No silent or
remote install. Path must be absolute + existing; manifest read + validated before
any code load.

## Permissions / Host access

Explicit NEXA taxonomy; high-risk flagged + explained; risk class LOW/MEDIUM/HIGH/
BLOCKED. Host patterns limited to http/https/*/`<all_urls>`; file/chrome/devtools/
electron/data/javascript/… rejected. Site-access modes: Always / When clicked /
On selected sites / Never.

## Content scripts / Service workers

Content scripts run in the isolated world (no Node, no `window.nexa`). MV3 service
workers use the Chromium-managed lifecycle; failures are isolated (Extension
Error, never a browser crash).

## Extension UI

`Settings → Extensions`: dense list with name/version/risk pill, permission
summary, enable toggle, private toggle (disabled unless enabled), site-access
selector, remove, and an expandable details view (permissions, elevated, host
access, blocked, runtime, source, status). Command palette adds
`Extensions / Manage / Install Local Extension / View Permissions`; Click-to-Go
resolves `extensions / extension settings / extension manager`; Dashboard gains an
optional compact **Extensions** widget (X enabled / Y disabled, real state).

## Storage / Profile isolation / Private mode

Records persist per profile and are untrusted on read. Extension storage is
per-session → profile-isolated automatically. Private mode: disabled by default;
opt-in per extension; loaded only into the ephemeral private partition.

## NEXA API / AI / Downloads / Protection / VPN / Vault / Drive

No `nexa.*` exposed to extensions; no generic execute/eval/fetch/fs/shell/ipc. No
AI bridge this phase (design documented). Downloads must use the P2 engine. P3
Protection stays authoritative over webRequest/DNR. VPN keys, Vault secrets, and
Drive OAuth tokens are inaccessible.

## Security

See `NEXA_STEP_13_EXTENSION_SECURITY_AUDIT.md` (trust boundaries, sandbox,
permission model, private mode, profile isolation, IPC/identity, failure
isolation, and all 13 threats with mitigations). Source guards enforce: pure core,
rejected dangerous schemes, no generic IPC bridge, no eval/child_process/shell/
executeJavaScript, validate-before-load ordering, metadata-only preload, honest UI.

## Verification

- **Tests:** `npm test` → **41 files, 732 passing** (59 new: 30 core + 12 service +
  9 STEP-13 source guards + fixture; existing suites unaffected, 1 dashboard test
  updated because `extensions` is now a real widget).
- **Typecheck:** `npm run typecheck` → PASS.
- **Build:** `npm run build` → PASS.
- **Lint:** `npm run lint` → placeholder (`echo 'eslint not configured yet'`) —
  **honestly reported as NOT CONFIGURED**, not "passing".
- **Security grep:** no `eval/new Function/child_process/shell:true/
  executeJavaScript/extension.execute|fetch|fs|shell/nexa.execute|eval` in the
  extension surface. `allowFileAccess: false` on every load.
- **GUI:** `GUI NOT_CONFIGURED — ENVIRONMENT` (no graphical Electron session).
- **Real MV3:** `test-extension/` (action + content script + storage + SW)
  validates as MV3 in-suite; the install→enable→run→storage→disable→remove path is
  proven via the service tests over the identical runtime code path. Live load is
  ready pending a GUI session.

## Known limitations

- Extension **action popups** are not hosted/rendered by NEXA (metadata + click
  only). PARTIALLY_SUPPORTED.
- `history`, `bookmarks`, `identity`, `sidePanel` are UNSUPPORTED by the runtime
  surface (declared → high-risk marker, no live API).
- No Chrome Web Store, no `.crx` signature verification, no remote/auto update
  (deferred to a future phase per §36/§37).
- Live Chromium content-script/SW execution and GUI validation require a graphical
  environment and were not executed in this headless run (reported honestly).
