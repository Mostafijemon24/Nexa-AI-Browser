# NEXA P3 — Content Protection Engine Audit

**Date:** 2026-09-15
**Slice:** Replace the honest "filter engine not configured / 0 blocks" placeholder with a **real network-level content protection engine** built on Electron's `session.webRequest`. No P0/P1/P2 rewrite.

## Existing protection-related surface

| Location | Current state |
|---|---|
| Toolbar shield (`App.tsx:436`) | Opens `AdPanel` popover → "Filter engine not configured", block counts stay 0. |
| `AdPanel` (`App.tsx:1219`) | Placeholder toggle bound to `prefs.adOn`. |
| `Settings → Protection` (`Settings.tsx:500`) | `adOn` toggle, `adMode` (balanced/strict/custom), `adCats` toggles; honest note "FILTER ENGINE NOT CONFIGURED · 0 BLOCKS". |
| `StatusBar` (`App.tsx:770`) | "Protection on · counters require filter engine". |
| `SecurityCenter` | "Content filter: Not configured". |
| `prefs.adOn / adMode / adCats` | Persisted per profile. `adCats = {ads, trackers, malware, popups, cookies, social, annoyances}`. |
| `SETTINGS_NAV` | Has `protection` entry (Content Protection). |
| `main/index.ts` | Uses `mainWindow.webContents.session.webRequest.onHeadersReceived` for **CSP on the app frame only** (default session). No `onBeforeRequest` anywhere. |
| Webview partitions | `persist:nexa-<profileId>` (persistent) and `nexa-private-<profileId>` (private, in-memory). Same partitions the `DownloadService` attaches to. |

## Chromium/Electron APIs available today

- **`session.webRequest.onBeforeRequest(filter, cb)`** — the real filtering primitive. `cb({cancel: true})` blocks; `cb({})` allows. Details include `url`, `resourceType`, `webContentsId`. **Only one listener per session** (we own it per partition).
- `webContents.fromId(details.webContentsId).getURL()` → top-frame URL for first-party / per-site detection.
- Resource types: `mainFrame, subFrame, stylesheet, script, image, font, object, xhr, ping, cspReport, media, webSocket, other`.

### What can be implemented natively today (this slice)
- Real **network request blocking** by domain + resource type (ALLOW/BLOCK) via `onBeforeRequest`, per profile partition.
- Real **tracker + ad + annoyance** blocking from a bundled, NEXA-authored domain rule set (Adblock-subset syntax).
- Real **per-site override** and **global allowlist/blocklist**.
- Real **statistics** from actual request decisions (in-memory, per profile + per top-frame domain).
- Real **private-mode** protection (in-memory only, never persisted).
- Real **profile isolation** (per-partition listener + per-profile rules/stats).

### What is NOT implemented (honest)
- **Cosmetic filtering** (element hiding) — NOT CONFIGURED (network-level only).
- **Malicious-domain protection** — NOT CONFIGURED (no threat DB; a missing source must never show "Protected").
- **External filter-list updates** — EXPERIMENTAL / NOT CONFIGURED (no live fetch in P3; bundled list is authoritative). See `NEXA_P3_FILTER_ENGINE_DECISION.md`.
- **WebRTC / DNS / VPN protection** — P4 (documented, not faked).
- Full **Public Suffix List** — a compact suffix heuristic is used for eTLD+1 (documented limitation).

## Answers to required audit questions
- **Which APIs already used?** `onHeadersReceived` (CSP, default session) and `session.on('will-download')` (downloads). P3 uses `onBeforeRequest` on partition sessions — no overlap.
- **Conflict with downloads?** No. Downloads use `will-download` (post-response). We **never block `mainFrame`** and only block requests matching ad/tracker rules, so legitimate file hosts and download requests are unaffected. First-party assets are allowed.
- **Conflict with future VPN?** No. Protection decides ALLOW/BLOCK; VPN (P4) will decide ROUTE/TUNNEL — separate layers.
- **Conflict with extensions (P9)?** No. A single owned `onBeforeRequest` per session; extension request filtering is out of scope.
- **Profile isolation?** Per-partition listener (profileId via closure), per-profile `protection.json` (site rules) + in-memory stats keyed by profile. Profile IDs re-validated in main (`assertSafeProfileId`).
- **Private sessions?** Protection runs on `nexa-private-<id>`; stats/events kept in a separate in-memory map, never persisted, dropped on restart.
- **State to renderer?** Authoritative main engine → throttled one-way `protection.event` (StatsUpdated snapshot ~750ms, immediate StateChanged/SiteRuleChanged) → preload → zustand → UI.
- **How are blocked stats calculated?** Real counters incremented in the `onBeforeRequest` decision path (global + per top-frame domain + category), plus a capped, redacted recent-events ring.
- **What must never be logged/persisted?** Full URLs with secrets, query params, cookies, auth headers, POST bodies, passwords, private browsing URLs. Recent-events store only `scheme://host/path` (redacted, capped, in-memory).

## Architecture (matches P2 conventions)
```
partition session.webRequest.onBeforeRequest
        ↓
ProtectionService (authoritative, per profile)
   ├── compiled bundled rules (shared, immutable)
   ├── per-profile site rules (allow/block/overrides) — protection.json (atomic)
   └── per-profile in-memory stats + recent events
        ↓  throttled protection.event
preload → zustand slice → Protection dashboard / toolbar popover+badge
```
Pure, testable logic in `src/shared/protection.ts` (rule parsing, matching, host helpers, stats). Main service in `src/main/services/protection.ts`.

## Implementation plan
shared rule engine → bundled rules → main ProtectionService (webRequest) → IPC/preload/events → store → dashboard + toolbar popover/badge + settings + palette → tests (fake-session integration + local fixture) → regression + docs.
