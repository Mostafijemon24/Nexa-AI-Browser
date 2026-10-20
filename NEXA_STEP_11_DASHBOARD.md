# NEXA STEP 11 — Dashboard Customization & Unified Browser Home

## 1. Objective

Transform the NEXA New Tab experience into a **unified, customizable Browser
Control Center** that surfaces the real state of capabilities already
implemented across P0–P10, and answers one question instantly:

> *What is happening in my browser, and what can I do next?*

The Dashboard is a **renderer projection of existing state** — it adds no
backend engine, no new database, and no duplicate services.

## 2. Widget Architecture

The single source of truth is `src/shared/dashboard.ts` — a pure, dependency-free
module (no React, no IPC, no I/O). It defines:

```ts
interface DashboardWidgetDef {
  id: string
  title: string
  description: string
  category: 'quick' | 'browser' | 'productivity' | 'privacy' | 'ai' | 'activity' | 'profile'
  size: 'small' | 'medium' | 'large'
  defaultOrder: number
  defaultEnabled: boolean
}
```

Registry (`DASHBOARD_WIDGETS`) — 15 widgets, each mapped to one real capability:

| id | category | size | backing state (existing) |
|----|----------|------|--------------------------|
| `quick-actions` | quick | large | navigation actions (store) |
| `downloads` | browser | medium | `store.downloads` (P2) |
| `protection` | browser | small | `store.activeProtection()` (P3) |
| `vpn` | browser | small | `store.vpn` + `vpnUiProjection` (P4) |
| `turbo` | browser | small | `store.turboState()` (P9) |
| `ai` | ai | small | `store.aiStatus` (P5) |
| `worker` | ai | medium | `store.workerState` / `workerScan` (P5/P6) |
| `drive` | productivity | medium | `store.driveMeta` (P8) |
| `privacy` | privacy | medium | `store.privacyReport` (P7) |
| `profile` | profile | small | active profile + regional (P0/P10) |
| `regional` | profile | small | `store.prefs.regional` (P10) |
| `recent-sites` | activity | medium | `store.historyRows` |
| `bookmarks` | productivity | medium | `store.bookmarks` |
| `history` | activity | small | `store.historyRows` |
| `collections` | productivity | small | `store.collections` |

Default-enabled widgets and ordering come from `defaultDashboardLayout()`.
`regional`, `history`, and `collections` ship **off** by default (kept compact).

## 3. State Sources

Every metric is read from existing Zustand selectors / service state. No random
numbers, no fake percentages, no simulated progress. Examples:

- **Downloads** — counts derived from `downloads[].status` (`downloading`,
  `queued`/`paused`, `completed`, `failed`/`cancelled`).
- **Protection** — `activeProtection()` snapshot (`settings.enabled`, `totals`).
  When enabled with no traffic it shows **"No blocked requests yet"**, never
  "0 threats blocked".
- **VPN** — projected exclusively through the shared `vpnUiProjection`; the word
  "PROTECTED" can only appear when the backend state is already `protected`.
- **AI** — `aiStatus.state` (`connected` / `checking` / `offline` / not configured).
- **Turbo** — `turboState()` (`ON` / `OFF` / `OPTIMIZING` / `NOT_SUPPORTED`) plus
  the last measured `turboLastClass`. No invented speed claims.
- **Drive** — `driveMeta.state`; unconnected shows "Drive isn't connected" with a
  **Connect Drive** action. No fake files.
- **Privacy** — `privacyReport` indicators (protection/VPN/IP/DNS) with honest
  statuses (`NOT_CONFIGURED` surfaced, never a false `PASS`).

## 4. Profile Persistence

Dashboard layout is stored on the existing per-profile `DashboardPrefs.visible`
(ordered list of enabled widget ids) with a new `v` schema-version field. It is
persisted through the existing profile index (`settings.saveProfilesIndex`) — no
global `localStorage`, no separate store.

- **Profile switch** loads that profile's layout, and transient state (Turbo
  metrics, regional caps, worker/AI context) is already reset by the existing
  switch logic — no cross-profile leakage.
- **Validation on read** — `normalizeDashboardLayout` runs on every render and on
  every write (`setDashLayout`), so persisted data is always treated as untrusted.
