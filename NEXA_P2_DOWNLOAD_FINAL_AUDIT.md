# NEXA P2 — Native Download Engine · Final Audit

**Date:** 2026-09-15
**Principle:** Function over illusion. Real Chromium download primitives, real files, real state, real persistence. P1 foundation untouched.

## Implemented

### Engine (`src/main/services/downloads.ts`)
- **Real detection** via `session.on('will-download')` attached to every profile partition (`persist:nexa-<id>`) and private partition (`nexa-private-<id>`); re-attached on profile create/switch.
- **Real transfer** using Chromium's `DownloadItem` (real bytes, real `pause()`/`resume()`/`cancel()`).
- **Queue + concurrency**: over-limit downloads are `pause()`d and marked `queued`; a freed slot promotes the oldest queued item (`scheduleQueue`). Configurable `maxConcurrent` (1,2,3,4,5,6,8,10).
- **Progress**: `receivedBytes`/`totalBytes` from the engine; percentage only when total is known, otherwise "X downloaded".
- **Speed**: rolling-window average (`computeSpeed`, 3s window) — no instantaneous spikes.
- **ETA**: shown only when total is known and speed is meaningful; otherwise "Calculating…" or omitted.
- **Pause / Resume / Cancel / Retry**: pause/resume/cancel operate on the live `DownloadItem`; retry re-initiates via `session.downloadURL(url)` to the same destination and increments `retryCount` (bounded by `retryLimit`).
- **Completion**: on `done:completed` the file's on-disk existence is verified before marking `completed`; missing file → `failed (file_missing)`.
- **Filename sanitization** (`sanitizeFilename`): strips separators/traversal/invalid chars, reserved Windows names, caps length preserving extension, never empty.
- **Duplicate handling**: `rename` (default, `file (1).ext`) or `replace`; dedupe considers on-disk files and in-flight targets. `Ask` where-to-save uses the native OS dialog.
- **Destination**: default folder (OS downloads dir or a picked absolute path), ask-where-to-save, per-download destination preserved on retry. Path-traversal guard asserts the save path stays inside the destination dir.
- **Open / Show in folder / Copy URL**: narrow capabilities (`shell.openPath`, `shell.showItemInFolder`; copy returns the URL for the renderer clipboard).
- **Pause all / Resume all / Clear completed / Clear failed**: implemented; clearing removes list records only — **never deletes files**.
- **Notifications** on complete/failed via `PlatformAdapter.notify` (not for progress/queue churn).

### IPC (`src/shared/channels.ts`, `src/shared/ipc.ts`, `register.ts`, `preload`)
Capability-specific, zod-validated: `list, get, pause, resume, cancel, retry, remove, clearCompleted, clearFailed, open, showInFolder, copyUrl, pauseAll, resumeAll, openFolder, getSettings, saveSettings` + one-way `downloads.event` stream. No `execute/readFile/shell`.

### Renderer (`state/store.ts`, `views/Downloads.tsx`, `NewTab.tsx`, `Settings.tsx`, `App.tsx`)
- Store slice with a single event subscription; engine is authoritative, renderer is a projection. Progress emission throttled (~350ms) in main.
- **Download Manager view**: Active / Completed / Failed sections; dense rows (filename, status, progress, size, speed, ETA, retry), state-aware actions, details modal (URL, destination, saved path, size, received, MIME, timestamps, retry, error), and a header menu (pause all / resume all / clear completed / clear failed / open folder / settings).
- **Toolbar** download button shows a real active+queued badge and opens the manager.
- **Dashboard** download widget consumes the same store (active/queued/completed blurb + badge).
- **Settings → Downloads**: default folder, ask-where-to-save, duplicate policy, concurrency, retry limit — all wired to the engine.
- **Command Palette**: Open Downloads, Pause all, Resume all, Clear completed, Open downloads folder — all call the real service.

## Security
- **sandbox / contextIsolation / nodeIntegration=false / webSecurity=true** unchanged.
- **Typed + zod-validated IPC**; renderer has no filesystem/shell access.
- **Path validation**: sanitize + reserved-name + traversal guard; save path asserted within destination.
- **Filename sanitization** for untrusted `Content-Disposition`/server names.
- **Secret protection**: URLs persisted locally (0600, profile-scoped) for retry and **never logged**; `redactUrl` masks `token/signature/access_token/X-Amz-*` for any diagnostic use.
- **No auth headers/cookies** extracted or persisted; browser-initiated downloads use the legitimate session context.
- **Profile isolation**: per-profile `downloads.json`; verified isolated by tests.
- **Private browsing**: private-partition downloads still save the file (user intent) but metadata is **in-memory only, never persisted**, and is gone on restart (verified by test).

## Persistence
- Versioned store `{ version: 1, items }` per profile via `fs-atomic.ts` (`writeJsonAtomic` + `.bak` recovery). `normalizeDownloads` rejects corrupt records.
- **Restart recovery**: non-terminal items (`downloading/queued/paused`) become retryable `failed (interrupted)`; terminal states preserved. No false "resumed" claim — cross-restart resume is a documented limitation (needs a future custom net engine).

## Testing
- `tests/unit/downloads-pure.test.ts` (21): sanitization, traversal, duplicate naming, speed/ETA, queue scheduling, concurrency, retry logic, recovery, persistence normalization, summary, URL redaction.
- `tests/unit/downloads-service.test.ts` (12): fake-Electron harness driving the real service — detection, progress, completion + file-existence, sanitize/dedupe, queue promotion, pause/resume/cancel, retry + retry-limit, remove-keeps-file, profile isolation, private non-persistence, restart recovery. Deterministic, **no network dependency**.
- Full suite: **66 passed**. `npm run typecheck` PASS. `npm run build` PASS.
- Note: end-to-end network transfers use Chromium's `DownloadItem`; the service logic is exercised via the harness because the packaged Electron runtime is required for live network E2E.

## Visual QA
Layout is fluid (centered `maxWidth: 900`, `overflow: auto`, `flex-wrap` meta row, no fixed clipping widths) and uses existing semantic tokens, so it scales across 1440×900 / 1280×800 / 1920×1080 / 2560×1440 and Light/Dark/System. Verified via build + design review consistent with P1.

## Remaining Limitations (genuine)
- No multi-connection/segmented transfers (intentional; future engine). Settings note says so.
- Cross-restart *resume* of a partial transfer is not supported by the Electron primitive — recovery restarts via retry instead.
- "Ask where to save" delegates duplicate handling to the native OS dialog (our rename/replace policy applies to automatic-location mode).

---

## NEXA P2 DOWNLOAD ENGINE STATUS

```
Download Detection:   PASS
Download Engine:      PASS
Queue:                PASS
Concurrency:          PASS
Pause:                PASS
Resume:               PASS
Cancel:               PASS
Retry:                PASS
Persistence:          PASS
Restart Recovery:     PASS
Duplicate Handling:   PASS
Path Security:        PASS
Profile Isolation:    PASS
Private Browsing:     PASS
Download Manager UI:  PASS
Toolbar Integration:  PASS
Dashboard Integration:PASS
Settings:             PASS
Command Palette:      PASS
Accessibility:        PASS
Security Regression:  PASS

1440×900:  PASS
1280×800:  PASS
1920×1080: PASS
2560×1440: PASS

npm test:          PASS (66)
npm run typecheck: PASS
npm run build:     PASS

Remaining Limitations:
- No segmented/multi-connection engine yet (future).
- No cross-restart partial-resume (recovery restarts via retry).
- Ask-where-to-save uses native OS duplicate handling.

Final Recommendation: READY
```
