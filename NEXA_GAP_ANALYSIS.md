# NEXA — Gap Analysis (STEP 0)

> Read-only. **No implementation performed.** This document is the bridge from the current
> verified state to the next steps. Statuses cross-checked against source, not docs.

Legend: **IMPLEMENTED · PARTIAL · MISSING · NOT CONFIGURED · EXPERIMENTAL · BLOCKED — ENVIRONMENT**

---

## 1. Current architecture map

- **Main (privileged):** `main/index.ts` (sandboxed window + CSP) → `ipc/register.ts`
  (Zod-validated, capability-specific handlers) → services: `ai`, `ollama`, `agent` (+permissions,
  +ipc-host), `downloads`, `protection`(+rules), `vault`, `secure-storage`, `library`,
  `persistence`, `fs-atomic`, `vpn` (+`vpn-helper/*`, +`vpn-platform/*`).
- **Platform:** `platform/{macos,windows,linux}` behind `PlatformAdapter`.
- **Shared:** `channels.ts` (109 typed channels), `ai/agent/observation/vision`,
  `downloads/protection/vpn*/library/session/types`, `page-content`, `strength`, `core/vault-crypto`.
- **Preload:** `preload/index.ts` — typed `window.nexa`, no Node exposure.
- **Renderer:** `App.tsx` (shell/tabs/toolbar/address bar/sidebar/AI+Agent panel/palette),
  `state/store.ts` (single Zustand store), `design-system/{tokens.css,theme.ts}`,
  `views/{Bookmarks,Collections,Downloads,History,NewTab,Protection,Settings}`.
- **Boundary rule (enforced):** AI plans → NEXA authorizes (registry+PermissionEngine) →
  Chromium/renderer executes fixed scripts. No generic IPC / shell / arbitrary JS.

## 2. Current feature status

- **IMPLEMENTED:** P0 foundation; P1 shell/tabs/profiles/settings/palette/theme;
  Bookmarks/History/Collections; P2 downloads; P3 protection + vault(crypto+keychain+CRUD UI);
  P4/P4.1/P4.2 VPN (native, live-validation env-blocked); P5 intelligence; P5.1 agent (3 modes);
  P5.2 observation/tools; P5.3 vision layer.
- **PARTIAL:** tabs (pin/duplicate/context menu); protection (external list update/cosmetic/per-site);
  AI (Ollama-only, no multi-provider); dashboard (no widget registry); command palette (no intent grouping);
  auto-update/About (packaging present, update channel unverified).
- **NOT CONFIGURED:** Cloud / Google Drive (honest placeholder); vision live multimodal; lint.
- **MISSING:** Click-to-Go; Worker Assistant; Smart Fill; vault autofill/form-detect;
  Privacy Center + IP/DNS/WebRTC/fingerprint diagnostics; Turbo Navigation; per-profile timezone/locale;
  Extensions manager; multi-provider AI.
- **EXPERIMENTAL / SIMULATED:** Workspaces (label-only, not bound to tab/session sets).
- **BLOCKED — ENVIRONMENT:** VPN live native validation; interactive Chromium GUI validation.

## 3. Design mismatch list

- Click-to-Go address-bar panel — missing.
- Worker Assistant panel — missing.
- Privacy Center dashboard — missing.
- Cloud/Drive connected UI — placeholder only.
- Dashboard widget customization (registry/show-hide-reorder/layout/greeting) — missing.
- Per-profile timezone/locale controls — missing.
- Tab context menu / pin / duplicate — verify/extend.
- Address-bar style variants (solid/gradient/glass) — verify.
- Extensions manager screen — missing.
- (Design tokens, shell, settings, downloads, VPN, bookmarks/history/collections — already match.)

## 4. Missing functionality (priority order)

1. **Click-to-Go** intent resolver in address bar (`input→intent→capability→permission→execute`, ranked).
2. **Worker Assistant** as a UX preset over existing AgentService + ObservationEngine (scan→suggest→review→fill; no silent submit; sensitive fields gated).
3. **Smart Fill** for ordinary fields; **vault autofill** (fail-closed, origin-aware) — sensitive fields NOT CONFIGURED/gated.
4. **Privacy Center** + real IP/DNS/WebRTC/IPv6/fingerprint diagnostics (honest states, no fabrication).
5. **Google Drive click-to-connect** (OAuth, tokens in `secure-storage`, downloads via existing engine).
6. **Turbo Navigation** (real optimizations only; no fake metrics).
7. **Per-profile timezone/locale** (only what Chromium/Electron supports; else EXPERIMENTAL/NOT CONFIGURED).
8. **Dashboard customization** (widget registry, single source of truth).
9. **Multi-provider AI abstraction** (keep Ollama local-first default).
10. **Extensions manager**, **auto-update channel**, **lint configuration**.

## 5. Duplicate systems found

**None.** Each subsystem (AI/Ollama, Agent, Observation, Vision, Downloads, Protection,
Profiles/persistence, IPC, command palette, tokens, Settings, sidebar, Vault) has a single owner.
The mandate for next steps is **extend/compose/reuse** — highest duplication risk is Worker
(must reuse AgentService, not a 4th runtime) and Click-to-Go (must reuse palette + services).

