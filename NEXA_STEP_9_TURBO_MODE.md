# NEXA — STEP 9 · Turbo Mode & Navigation Performance

Additive, honest browser-performance layer on top of Chromium/Electron. Turbo is
**not** a second browser/HTTP/download/cache/DNS engine — it is a thin decision +
UX layer that (1) reuses Chromium's native connection/cache reuse, (2) safely warms
connections for strongly-intended navigations, (3) removes shell overhead, (4)
surfaces **real** local navigation timing, and (5) shows an honest state model.

Workflow: `Address input → Click-to-Go (sync, AI-free) → instant UI → Chromium → progressive render`, with an optional safe preconnect running in parallel and a subtle non-blocking progress indicator.

---

## 1. Absolute honesty

Turbo **never** fabricates load times, percentages, speeds, cache/DNS status, or
"N× faster" claims. When timing data is unavailable it shows `Unavailable` /
`Not available`. Turbo optimizes NEXA's **local** behavior only; remote server,
network, DNS, TLS, third-party scripts and page complexity remain external factors
outside NEXA's control (see §8, Real-world limitation).

## 2. State model (`src/shared/turbo.ts`)

```
OFF | ON | OPTIMIZING | NOT_SUPPORTED
```

`deriveTurboState({ supported, enabled, optimizing })` — supported iff the preload
`nexa.turbo` bridge exists; `optimizing` reflects the real in-flight navigation
(`did-start-loading` → `did-finish-load`). Never fabricated.

## 3. Architecture

```
User
 ↓
NEXA shell (Omnibox / Click-to-Go)     ── sync, deterministic, AI-free
 ↓                         ↘ (safe, debounced) turbo.preconnect
Turbo decision layer  ─────► main IPC (Zod + profile + sensitive validation)
 ↓                              ↓
Chromium session (profile-scoped, VPN-routed, P3-filtered)
 ↓
Network / cache / rendering  ──► real PerformanceNavigationTiming (guest, local-only)
```

- **No new engine.** Downloads still flow `DriveService → P2 (enqueueUrl → session.downloadURL)`. Turbo adds no download/fetch bridge.
- **Preconnect reuses the profile's own session** (`session.fromPartition('persist:nexa-<profile>')`), so it inherits VPN routing, DNS config and P3 filtering. It cannot bypass any of them.

## 4. What Turbo actually does

| Mechanism | Real behavior | Where |
| --- | --- | --- |
| Connection & cache reuse | Relies on Chromium's built-in HTTP/2, HTTP/3/QUIC, TLS session resumption, socket pooling, DNS cache, and disk/memory cache via the persistent partition. No custom stack; nothing disabled. | Chromium (persistent partitions unchanged) |
| Safe navigation prediction (preconnect) | Warms DNS/TCP/TLS to the origin the user is clearly about to open (typed URL, debounced 220 ms, deduped). Rejects private tabs + sensitive/unsafe URLs. | `Omnibox` → `store.turboPreconnect` → `turbo.preconnect` IPC → `session.preconnect` |
| Duplicate-navigation guard | Suppresses identical navigations within 400 ms (double-Enter / repeated commands). Bounded + deterministic. | `store.navigate` + `isDuplicateNavigation` |
| Progressive rendering | Only the **active** tab mounts a `<webview>`; the shell never blocks the page with a full-screen overlay. Chromium renders progressively. | `Content` / `WebTab` |
| Navigation progress indicator | Subtle 2px bar reflecting Chromium's real `did-start-loading`/`did-stop-loading` window. No % / ETA. Reduced-motion safe. | `NavProgress` + `.nav-progress-bar` |
| Local navigation metrics | Reads standard `PerformanceNavigationTiming` from the guest page (TTFB, DOMContentLoaded, Load, transferSize, fromCache). In-memory only. | `WebTab` `NAV_PERF_SNIPPET` → `store.recordNavPerf` |

## 5. Settings (Settings → Turbo & Performance)

- **Turbo Mode** (master; persisted as `prefs.toggles.turbo`, default ON)
- **Safe navigation prediction** (`prefs.turbo.predict`)
- **Progressive loading indicator** (`prefs.turbo.progress`)
- **Local navigation metrics** (`prefs.turbo.metrics`)
- **Connection & cache reuse** — informational (Chromium-native, always on)

Sub-toggles are disabled when the master is OFF. Defaults are ON because they are
safe and privacy-preserving (no persistence of navigation signals, no prefetch).

## 6. UX integration

- **Toolbar indicator**: compact `⚡` (`TurboButton`) using existing tokens — On (fill), Off (regular), Optimizing (spins, reduced-motion safe), Not supported (muted).
- **Popover** (`TurboPopover`): state, active optimizations, and **real** last-navigation timing (or "Not available"), with an honest footnote and a link to settings.
- **Command Palette**: `Turbo Mode: On/Off`, `Turbo: Open Turbo Settings`, `Turbo: Show Last Navigation Performance`.
- **Click-to-Go**: `turbo`, `turbo mode`, `performance`, `speed`, `fast` → opens the Turbo popover.

## 7. Privacy & profile isolation

- Preconnect **never** runs for a private tab.
- Navigation metrics are **in-memory only** (`turboLastPerf`) — never written to disk, never uploaded, no AI.
- On profile switch, Turbo state resets (`turboLastPerf`, `navLoading`) and the module-scoped guards (`lastNav`, `lastPreconnect`) are cleared. No cross-profile prediction storage.
- Main only warms connections for the **active** profile (`d.profileId !== active → no-op`).

## 8. Real-world limitation (required statement)

> Turbo optimizes the browser's local behavior and perceived responsiveness. It
> cannot guarantee a fixed page-load time because remote server, network, DNS, TLS,
> third-party scripts, and page complexity remain external factors.

NEXA never promises "1 second on every website."

## 9. Files changed

**New**
- `src/shared/turbo.ts` — pure state/classification/policy core
- `tests/unit/turbo.test.ts` — 15 unit tests
- `NEXA_STEP_9_TURBO_MODE.md`, `NEXA_STEP_9_PERFORMANCE_AUDIT.md`, `NEXA_STEP_9_SECURITY_AUDIT.md`, `NEXA_STEP_9_TEST_MATRIX.md`

**Modified**
- `src/shared/types.ts` — `TurboPrefs` + `ProfilePrefs.turbo` default
- `src/shared/channels.ts`, `src/shared/ipc.ts` — `turbo.preconnect` channel + Zod schema
- `src/main/ipc/register.ts` — preconnect handler (`session.preconnect`, profile + sensitive validation)
- `src/preload/index.ts`, `src/renderer/src/nexa.d.ts` — `nexa.turbo.preconnect` bridge
- `src/renderer/src/state/store.ts` — Turbo slice, nav dedup, perf capture, profile reset
- `src/renderer/src/App.tsx` — `TurboButton`, `NavProgress`, `TurboPopover`, `WebTab` timing, Omnibox preconnect, palette
- `src/renderer/src/views/Settings.tsx` — `TurboSettings`
- `src/renderer/src/lib/catalogs.ts` — Turbo settings nav
- `src/shared/click-to-go.ts` — `turbo` command
- `src/renderer/src/design-system/tokens.css` — `.nav-progress-bar`
- `tests/unit/theme-tokens.test.ts` — 10 STEP 9 source-guard tests
- `NEXA_IMPLEMENTATION_AUDIT.md`, `NEXA_DESIGN_AUDIT.md`
