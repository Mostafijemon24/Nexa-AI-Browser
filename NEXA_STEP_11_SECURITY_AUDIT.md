# NEXA STEP 11 — Security Audit (Dashboard Control Center)

Scope: `src/shared/dashboard.ts`, `src/renderer/src/views/NewTab.tsx`, the
`CustomizeDash` popover and dashboard store actions in
`src/renderer/src/state/store.ts` / `src/renderer/src/App.tsx`.

## Threat model summary

The Dashboard is a **renderer-only projection** of state that already crosses
the existing, audited IPC boundary. It introduces **no new main-process
surface**, so the attack surface delta is limited to (a) untrusted persisted
layout data and (b) what is rendered on screen.

| # | Risk | Finding | Mitigation |
|---|------|---------|------------|
| 1 | Cross-profile leakage | PASS | Layout is per-profile (`DashboardPrefs.visible`); switch reloads the active profile and resets transient state (Turbo/regional/worker/AI). Widgets read the active profile only. |
| 2 | Private data leakage | PASS | Activity widgets read `historyRows`, which never contains private-tab visits (private tabs are not recorded). No private searches/downloads/history are shown as persistent activity. Profile widget only flags a "Private" indicator. |
| 3 | Secrets in UI | PASS | No vault passwords, tokens, OAuth material, or IPC internals are rendered. Drive shows email/state only when connected. |
| 4 | Unsafe IPC / generic RPC | PASS | No new IPC channels. No `dashboard.execute` / `dashboard.run` / `dashboard.fetch` / `browser.execute`. Widget actions call existing typed store methods. |
| 5 | Arbitrary execution | PASS | No `eval`, `new Function`, `executeJavaScript`, `child_process`, `shell:` in the dashboard layer (grep-verified + source-guard tests). |
| 6 | Untrusted persisted config | PASS | `normalizeDashboardLayout` drops unknown ids, non-strings, and duplicates, and always yields a safe default. `migrateDashboardLayout` handles legacy layouts without destroying user choices. Sizes are registry-controlled (no arbitrary pixels from persisted data). |
| 7 | AI-driven content | PASS | The Dashboard never calls Ollama/AI to generate content, summaries, categories, descriptions, or metrics. It is deterministic. |
| 8 | Telemetry | PASS | No usage data is emitted. No `fetch`/`sendBeacon`/network from the dashboard. |
| 9 | Fabricated status | PASS | All statuses come from real state; VPN "PROTECTED" only via `vpnUiProjection` from backend `protected`; protection shows "No blocked requests yet" instead of fake zeros. |
| 10 | Silent form submission (Worker) | PASS | Worker widget exposes only **Scan Page** and **Open Worker**; the existing Scan→Understand→Suggest→Edit→Fill→**User confirms Submit** workflow is unchanged. No `submitForm`/`autoSubmit`. |

## Persisted-input validation

`normalizeDashboardLayout(persisted: unknown)`:

- non-array → safe default layout;
- per entry: must be a string, aliased if legacy, kept only if a known widget id;
- duplicates collapsed to first occurrence, order preserved;
- empty result → safe default.

This runs on **read** (render), on **write** (`setDashLayout`), and during
**hydrate migration**, so malformed or malicious profile data cannot inject
unknown widgets, impossible sizes, or duplicate ids.

## Source-guard tests

`tests/unit/theme-tokens.test.ts` → *"Dashboard control center (STEP 11)"* asserts:
no backend engine / IPC / storage / unsafe primitives in the core; validation on
read; per-profile persistence via the existing index; real-state consumption; no
fabricated metrics; honest empty states; Worker confirm-to-submit preserved;
semantic tokens only; accessibility; no polling/network/AI at boot; palette
integration.

## Conclusion

STEP 11 does not weaken any existing security boundary. **Security: PASS.**
