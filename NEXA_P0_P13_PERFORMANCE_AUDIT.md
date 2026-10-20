# NEXA P0–P13 — Performance Audit

*Audit only. Values below are from code inspection + build output, NOT runtime
benchmarks. No speculative speed claims are made.*

## Method
- `npm run build` output inspected for bundle sizes.
- Source inspected for synchronous startup work, polling, timers, and unbounded
  growth. No GUI/runtime profiling available in this environment
  (**BLOCKED — ENVIRONMENT** for measured latency/memory).

## Startup path (code inspection)

- `app.whenReady()` (`index.ts:118+`): constructs services synchronously
  (persistence, secure, vault, library, downloads, protection, vpn, ai(+registry),
  agent, drive, regional, extensions), then `attachAll()` binds session listeners
  per profile, then `createWindow()`.
- Session listener attach iterates profiles once (`attachAll`), calling
  `downloads.attachForProfiles`, `protection.attachForProfiles`,
  `regional.applyForProfiles`, `extensions.applyForProfiles`. Extensions reconcile
  is failure-isolated and does not block window creation (async per profile).
- No blocking network calls on startup; AI provider health is lazy/cached (P12).

## Bundle (measured from build output)

| Asset | Size |
|-------|------|
| `out/renderer/assets/index-*.js` | **~1.56 MB** (single chunk) |
| `out/renderer/assets/index-*.css` | ~27.5 KB |
| fonts (woff/woff2) | ~24 KB each |

**PERF-1 (P3 / Low):** the renderer is a single ~1.56 MB JS chunk (no route/view
code-splitting). Acceptable for a desktop Electron app loading from local disk
(no network fetch), but lazy-loading heavy views (Settings, Drive, PrivacyCenter)
would reduce initial parse/eval. *Future hardening, non-blocking.*

## Polling / timers (verified bounded + cleaned)

| Timer | Location | Bounded? | Cleanup |
|-------|----------|----------|---------|
| VPN health poll | `vpn.ts:366` | yes (`healthPollMs`) | `clearInterval` `:372` |
| Protection stats flush | `protection.ts:139` | yes (`FLUSH_MS`) | `clearInterval` `:402` |
| AI status poll (5s) | `App.tsx:3303` | gated (skips while generating) | `clearInterval` in effect cleanup |

No `setInterval` without corresponding clear. Dashboard/New Tab boot without
polling (guard-tested: `theme-tokens.test.ts` asserts no `setInterval`/`fetch` in
`NewTab.tsx`).

## Memory / resource discipline (code inspection)

- Services expose `dispose()/off/removeListener` teardown (`vpn`, `ai`, `agent`,
  `protection`); `app.before-quit` disposes VPN/AI/agent (`index.ts`).
- Agent loops are hard-capped: `AGENT_MAX_STEPS = 25` + `no_progress` detection
  (`shared/agent.ts:22`, `agent.ts:224–299`).
- Downloads keep bounded sample windows for speed/ETA; queue promotion is
  scheduled, not spinning.
- Extension runtime is lazy (reload enabled-only on boot) and failure-isolated.
- No unbounded arrays or listener accumulation observed in reviewed hot paths.

## Turbo / navigation (honesty check)

- Turbo (`shared/turbo.ts`) exposes preconnect + navigation-timing projection; the
  source guards (existing tests) assert **no** fake “10x/50% faster/1-second
  guarantee/benchmark” claims. Sensitive/private/cross-profile prediction is gated.
- Navigation performance snippet (`App.tsx NAV_PERF_SNIPPET`) reads real
  `performance` timing from the guest; it is a measurement, not a guarantee.

## Status

| Aspect | Status |
|--------|--------|
| Startup work | PASS (no blocking network; lazy AI/extensions) |
| Timers/polling | PASS (bounded + cleaned) |
| Memory hygiene | PASS (inspection); measured = BLOCKED — ENVIRONMENT |
| Bundle size | PARTIAL (single large chunk; PERF-1) |
| Measured latency/memory | BLOCKED — ENVIRONMENT (no GUI/profiler) |
