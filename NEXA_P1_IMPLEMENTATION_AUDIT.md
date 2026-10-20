# NEXA P1 Implementation Audit

**Date:** 2026-09-15
**Scope:** Complete the remaining P1 browser foundation — session restore, bookmarks, history, collections, command-palette integration, pixel refinement, tests. No architecture rewrite. No visual redesign. No fake functionality.

## Current architecture (authoritative from code)

| Layer | File(s) | Notes |
|---|---|---|
| Main entry | `src/main/index.ts` | Sandbox + CSP + `webviewTag` on; per-profile `persist:nexa-<id>` partitions via renderer `<webview>` |
| Platform | `src/platform/*` | `PlatformAdapter` × mac/win/linux; `assertSafeProfileId` |
| Persistence | `src/main/services/persistence.ts` | File-based JSON per profile: `prefs.json`, `session.json`, `vault.json`; global `global.json`; index `profiles.json`. **Non-atomic** `writeFileSync`. |
| Vault | `src/main/services/vault.ts`, `src/core/vault-crypto.ts` | PBKDF2 210k + AES-GCM, key sealed to `safeStorage`. Isolated. |
| IPC | `src/main/ipc/register.ts`, `src/shared/ipc.ts` | Capability channels registry, `wrap()` safe errors, zod validation, profile-id validation server-side. Firewall channels deny AI/cloud/ext → vault. |
| Preload | `src/preload/index.ts` | Narrow `window.nexa` API. No `fs`/`shell`/`child_process` exposed. |
| Renderer state | `src/renderer/src/state/store.ts` | zustand. `SessionState = {tabs, activeTab, workspaces}`. `navigate()` mutates active tab URL. |
| Renderer UI | `src/renderer/src/App.tsx`, `views/NewTab.tsx`, `views/Settings.tsx` | Browser shell, overlays, Settings full page. |
| Design tokens | `src/renderer/src/design-system/*` | Semantic CSS vars, runtime accent-mix, light/dark, radius/density/motion. |
| Tests | `tests/unit/vault-crypto.test.ts` | Vault crypto + profile-id validation. vitest node env. |

## Existing IPC channels
`app.getInfo`, `window.*`, `settings.load|saveGlobal|saveProfile|saveProfilesIndex`, `session.save`, `downloads.pickDirectory`, `shell.openExternal`, `secureStorage.available`, `passwordManager.*`, `firewall.*`.

## Placeholder / gap inventory (what P1 fixes)

| Area | Current state | P1 action |
|---|---|---|
| Session restore | `session.json` saved but **unversioned, non-atomic, weakly validated**; no crash recovery; no status; no reopen-closed; no pin | Versioned schema (v2) + atomic write + `.bak` recovery + validation/migration + reopen-closed stack + pin + session status |
| Bookmarks | Placeholder page; toolbar star = dead toast ("not implemented") | Real main-process service: tree (bar/other + nested folders), CRUD, move/reorder, search, bar, manager, Netscape import/export |
| History | Placeholder page; navigation never recorded | Real service; record on real navigation; search; date grouping; delete item; clear range/all; private exclusion |
| Collections | Placeholder page | Real service: create/rename/delete, add/remove/reorder items, open-all; profile-scoped |
| Command palette | Static list, some real actions | Add bookmark/history/collections/session commands calling real services |
| Dropdowns | Settings uses native `<select>` (acceptable/accessible); no custom dropdown that "changes on click" bug | Keep native select; add accessible custom dropdown only where needed |
| Toolbar star | Dead | Bookmark current page (⌘D), filled when bookmarked |

## Honest states that MUST remain truthful (do not fake)
VPN → Not configured · Downloads → engine not configured · AI → not configured · Cloud → not configured · Filter → 0 / not configured · Extensions → host not configured · Updates → real only.

## Storage decision
Keep the existing **file-based JSON per profile** architecture (no new DB). Add per-profile files: `bookmarks.json`, `history.json`, `collections.json`. Introduce **atomic writes** (`tmp`+rename, `.bak` fallback) applied to all persistence including session. Profile isolation is inherent: every file lives under `platform.profileDir(profileId)` and `profileId` is validated server-side.

## Security plan
- All new IPC validated with zod; profile IDs re-validated in main.
- Imported bookmark HTML parsed with a **non-executing, line-based Netscape parser** (no DOM, no eval); every URL validated to `http(s):` before persistence or navigation.
- Bookmarks/history/collections services have **no access** to the vault. Vault stays isolated.
- No new generic IPC (`readFile`/`execute`). No secrets logged. Errors returned via `wrap()` remain user-safe.
- Private tabs excluded from history.

## Pure-logic extraction (for testability without Electron)
- `src/shared/session.ts` — `SESSION_VERSION`, schema, `migrateSession`, `toSessionState`/`fromSessionState`.
- `src/shared/library.ts` — bookmark/history/collection types + zod schemas, `validateBookmarkUrl`, `parseNetscape`, `serializeNetscape`, tree/search helpers, empty factories.
- `src/main/services/library.ts` — file IO (atomic) wrapping the pure logic.
- `src/main/services/fs-atomic.ts` — `writeJsonAtomic`, `readJsonSafe` with `.bak` recovery.

## Implementation order
P1.1 session → P1.2 bookmarks → P1.3 history → P1.4 collections → P1.5 palette → P1.6 pixel → P1.7 QA. Tests added per slice. Final: `NEXA_P1_FINAL_AUDIT.md` + status block.
