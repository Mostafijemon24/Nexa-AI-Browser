# NEXA STEP 11 — Test Matrix

Baseline before STEP 11: **602** tests. After STEP 11: **634** tests
(+22 dashboard core, +10 dashboard source guards). All pass.

## Automated — dashboard core (`tests/unit/dashboard.test.ts`, 22)

| Area | Cases |
|------|-------|
| Widget registry | known-id acceptance; unknown/`number`/`null`/`undefined` rejection; registry self-consistency (id/title/category/size); unique `defaultOrder`; ordered `dashboardWidgetIds()` |
| Default layout | only default-enabled widgets, ordered; `collections`/`history`/`regional` excluded; deterministic (no shared mutable state) |
| Normalize (untrusted) | non-array → default; drops unknown + non-string entries preserving order; duplicate collapse; legacy aliasing + cross-alias dedupe; drops legacy ids with no equivalent; empty/all-invalid → default; preserves valid custom subset (no default injection) |
| Migration | no-op (validate only) at current version; append new defaults once on upgrade; default-off widgets not force-added; hidden default widget not resurrected at current version |
| Reorder/hide/show | `moveWidget` up/down within bounds; no-op at edges/unknown id; `hideWidget`/`showWidget`; ignore unknown / already-visible; `hiddenDashboardWidgets` complement ordered |
| Profile isolation | deterministic output; mutating one result never affects another |

## Automated — source guards (`tests/unit/theme-tokens.test.ts` → STEP 11, 10)

| Guard | Assertion |
|-------|-----------|
| Pure UI layer | no `DashboardService`/`DashboardAPI`/`child_process`/`require(`/`import(`/`fetch(`/`window.nexa`/storage in core; no `eval`/`new Function`/`executeJavaScript`/`shell:` in core or view |
| Untrusted layout | `normalizeDashboardLayout`/`migrateDashboardLayout`/version present; view validates on read; store validates on hydrate + write |
| Per-profile persistence | uses `persistIndex()`; no `localStorage`/`sessionStorage`/`indexedDB` in view |
| Real data | reads `activeProtection()`/`turboState()`/`aiStatus`/`driveMeta`/`privacyReport`/`vpnUiProjection`; no fake marketing metrics / `Math.random` |
| Honest empty states | "No downloads yet", "No blocked requests yet", "Drive isn't connected", "No collections yet", "No recent activity" |
| Worker workflow | Scan Page + Open Worker only; no `submitForm`/`autoSubmit` |
| Tokens | no hard-coded hex; no `--text-1`; uses `var(--accent-2)` |
| Accessibility | `aria-label={title}`, `<h3>`, labelled search input |
| Boot cost | no `setInterval`/`fetch`/`ollama` in view |
| Command palette | "Open Dashboard" + "Customize Dashboard" registered |

## Regression

| Check | Result |
|-------|--------|
| `npm test` | 634/634 PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | NOT_CONFIGURED (script is a placeholder) |
| Dashboard-layer forbidden-pattern grep | CLEAN |

## Manual GUI matrix (NOT executed — headless environment)

Intended coverage at 1280×800 / 1440×900 / 1920×1080 / 2560×1440: dashboard
open, widget layout, customize popover, reorder, hide/show, reset, profile
switching, private mode, light/dark, keyboard navigation, command palette,
quick actions, and each widget (Downloads/VPN/Privacy/AI/Worker/Drive/regional).

**GUI Verification: NOT_CONFIGURED — ENVIRONMENT.**