- **Migration** — on hydrate, each profile's layout runs through
  `migrateDashboardLayout(visible, v)`: legacy ids are aliased
  (`download-manager→downloads`, `ask-ai→ai`, `google-drive→drive`,
  `recent→recent-sites`, …), unknown ids dropped, and new default widgets
  appended once. Existing user choices are preserved.

## 5. Private Mode

- The same layout preferences apply, but **no private browsing activity is
  persisted or shown**. Activity widgets read `historyRows`, which by design
  never contains private-tab visits (private tabs are not recorded).
- The Profile widget shows a **"Private"** indicator when the active tab is
  private. Nothing else changes; no private-mode layout is written.

## 6. Customization

The **Customize Dashboard** popover (`CustomizeDash`) uses the registry directly:

- Show / Hide each widget.
- Move Up / Move Down (pure `moveWidget`).
- **Reset Layout** → `resetDashLayout()` restores `defaultDashboardLayout()`.
- Greeting toggle (`setDashGreeting`).

Reordering uses the existing up/down control pattern (no fragile new
drag-and-drop framework was introduced).

## 7. Command Palette / Click-to-Go

- Added palette commands **"Open Dashboard"** and **"Customize Dashboard"**
  (the latter replaces the older "Customize Home dashboard" label).
- Navigation from widgets reuses the existing `setView` / `setOverlay` /
  `openUrl` abstractions — no second navigation system.

## 8. Responsive Layout & Density

- Grid: `repeat(auto-fill, minmax(280px, 1fr))`, container capped at 1280px and
  centered. Large widgets span the full row (`grid-column: 1 / -1`).
- Yields ~2 columns @ 1280, ~3 @ 1440, ~3–4 @ 1920+, with no forced horizontal
  scroll and no giant empty areas.
- Compact cards, small action buttons, clear labels, high information density.

## 9. Visual States

Each widget renders honest states: default, hover (token surfaces), focus
(existing `--focus` outline), loading/checking, empty ("No … yet"),
not-configured, partial (`PARTIAL`/`NOT_CONFIGURED`), and error. Status is
conveyed with **both** a color dot and text (never color alone).

## 10. Accessibility

- Each widget is a `<section aria-label>` with an `<h3>` heading.
- Status text is exposed alongside the dot; the VPN widget includes a
  screen-reader-only `ariaLabel`.
- Search input is labelled; all actions are real `<button>`s.
- Uses semantic tokens only — full light/dark support, reduced-motion respected
  (no continuous animations, counters, or pulsing).

## 11. Performance

- Loads instantly from existing store projections; **no network / AI at boot**.
- **No polling loops.** Activity widgets trigger a single lazy `refreshHistory()`
  on mount only if history is enabled and not yet loaded.
- No webviews are mounted for widgets. Hidden widgets are not rendered.

## 12. Security

- `src/shared/dashboard.ts` is pure: no `eval`, `new Function`, `child_process`,
  `require`, dynamic `import`, `fetch`, `window.nexa`, or storage APIs.
- No new IPC channels were added — the Dashboard consumes existing renderer
  state. No generic RPC (`dashboard.execute` / `browser.execute`) exists.
- No secrets/tokens/vault values are rendered. Persisted layout is validated.

## 13. Limitations

- **Recent Sites / History** reflect the profile's persistent history, which is
  loaded lazily; immediately after a cold start they may briefly show "No recent
  activity" until the one-shot load completes.
- **Regional page-runtime** override remains `PARTIALLY_SUPPORTED` (see STEP 10):
  the widget reports Accept-Language + UI formatting honestly and does not claim
  browser-wide runtime emulation.
- **GUI verification** was not executed in this environment (headless).

## 14. Files

- New: `src/shared/dashboard.ts`, `tests/unit/dashboard.test.ts`.
- Reworked: `src/renderer/src/views/NewTab.tsx` (real status widgets).
- Updated: `src/renderer/src/App.tsx` (CustomizeDash + palette),
  `src/renderer/src/state/store.ts` (layout actions + hydrate migration),
  `src/shared/types.ts` (`DashboardPrefs.v`, default layout),
  `tests/unit/theme-tokens.test.ts` (STEP 11 source guards).