## 6. Security risks

- **No current security regressions.** Sandbox/contextIsolation/nodeIntegration=false/webSecurity/CSP all correct; no generic IPC; no shell/fs/arbitrary-JS from renderer or model; vault sealed via `safeStorage`.
- **Forward risks to guard when building new features:**
  - Click-to-Go must invoke **only registered capabilities** — never shell/fs/arbitrary IPC/JS.
  - Worker/Smart Fill must **never silently submit**; password/OTP/card/CVV/API keys stay gated or NOT CONFIGURED.
  - Drive OAuth tokens must **never** touch renderer/localStorage/IndexedDB/logs/generic IPC — only `secure-storage` via typed IPC.
  - Privacy Center must report honest states only — never fabricate IP/DNS/WebRTC/fingerprint/VPN results; no "guaranteed anonymity".
  - Autofill must be fail-closed (scheme+host+port+origin+frame; block cross-origin/look-alike/iframe).

## 7. Performance risks

- `App.tsx` is 2627 LOC and `store.ts` 1024 LOC — adding Click-to-Go/Worker/Privacy inline risks bloat and rerenders. **Modularize new features into dedicated views/components; avoid one giant component.**
- Worker/Privacy must avoid continuous screenshot capture, global expensive observers, excessive polling, huge DOM dumps (per prompt §P6).
- Lazy-load hidden widgets/secondary UI (dashboard, Privacy Center) to keep shell responsive.
- Vision capture is memory-only and capability-gated — keep it on-demand, never continuous.

## 8. Files that MUST change (for the next steps)

*(No changes now — this lists the likely surface for the approved next steps.)*
- `src/shared/channels.ts` — add capability-specific channels (clickToGo intents, worker, privacy diagnostics, drive-oauth) — **extend, do not genericize**.
- `src/main/ipc/register.ts` — add Zod-validated handlers for the above.
- `src/preload/index.ts` + `src/renderer/src/nexa.d.ts` — expose new typed APIs.
- `src/main/services/*` — new services: `privacy-diagnostics.ts`, `cloud-drive.ts` (reusing `secure-storage` + `downloads`); extend `vault.ts` for autofill.
- `src/renderer/src/App.tsx` — address-bar Click-to-Go integration (modularized).
- `src/renderer/src/state/store.ts` — new slices (extend, single store).
- `src/renderer/src/views/` — new `PrivacyCenter.tsx`, `Worker`/`Cloud` real views; extend `Settings.tsx` (timezone/locale), `NewTab.tsx` (dashboard).
- `src/renderer/src/design-system/tokens.css` — only if genuinely new tokens are needed (prefer reuse).
- `package.json` — configure real `lint`.
- `tests/unit/` — add suites per §7 of master prompt.

## 9. Files that MUST NOT change (preserve)

- `src/main/index.ts` security config (sandbox/contextIsolation/nodeIntegration/webSecurity/CSP) — **do not weaken**.
- `src/core/vault-crypto.ts` + `src/main/services/vault.ts` crypto — reuse, do not reimplement.
- `src/main/services/{ollama,ai}.ts` — single AI runtime; do not fork.
- `src/main/services/agent*.ts` + `src/shared/agent.ts` — single agent; Worker must reuse.
- `src/shared/observation.ts` + `src/shared/vision.ts` — single observation/vision; Worker/scanner must reuse.
- `src/main/services/downloads.ts` — single download engine; Drive must route through it.
- `src/main/services/{protection*,vpn*}.ts` + `vpn-helper/*` + `vpn-platform/*` — reuse.
- `src/renderer/src/design-system/*` — one design system; extend tokens only, never a second system.
- `src/shared/channels.ts` capability-specific pattern — never introduce a generic `execute`.

## 10. Exact implementation order for the next steps

Smallest-diff-first, each gated by tests/typecheck/build/lint + honest states:

0. **STEP 0 (this) — audit only. STOP.** ✅
1. **Configure real `lint`** (eslint config) so quality gate is genuine.
2. **Click-to-Go** — address-bar intent resolver reusing palette + registered capabilities only.
3. **Worker Assistant** — UX preset over AgentService + ObservationEngine (scan→suggest→review→fill, no silent submit, sensitive-field gating).
4. **Smart Fill + Vault autofill** — fail-closed origin-aware; sensitive fields gated/NOT CONFIGURED.
5. **Privacy Center + diagnostics** — real IP/DNS/WebRTC/IPv6/fingerprint, honest states.
6. **Google Drive click-to-connect** — OAuth via `secure-storage`, downloads via existing engine.
7. **Turbo Navigation** — real optimizations, honest states, no fake metrics.
8. **Per-profile timezone/locale** — only Chromium/Electron-supported; else EXPERIMENTAL/NOT CONFIGURED.
9. **Dashboard customization** — widget registry, single source of truth.
10. **Multi-provider AI abstraction**, **Extensions manager**, **auto-update channel** — later phases.

---

### STOP — audit complete. No implementation performed. Awaiting go-ahead for the next step.
