# NEXA — STEP 9 · Performance Audit

Baseline-first audit of the existing navigation, startup, renderer and tab paths,
plus the targeted, additive optimizations added in STEP 9. No fabricated numbers.

## 1. Navigation flow (audited)

`Omnibox` resolution via `resolveClickToGo` is **synchronous, deterministic and
AI-free** (no debounce, no network, no LLM). `store.navigate` sets the tab URL and
lets Chromium load — **there is no artificial `setTimeout` delay** in the navigation
path (the few `setTimeout`s in `App.tsx` are unrelated: copy-toast reset and
observation settle windows, not navigation gating).

**Added:** a bounded 400 ms duplicate-navigation guard (`isDuplicateNavigation`) to
absorb double-Enter / repeated Click-to-Go without suppressing legitimate reloads
(reload uses `webview.reload()`, a separate path).

## 2. Cache & connection reuse (audited — Chromium-native)

- Persistent tabs use `persist:nexa-<profile>` partitions → Chromium keeps its HTTP
  cache, HTTP/2 & HTTP/3 connections, TLS session cache, socket pool and DNS cache.
- Private tabs use in-memory `nexa-private-<profile>` partitions (no disk persistence).
- STEP 9 **does not** disable any Chromium optimization, does not clear cache, and
  does not recreate sessions. No custom cache/DNS/HTTP layer was introduced.

**Verdict:** cache/connection reuse is preserved and relied upon as-is.

## 3. Preconnect (added, conservative)

`session.preconnect({ url: origin, numSockets: 1 })` is issued only when:
1. Turbo + "safe navigation prediction" are ON,
2. the tab is **not** private,
3. the input is a clear URL (`looksLikeUrl`), debounced 220 ms and deduped per origin,
4. the origin is safe http(s) and **not** sensitive (login/payment/oauth/etc.),
5. the request is for the **active profile** (main re-checks).

It uses the profile's own session, so it is DNS/VPN/P3 consistent. It cannot leak
across profiles and never runs in private mode.

## 4. Progressive rendering & loading indicator (added)

Only the active tab mounts a `<webview>`; the shell never overlays a blocking
"Loading…" screen. A subtle 2px `NavProgress` bar reflects the **real**
`did-start-loading`/`did-stop-loading` window — no fake percentage or ETA — and is
reduced-motion safe (static bar under `prefers-reduced-motion`).

## 5. Navigation timing (added, local-only)

On `did-finish-load` (when metrics are enabled) NEXA reads the guest page's own
`performance.getEntriesByType('navigation')[0]` (standard `PerformanceNavigationTiming`)
and stores `{ responseStart, domContentLoaded, loadEventEnd, transferSize,
encodedBodySize, decodedBodySize, fromCache }` in memory only. `fromCache` is
inferred from `transferSize === 0 && encodedBodySize > 0`. Classification thresholds:
`≤1500 ms Fast`, `≤4000 ms Normal`, `>4000 ms Slow`, none → `Unavailable`.

## 6. Renderer performance (audited)

- Zustand subscriptions in the toolbar/omnibox are already scoped selectors; the new
  `TurboButton`/`NavProgress` subscribe to narrow slices (`turboState()`, `navLoading`).
- The perf capture is one-shot per navigation (event listeners bound once via
  `_nexaBound` guard on the webview node) — no listener leaks, no polling.
- No renderer rewrite was performed; changes are targeted and additive.

## 7. Startup & lazy initialization (audited)

- Only the active tab's webview mounts; background/non-active chrome views render
  lazily via the existing `renderTabBody` switch.
- STEP 9 adds no eager service init and does not delay startup. Turbo state derives
  from already-loaded prefs; the preconnect handler is registered with the other IPC
  handlers (no extra boot cost). Security-critical protections (P3/P4) are untouched
  and not lazily deferred.

## 8. Memory safety (audited)

- Webview event listeners are bound once per node; the module-scoped `lastNav` /
  `lastPreconnect` are single values (not growing maps) and are reset on profile switch.
- `turboLastPerf` holds only the most recent navigation (single object), never a history.
- Repeated Turbo toggling only flips a boolean pref; no timers/subscriptions are created.

## 9. Benchmark

**Methodology (reproducible locally):** with `npm run dev`, measure via the built-in
metrics and DevTools Performance panel against deterministic local pages:

```
Cold startup ........ process launch → initial shell render (main-process timestamps)
Warm startup ........ second launch with warm OS cache
New navigation ...... first visit to a local test page (Turbo popover: TTFB/DCL/Load)
Repeat navigation ... same page again (expect fromCache=Yes, lower transferSize)
Tab switching ....... activate an existing tab (UI is state-only, no reload)
Profile switching ... switchProfile → shell re-render
Settings opening .... setView('settings')
Click-to-Go ......... keystroke → suggestion render (synchronous, no async)
```

**Result:** `NOT_CONFIGURED — ENVIRONMENT`. This audit was performed in a headless
CI-style environment without a GUI display; runtime GUI timing numbers were **not**
captured and are intentionally **not** fabricated. The instrumentation to reproduce
them (real `PerformanceNavigationTiming` surfaced in the Turbo popover) ships in this
step. Where improvement is negligible for a given page, the popover will show that
honestly (identical Fast/Normal classification).

## 10. Honest expectations

- **Preconnect** helps most on cold origins with high DNS/TLS cost; it does nothing
  for already-warm connections and is deliberately skipped for sensitive/private navigations.
- **Repeat navigation** benefits from Chromium's cache (visible as `fromCache=Yes`).
- Turbo cannot change remote server, network, DNS, TLS or third-party time.
