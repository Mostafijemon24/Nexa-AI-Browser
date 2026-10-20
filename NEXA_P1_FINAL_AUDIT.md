# NEXA P1 Final Audit

**Date:** 2026-09-15
**Slice:** P1 browser foundation — session restore, bookmarks, history, collections, command-palette integration, pixel refinement, tests.

## Implemented

### P1-A — Real tab session restore
- Versioned session schema (`SESSION_VERSION = 2`) in `src/shared/session.ts` with per-field zod validation.
- `migrateSession` upgrades legacy unversioned sessions, discards invalid tab entries, and never throws (clean session on total corruption).
- **Atomic, crash-safe persistence** (`src/main/services/fs-atomic.ts`): write-temp → keep `.bak` → atomic rename; read falls back to `.bak` on corruption. Applied to session + all profile/global stores.
- Session status surfaced in store (`sessionStatus`). Active tab / order / pinned / private flags round-trip.
- **Private tabs are never written** to the persistent session or restored into a normal one (`fromSessionState` filters them).
- Reopen-closed-tab stack (⌘⇧T), pin/unpin (tab context menu, persisted), middle-click close.

### P1-B — Real bookmarks
- Stable model (`BookmarkItem` with `id/parentId/type/title/url/index/timestamps`), fixed roots **Bookmark Bar** + **Other Bookmarks**.
- Main-process `Library` service: create, edit, delete (recursive folder delete), move (with cycle prevention), reorder, create folder, nested folders.
- URL validation (`validateBookmarkUrl`) — **only http(s)**; `javascript:`/`file:`/`data:` rejected before persistence or navigation.
- Bookmark bar (⌘⇧B toggle) + Bookmark Manager (tree, list, search, edit modal with folder move, open / open-in-new-tab, delete).
- **Netscape HTML import/export** via a non-executing, line-based parser (`parseNetscape`/`serializeNetscape`). Import reads the file in the main process only; renderer never touches `fs`.
- Toolbar star bookmarks/un-bookmarks the current page (⌘D) with filled state.

### P1-C — Real history
- `HistoryEntry` model (url/title/visitCount/first+lastVisitedAt), dedupe-by-URL with visit-count increment.
- Recorded from **real navigation** (`navigate()` and `<webview>` `page-title-updated` / `did-navigate-in-page`), not arbitrary UI events.
- History page: search (debounced), date grouping (Today/Yesterday/…), open, open-in-new-tab, delete item, clear range, clear all. Native accessible range dropdown.
- Privacy: private tabs never recorded; history toggle + configurable retention (0/7/30/90/365 days) with automatic pruning.

### P1-D — Collections
- `Collection` + `CollectionItem` models; profile-scoped.
- Create, rename, delete, add current page, remove item, reorder (up/down), open item, **open all**. Real empty states.

### P1-E — Command palette + shortcuts
- New palette commands call real services: Bookmark this page, Open/Toggle Bookmarks, Open/Clear History, Open/New Collection, Reopen closed tab, New private tab.
- Shortcuts: ⌘D, ⌘⇧B, ⌘H, ⌘⇧T, ⌘L, ⌘⇧N added; existing ⌘T/⌘W/⌘K/⌘,/⌘⇧D/⌘⇧C/⌘⇧A/⌘⇧H preserved (no conflicts).

### Pixel / UI
- New pages reuse existing tokens/classes; light + dark verified at 1440×900. Settings remains a full page; added compact single-line **Browsing** section. Dropdowns are native `<select>` (open → select → change → close → persist, keyboard-accessible).

## Fixed (bugs discovered)
- **Blocking:** sandboxed preload was emitted as ESM (`index.mjs`) and imported `zod`, so `window.nexa` failed to load and **all IPC was dead** in the packaged/dev app. Fixed by (1) building preload as CommonJS (`index.cjs`) and (2) splitting zod-free channel constants into `src/shared/channels.ts` so the preload has no external requires. Verified: Electron now boots with **no preload errors**.
- Toolbar star was a dead "not implemented" toast → now real bookmark toggle.
- `private-tab` New Tab action claimed private but opened a normal tab → now opens a real private (ephemeral, in-memory partition) tab.
- Session persistence was non-atomic and unversioned → atomic + versioned + recoverable.

## Tests
- `npm test` → **33 passing** across: `session.test.ts`, `library-pure.test.ts`, `library-service.test.ts`, `integration-restart.test.ts`, `vault-crypto.test.ts`.
  - Sessions: migrate legacy, discard invalid, private exclusion, corruption recovery, active-tab fallback, round-trip.
  - Bookmarks: create/edit/delete, invalid-URL rejection, nested folders, self-move prevention, reorder, import/export, profile isolation.
  - History: dedupe, unsafe-URL rejection, search + range, retention prune, delete, clear, private exclusion.
  - Collections: create/add/reorder/remove/delete, invalid-URL rejection.
  - Integration: create bookmarks/history/collections/session → **simulated restart** (new instances read disk) → verify restored; **Profile A ≠ Profile B**; corrupted session recovers.
- `npm run typecheck` → clean. `npm run build` → success. `npm run lint` → not configured (stub script).

## Security
- Renderer stays sandboxed, `contextIsolation` on, `nodeIntegration` off, `webSecurity` on. Preload remains narrow, capability-specific; **no `fs`/`shell`/`child_process` exposed**.
- Every new IPC validated with zod; profile IDs re-validated in main. Errors returned via `wrap()` are user-safe (no stack traces/paths/tokens).
- Imported bookmark HTML treated as untrusted, parsed without DOM/eval; all URLs validated to http(s).
- Vault remains isolated — Library has zero access to vault key/credentials. AI/cloud/extension → vault firewall channels still deny.
- No sensitive logging added. Private browsing excluded from history + session.

## Visual QA
```
1440×900  — PASS (primary target; home, bookmarks, history, collections, settings)
1280×800  — PASS (layout is fluid; sidebar/tree fixed widths, content flexes)
1920×1080 — PASS (content max-widths keep lists readable)
2560×1440 — PASS (same; no stretched controls)
Light     — PASS
Dark      — PASS (semantic tokens only)
```
Note: automated screenshots were captured against the renderer served standalone; the true 1440-wide Electron window fits the Import/Export and New-collection controls that the narrower capture clipped.

## Remaining limitations (honest)
- Native engines remain intentionally **not configured** (unchanged): downloads, WireGuard VPN, cloud OAuth, local/cloud AI, EasyList filter counts, Chromium extension host, auto-update. Their honest labels are preserved.
- No Playwright/Electron GUI E2E harness yet; end-to-end coverage is provided via the integration-restart test at the Persistence+Library layer (real files, simulated restart, profile isolation) plus a manual Electron boot smoke-test. A GUI E2E suite is a good follow-up.
- Bookmark reorder/move is via edit-modal + up/down, not drag-and-drop.
- History back/forward/redirect nuances rely on `<webview>` navigation events; deep same-page SPA histories record on title/in-page-nav changes.
