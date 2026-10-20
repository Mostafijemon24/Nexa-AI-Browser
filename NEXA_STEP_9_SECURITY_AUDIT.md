# NEXA — STEP 9 · Security Audit (Turbo Mode)

Scope: the additive Turbo layer (`src/shared/turbo.ts`, `turbo.preconnect` IPC, store
slice, shell UI). Turbo must not weaken any existing boundary (sandbox, CSP, typed
IPC, profile/private isolation, P3, P4 VPN, P8 Drive, P2 downloads).

## 1. Threat model & findings

| Risk | Mitigation | Verified |
| --- | --- | --- |
| **Unsafe prefetch / speculative navigation** | STEP 9 performs **no document prefetch**. Only connection warm-up (preconnect), gated by `preconnectTarget` (safe http(s), non-sensitive, non-private, enabled). `isPrefetchable` exists and is extremely conservative for any future use. | `turbo.test.ts`, source guard |
| **Sensitive URL leakage** (login/payment/oauth/token/password) | `isSensitiveNavigation` rejects auth/payment/account paths, hosts and query keys → never preconnected, never logged, never sent to telemetry. | source guard + unit tests |
| **Cross-profile leakage** | Main handler no-ops unless `d.profileId === activeProfile`; preconnect uses that profile's own session. Store resets Turbo state + `lastNav`/`lastPreconnect` on profile switch. | source guard |
| **Private-mode leakage** | `store.turboPreconnect` returns early for private tabs; `preconnectTarget` refuses `privateMode`. Metrics are in-memory only; nothing persisted. | source guard + unit tests |
| **VPN / kill-switch bypass** | Preconnect uses `session.fromPartition('persist:nexa-<profile>')` — the same VPN-routed, P3-filtered session as navigation. No separate socket/proxy/optimization channel. | code review (`register.ts`) |
| **Protection (P3) bypass** | No resource is fetched or unblocked by Turbo. Connection warm-up carries no request body/URL beyond the origin and flows through the standard session. | code review |
| **Cache poisoning** | No custom cache is written; Chromium's cache is used unmodified. Turbo never injects responses. | code review |
| **IPC widening / generic RPC** | Only `turbo.preconnect({ profileId, url })` was added — Zod-validated, capability-specific. No `turbo.execute/fetch/request/api/eval`. It can only preconnect. | source guard (`PRELOAD`, `REGISTER`) |
| **Arbitrary execution** | Turbo core has no `eval`/`new Function`/`child_process`/`execFile`/`fs.*`. | source guard + grep |
| **Sensitive performance logging / upload** | Metrics are local, in-memory, single-record; no `fetch`/`sendBeacon`/AI in the Turbo core; no URL upload. | source guard |
| **DoS via preconnect spam** | Debounced (220 ms) + deduped per origin (`lastPreconnect`) + `numSockets: 1` + active-profile-only. | code review |
| **Malicious page-generated URLs** | Preconnect targets come from the **user's own omnibox input**, not page content. `isPrefetchable` requires `trusted !== false` and same-origin for any future page-driven use. | unit tests |

## 2. Preserved invariants

- Electron `sandbox`, `contextIsolation`, `nodeIntegration=false`, `webSecurity=true`, CSP — **unchanged**.
- Typed, Zod-validated IPC — extended by exactly one capability channel.
- P2 download engine remains the single download path; Turbo adds no download route.
- P8 Drive: no Drive content/export/token/metadata is prefetched.
- No cloud rendering / remote Chromium / proxy / external telemetry introduced.

## 3. Guest Performance API note

Navigation timing is read by executing a small **read-only** snippet in the guest
page context (`performance.getEntriesByType('navigation')`). This uses the same
established, trusted mechanism as P5.2 observation, runs with the page's own
(unprivileged) capabilities, returns only numeric timing (no URLs/content), and is
gated by the `metrics` sub-toggle. It grants no privileged access.

## 4. Failure handling

Turbo is fail-open for browsing: preconnect is fire-and-forget with `.catch(() => {})`,
metrics failures fall back to `Unavailable`, and `NOT_SUPPORTED` renders when the
bridge is absent. A Turbo failure can never crash or block navigation.

## 5. Residual items

- Preconnect currently targets typed-URL origins only; extending to hover/suggestion
  focus should continue to route through `preconnectTarget` (sensitive/private gates).
- No lint tooling is configured in the repo (`npm run lint` is a placeholder); static
  analysis relies on `tsc` + the source-guard test suite.
