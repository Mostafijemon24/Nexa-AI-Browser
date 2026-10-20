# NEXA P2 — Native Download Engine Audit

**Date:** 2026-09-15
**Slice:** Replace the honest "Downloads → not configured" placeholder with a real native download engine built on Electron/Chromium download primitives. No P1 rewrite, no shell redesign.

## Existing download-related code

| Location | Current state |
|---|---|
| `src/services/downloads/index.ts` | `downloadEngine.status() => 'not_configured'` — **dead** (never imported). To be removed. |
| `src/renderer/src/App.tsx` `Content` | `tab.view === 'downloads'` → `PlaceholderPage` "DOWNLOAD ENGINE NOT CONFIGURED". |
| Toolbar (`App.tsx:433`) | "Detected downloads" button opens `DetectPopover` overlay (fake "no files detected"). |
| `DetectPopover`, `DestPicker` overlays | Placeholder popovers. `DestPicker` (`overlay==='dest'`) has **no trigger** → dead. |
| `Settings → DownloadsSettings` | Preference-only: Turbo toggle, folder picker (`downloads.pickDirectory`), maxConn, concurrent, auto-organize — labeled "ENGINE NOT CONFIGURED". |
| `downloads.pickDirectory` IPC | Real native directory picker (keep, capability-specific). |
| `PlatformAdapter.downloadsDir()` | Real OS downloads dir (mac/win/linux). |
| `PlatformAdapter.notify(title, body)` | Real OS notification. |
| `fs-atomic.ts` | Atomic write + `.bak` recovery (reuse for downloads persistence). |
| `Persistence.profileDir(id)` | Per-profile dir; downloads.json will live here. |

## Electron/Chromium download events (the native engine)

`session.on('will-download', (event, item: DownloadItem, webContents) => …)` gives:
- `item.getURL()`, `getFilename()`, `getMimeType()`, `getTotalBytes()`, `getReceivedBytes()`, `getState()`, `getSavePath()`, `getStartTime()`.
- `item.setSavePath(path)` (synchronous in handler → no OS dialog, full control of destination/dedupe).
- `item.pause()`, `item.resume()`, `item.isPaused()`, `item.canResume()`, `item.cancel()`.
- events: `item.on('updated', (e, state))` (`'progressing' | 'interrupted'`), `item.on('done', (e, state))` (`'completed' | 'cancelled' | 'interrupted'`).
- Programmatic start / retry: `session.downloadURL(url)`.

**This is a real engine** — real bytes, real pause/resume/cancel from Chromium's network stack. Multi-connection/segmented transfers are intentionally **out of scope** (documented as future).

## Session / partition model (detection wiring)

Webviews use per-profile partitions: persistent `persist:nexa-<profileId>` and private `nexa-private-<profileId>`. Downloads fire `will-download` on the partition session that triggered them. The service attaches a `will-download` listener per partition, so the emitting session's `profileId` (and private flag) is known via closure. Listeners are (re)attached at startup for every profile in the index, on `settings.saveProfilesIndex` (covers create/switch), and for private partitions.

## Concurrency / queue approach

Chromium auto-starts a download on `will-download`. To honor a real concurrency limit, items beyond `maxConcurrent` are immediately `pause()`d and marked `queued`; when an active slot frees, the next queued item is `resume()`d. This is real transfer-level control (documented caveat: a server without range support may not resume a paused-immediately item; such an item is retryable, which restarts it via `session.downloadURL`).

## Restart recovery

`DownloadItem` objects do not survive a process restart, and Chromium cannot transparently resume them across launches. On startup, persisted non-terminal items (`downloading`/`queued`/`paused`) are marked `failed` with `errorCode: 'interrupted'` and a user-safe message; they remain **retryable** (retry restarts the transfer from scratch via `session.downloadURL` to the same destination). We never claim a cross-restart resume that didn't happen. Cross-restart true resume requires a custom net engine (future).

## Security boundaries

- Renderer never gets `fs`/`shell`. New capability channels only: list/get/pause/resume/cancel/retry/remove/clear*/open/showInFolder/copyUrl/getDetails/getSettings/saveSettings/pauseAll/resumeAll/openFolder + a one-way `downloads.event` stream.
- Filename sanitization + destination resolution + path-traversal rejection happen in the main process; the final save path is asserted to stay within the chosen destination directory.
- Signed-URL secrets: URLs persisted locally (0600, profile-scoped) for retry; never logged. `copyUrl` returns the URL for the user's own clipboard action.
- No auth headers/cookies extracted or persisted. Browser-initiated downloads use the legitimate session context.
- Private-tab downloads: file is saved (user intent) but metadata is **kept in memory only, never persisted** and is dropped on restart. Documented.

## Data model (versioned, profile-scoped)

`DownloadItem { id, profileId, url, filename, mimeType?, totalBytes?, receivedBytes, status, savePath?, destinationDir?, startedAt?, completedAt?, errorCode?, errorMessage?, speedBytesPerSecond?, etaSeconds?, retryCount, createdAt, updatedAt, private? }` stored as `{ version, items: DownloadItem[] }` per profile in `downloads.json` (atomic). Settings in `ProfilePrefs.downloads { askLocation, duplicatePolicy, maxConcurrent, retryLimit }`.

## State flow

`will-download / downloadURL` → DownloadService (authoritative) → atomic persistence → throttled `downloads.event` → preload → zustand projection → React. Renderer never polls the filesystem; UI is a projection of engine truth.

## Pure, testable logic (`src/shared/downloads.ts`)
`sanitizeFilename`, `uniqueFilename(existing, name, policy)`, `hasTraversal`, `computeSpeed(samples)`, `computeEta`, `scheduleQueue(items, max)`, `canRetry`, `summarizeActive`, state predicates, `normalizeDownloads`/`emptyDownloads`, zod schemas.

## Implementation order
model → service → detection → IPC/preload/events → store → UI → toolbar/dashboard/settings/palette → recovery → security → tests (local HTTP fixture, no internet) → visual QA → final audit.

## To remove (dead/obsolete)
`src/services/downloads/index.ts`, `DetectPopover`, `DestPicker`, overlay types `'detect'`/`'dest'` — superseded by the real Download Manager.
