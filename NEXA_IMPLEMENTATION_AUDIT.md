# NEXA — Implementation Audit (STEP 0)

> Read-only audit. **No code was modified.** Status verified against the actual
> repository source, not against documentation claims.
> Date: 2026-09-16.

Status legend: **IMPLEMENTED · PARTIAL · MISSING · NOT CONFIGURED · EXPERIMENTAL · BLOCKED — ENVIRONMENT**

---

## 1. Baseline

| Gate | Command | STEP 0 | STEP 1 |
|---|---|---|---|
| Tests | `npm test` (vitest) | PASS — 369/369, 28 files | **PASS — 380/380, 29 files** (+`theme-tokens.test.ts`) |
| Typecheck | `npm run typecheck` (tsc node + web) | PASS | **PASS** |
| Build | `npm run build` (electron-vite) | PASS | **PASS** |
| Lint | `npm run lint` | NOT CONFIGURED (stub `echo`) | **NOT CONFIGURED** (unchanged — out of STEP 1 visual scope; not faked) |

> **STEP 1 (visual fidelity) material change:** the design-token layer was formalized
> (semantic interaction-state + sizing/motion tokens) with zero-pixel-change centralization,
> and a real fidelity bug was fixed — the AI panel assistant chat bubble referenced a
> **non-existent `--text-1` token** (silent wrong-color fallback across themes), now `--text`.
> No architecture/IPC/service/security behavior changed. See `NEXA_STEP_1_DESIGN_CHANGELOG.md`.

---

## 2. Architecture map (as it actually exists)

```
src/
├── core/vault-crypto.ts            WebCrypto vault primitives (PBKDF2→AES-GCM)
├── shared/                         Pure, typed, Zod-validated contracts (shared main↔renderer)
│   ├── channels.ts (109 channels)  Capability-specific IPC channel names — NO generic execute
│   ├── ai.ts / agent.ts / observation.ts / vision.ts   AI + Agent + Observation + Vision contracts
│   ├── downloads.ts / protection.ts / vpn*.ts / library.ts / session.ts / types.ts
│   ├── page-content.ts / strength.ts / ipc.ts
├── main/                           Electron main (privileged)
│   ├── index.ts                    BrowserWindow (sandbox/contextIsolation/CSP), service wiring
│   ├── ipc/register.ts (713 LOC)   Zod-validated handlers per capability
│   └── services/
│       ├── ai.ts / ollama.ts       Local-first AI runtime (single Ollama client)
│       ├── agent.ts / agent-permissions.ts / agent-ipc-host.ts   Agent orchestration + PermissionEngine
│       ├── downloads.ts            Native download engine (P2)
│       ├── protection.ts / protection-rules.ts   Filter engine (P3)
│       ├── vault.ts / secure-storage.ts (safeStorage)   Vault + OS keychain seal (P3)
│       ├── library.ts              Bookmarks / History / Collections (profile-scoped)
│       ├── persistence.ts / fs-atomic.ts   Profile-scoped + global persistence
│       ├── vpn.ts + vpn-helper/* + vpn-platform/*   WireGuard/native VPN (P4/P4.1/P4.2)
├── platform/  (index + macos/windows/linux + types)   PlatformAdapter (P0)
├── preload/index.ts                Typed window.nexa bridge (no Node exposure)
└── renderer/src/
    ├── App.tsx (2627 LOC)          Browser shell: tabs, toolbar, address bar, sidebar, AI/Agent panel, palette
    ├── state/store.ts (1024 LOC)   Zustand single store (profiles, tabs, AI, agent, vault, library, prefs)
    ├── design-system/tokens.css (485)  Token system (light/dark, accent-mix, radius/density/motion)
    ├── design-system/theme.ts      Theme application
    ├── lib/catalogs.ts             Static catalogs (VPN countries, presets)
    └── views/                      Bookmarks · Collections · Downloads · History · NewTab · Protection · Settings
```

**Ownership split (confirmed):** planning + permissions + AI orchestration live in **main**;
browser actions execute in the **renderer** webview via fixed injected scripts, bridged over
typed IPC (`agent-ipc-host` → renderer executor). No generic command path exists.

---

## 3. Phase-by-phase status (P0 – P5.3)

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| **P0** Foundation | Sandbox+CSP, typed Zod IPC, PlatformAdapter, token system, profile-scoped vs global persistence, secure storage | **IMPLEMENTED** | `main/index.ts` (sandbox/CSP), `platform/*`, `persistence.ts`, `secure-storage.ts`, `tokens.css` |
| **P1** Core browser | Shell, tabs, toolbar, address bar, sidebar, status bar, profiles, full Settings, command palette, theme engine, **Bookmarks/History/Collections** | **IMPLEMENTED** (Workspaces simulated) | `App.tsx`, `views/*`, `library.ts`, `Settings.tsx` |
| **P2** Downloads | Native download engine + UI | **IMPLEMENTED** | `services/downloads.ts`, `views/Downloads.tsx`, `downloads*.test.ts` |
| **P3** Protection + Vault | Filter engine (EasyList-compatible), Vault (PBKDF2→AES-GCM + keychain seal) | **IMPLEMENTED** (bundled lists; external list update / cosmetic NOT CONFIGURED; **autofill MISSING**) | `protection*.ts`, `vault.ts`, `secure-storage.ts`, `vault-crypto.test.ts` |
| **P4 / P4.1 / P4.2** VPN | WireGuard adapters, privileged helper, platform impls, kill switch/DNS/leak | **IMPLEMENTED — live native validation BLOCKED — ENVIRONMENT** | `services/vpn*`, `vpn-helper/*`, `vpn-platform/*`, VPN test suite |
| **P5** Browser Intelligence | Ask/Summarize/Explain/Translate/Rewrite/Q&A, injection fence, embeddings, profile isolation | **IMPLEMENTED** | `services/ai.ts`, `ollama.ts`, `shared/ai.ts`, `page-content.ts` |
| **P5.1** Agent Foundation | AgentService, Planner, PermissionEngine, ToolRegistry, 3 modes (ask/assist/agent) | **IMPLEMENTED** | `agent.ts`, `agent-permissions.ts`, `shared/agent.ts` |
| **P5.2** Advanced tools | ObservationEngine, extract table/list/links, find/scroll/wait, semantic eids | **IMPLEMENTED** | `shared/observation.ts`, agent tools |
| **P5.3** Vision layer | Capability detection, memory-only capture, `visionAnalyze`, DOM↔vision fusion | **IMPLEMENTED — live multimodal inference NOT CONFIGURED** (no vision model installed → honest `VISION_NOT_CONFIGURED`) | `shared/vision.ts`, `ai.ts` vision methods, `vision.test.ts` |

---

## 4. P6/P7 "unified UX" concepts — real state

| Concept | Status | Evidence |
|---|---|---|
| Click-to-Go (address-bar intent resolver) | **MISSING** | No `clickToGo`/intent-resolver code anywhere |
| Worker Assistant (UX preset over agent) | **MISSING** | No `worker` code; agent modes exist but no Worker flow |
| Smart Fill | **MISSING** | No fill flow; vault has no autofill either |
| Auto Page Scanner | **PARTIAL (foundation only)** | ObservationEngine exists (P5.2) but no scanner UX |
| Unlimited logical profiles | **IMPLEMENTED** | `createProfile` has no artificial cap |
| Per-profile timezone | **MISSING** | No timezone code in Settings/types/store |
| Per-profile locale/language | **MISSING** | No locale code |
| Privacy Center | **MISSING** | No Privacy Center view/service |
| IP/DNS/WebRTC/fingerprint diagnostics | **MISSING** | No diagnostics service |
| Google Drive click-to-connect | **NOT CONFIGURED** | `App.tsx` cloud = `PlaceholderPage "REQUIRES OAUTH · NOT CONFIGURED"`; Settings row "Not configured · OAuth required" |
| Turbo Navigation | **MISSING** | `turbo` present only as a *download-engine* setting (`types.ts`), not navigation |
| Cloud transfer | **NOT CONFIGURED** | Honest placeholder only |
| Enhanced dashboard | **PARTIAL** | `NewTab.tsx` exists; no widget registry / customization |
| Enhanced command palette | **PARTIAL** | Palette exists and routes to real services; not yet the grouped Click-to-Go resolver |
| Unified browser UX | **PARTIAL** | Shell unified; new concepts not integrated |

---

## 5. Feature detail (current vs expected)

| Feature | Current behavior | Expected (design) | Files | Status |
|---|---|---|---|---|
| Design tokens | Full token set, light/dark, runtime accent-mix, radius/density/motion | Same | `tokens.css`, `theme.ts` | **IMPLEMENTED** |
| Tabs | open/close/switch, new-tab, session restore | + pin/duplicate/close-others/left/right, context menu | `App.tsx`, `store.ts`, `session.ts` | **PARTIAL** (verify pin/duplicate/context menu) |
| Profiles | create/switch/rename/delete, avatar, accent, isolation, private mode | + timezone + locale | `store.ts`, `persistence.ts` | **PARTIAL** (timezone/locale MISSING) |
| Workspaces | Hardcoded label list → sets a pref + toast | Bound to real tab/session sets | `App.tsx:628-672` | **EXPERIMENTAL / SIMULATED** |
| Settings | Full-page, real dropdowns, persistence, profile scope | Same | `views/Settings.tsx` (948) | **IMPLEMENTED** |
| Command palette | ⌘K, routes to real services, state-aware entries | + intent grouping | `App.tsx` | **IMPLEMENTED (baseline)** |
| Bookmarks | add/edit/delete/folders/nested/search/import-export, profile-scoped | Same | `views/Bookmarks.tsx`, `library.ts`, `shared/library.ts` | **IMPLEMENTED** |
| History | ranges, search, clear, profile-scoped | Same | `views/History.tsx`, `library.ts` | **IMPLEMENTED** |
| Collections | create/rename/delete/items | Same | `views/Collections.tsx`, `library.ts` | **IMPLEMENTED** |
| Downloads | native engine + UI, states, clear | Same | `services/downloads.ts`, `views/Downloads.tsx` | **IMPLEMENTED** |
| Protection | modes/categories, bundled lists, live counters | + external list auto-update, cosmetic, per-site | `services/protection*`, `views/Protection.tsx` | **PARTIAL** (external/cosmetic NOT CONFIGURED) |
| Vault | create/unlock/CRUD, WebCrypto, keychain seal (safeStorage), Settings UI | + fail-closed origin-aware **autofill** + form detect | `vault.ts`, `secure-storage.ts`, `core/vault-crypto.ts`, `Settings.tsx` | **PARTIAL** (autofill MISSING) |
| VPN | WireGuard/native, kill switch/DNS/leak, catalog | Same | `services/vpn*`, `vpn-helper/*`, `vpn-platform/*` | **IMPLEMENTED — live BLOCKED — ENVIRONMENT** |
| AI | local-first Ollama, streaming, injection fence, embeddings | + provider abstraction (OpenAI/Anthropic/Google/LM Studio/custom) | `services/ai.ts`, `ollama.ts`, `shared/ai.ts` | **PARTIAL** (Ollama-only; multi-provider MISSING) |
| Agent | 3 modes, planner, permissions, tools, observation, vision | Same | `agent.ts`, `agent-permissions.ts`, `shared/agent.ts` | **IMPLEMENTED** |
| Cloud / Drive | Honest placeholder | OAuth click-to-connect + transfers via existing engine | `App.tsx` placeholder, `Settings.tsx` | **NOT CONFIGURED** |
| Extensions | none | Chromium extensions manager | — | **MISSING** |
| Auto-update / About | electron-builder present | Signed update channel + About wired | `electron-builder.yml`, `packaging/` | **PARTIAL** (packaging present; update channel unverified) |

---

## 6. Duplication scan (§5 of prompt)

**No duplicate subsystems found.** Single source of truth for each:

| Subsystem | Single owner |
|---|---|
| AI runtime / Ollama client | `services/ollama.ts` (one client), `services/ai.ts` |
| Agent | `services/agent.ts` (+ permissions/host) |
| Observation | `shared/observation.ts` |
| Vision | `shared/vision.ts` + `ai.ts` vision methods |
| Downloads | `services/downloads.ts` |
| Protection | `services/protection.ts` |
| Profiles / persistence | `services/persistence.ts` + `store.ts` |
| IPC | `shared/channels.ts` + `ipc/register.ts` (capability-specific) |
| Command palette | single palette in `App.tsx` |
| Design tokens | single `tokens.css` |
| Settings | single `views/Settings.tsx` |
| Sidebar / shell | single `App.tsx` |
| Vault / secrets | `vault.ts` + `secure-storage.ts` |

> **Risk for next steps:** the new concepts must **extend** these, not fork them. Highest
> duplication risk: Worker Assistant (must reuse AgentService/Observation — not a 4th runtime)
> and Click-to-Go (must reuse the existing palette/services — not a parallel command system).

---

## 7. Security boundary verification (§7 of prompt)

| Requirement | State | Evidence |
|---|---|---|
| `sandbox=true` | **PASS** | `main/index.ts:76` |
| `contextIsolation=true` | **PASS** | `main/index.ts:77` |
| `nodeIntegration=false` | **PASS** | `main/index.ts:78` |
| `webSecurity=true` | **PASS** | `main/index.ts:79` |
| Strong CSP | **PASS** | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |
| No generic IPC (`execute/invoke/run`) | **PASS** | 109 capability-specific channels; only `agent host.execute` = typed tool bridge |
| No arbitrary shell | **PASS** | VPN helper uses validated `execFile` allow-list only; no generic command path |
| No arbitrary filesystem | **PASS** | `fs-atomic.ts` scoped; no renderer fs |
| Arbitrary JS execution | **CONTAINED** | `executeJavaScript` only in renderer executor with **fixed, non-model** scripts |
| Credential / OAuth exposure | **PASS** | Vault key sealed via `safeStorage`; no OAuth tokens (cloud not connected) |
| Renderer access to secrets | **PASS** | Vault decrypted entries memory-only; preload exposes no Node |
| Model-generated arbitrary commands | **PASS** | Agent tools validated against registry + PermissionEngine; vision fuses to DOM eids, never coordinates |

> **No security regressions. Do not weaken any of the above in later steps.**

---

## 7b. STEP 4 — Click-to-Go Intent Navigation

| Item | Status | Evidence |
|------|--------|----------|
| Deterministic intent resolver | **PASS** | `src/shared/click-to-go.ts` — pure `resolveClickToGo`, precedence URL→command→service→page→search |
| Typed, data-only contract | **PASS** | `Suggestion`/registries carry strings only; no functions cross boundary |
| URL http(s)-only guard | **PASS** | `toSafeHttpUrl` + reuse of `looksLikeUrl`/`normalizeUrl`; `javascript:`/`file:`/`data:`/`vbscript:`/`electron:`/`shell:` → search, never executed |
| No generic execution path | **PASS** | `executeClickToGo` closed `switch`; no `executeShell/executeJS/openFile/eval/clickToGo.execute`; no new IPC channel |
| NEXA commands (shared) | **PASS** | `NEXA_COMMANDS` → existing `setView`/`setOverlay`; no duplicated palette list |
| Known services (nav-only) | **PASS** | `KNOWN_SERVICES` plain https; Drive = website nav, not "connected" |
| Page actions (capability-gated) | **PASS** | summarize/ask/scan offered only when `onWebPage && aiConnected` |
| AI excluded from routing | **PASS** | No Ollama call during resolution; synchronous + deterministic |
| Keyboard + a11y | **PASS** | Arrow/Enter/Escape/⌘L; combobox/listbox/option, aria-activedescendant |
| Private mode / profile | **PASS** | routes via `navigate()` (respects private + `historyEnabled`); suggestions transient local state, never persisted/logged |
| Tests | **PASS** | 412/412 (18 resolver + 5 source-guard added) |

## 7c. STEP 5 — Worker Assistant & Smart Worker Mode

| Item | Status | Evidence |
|------|--------|----------|
| Deterministic worker core (pure) | **PASS** | `src/shared/worker.ts` — `scanObservation`, `buildFillPlan`, `workerFillDecision`, `buildWorkerSuggestionMessages`, `sanitizeSuggestion` |
| Page scanner (reuses observation) | **PASS** | `workerScanLive` → `OBSERVE_SRC` + `buildObservation` + `scanObservation` (no new crawler) |
| Question / form / option / button detection | **PASS** | `scanObservation` (+ `WORKER_EXTRAS_SRC` for radio groups & select options) |
| AI suggestions (optional, one-shot) | **PASS** | `aiComplete` scoped to a fresh requestId; scan works with AI offline |
| Answer edit / copy / use | **PASS** | `WorkerAnswerCard` + `workerEditAnswer`/`workerApproveAnswer` |
| Smart fill (semantic, existing tools) | **PASS** | `runWorkerActions` → existing `type`/`select_option`/`set_checkbox` by `eid` |
| Semantic targeting (no guessing) | **PASS** | reuses `resolveTarget` (EXACT/STRONG/AMBIGUOUS/NOT_FOUND) |
| Permission enforcement (ASK/ASSIST/AGENT) | **PASS** | `workerFillDecision` + confirmation gate; ASK read-only |
| Sensitive-field protection | **PASS** | password excluded from fill; secret values never in scan/AI/history/logs |
| Prompt-injection defense | **PASS** | `wrapUntrusted` + `INJECTION_GUARD`; marker spoofing neutralized (tested) |
| Never silently submits | **PASS** | no submit/click in worker path; stops at REVIEW REQUIRED |
| Private mode / profile isolation | **PASS** | history skipped in private; context non-persisted; full reset on profile switch |
| Task history (lightweight, no secrets) | **PASS** | in-memory, profile-scoped, counts + host only |
| Command Palette + Click-to-Go (single registry) | **PASS** | `Worker:` palette group; click-to-go `worker` command + `answer` page action |
| No new execution path / IPC | **PASS** | reuses `ai.chat` + existing agent executor; no `worker.execute`, no eval/shell/fs |
| Tests | **PASS** | 449/449 (29 worker core + 8 source-guard added) |
| GUI verification | **BLOCKED — ENVIRONMENT** | headless |

## 7b. STEP 6 — Secure Vault Autofill & Smart Fill

Additive vault-autofill on top of the existing vault, observation, semantic-target,
PermissionEngine, Worker Assistant and typed-IPC systems. **No system replaced.**
Full detail: `NEXA_STEP_6_SECURE_VAULT_AUTOFILL.md`, `NEXA_STEP_6_SECURITY_AUDIT.md`,
`NEXA_STEP_6_TEST_MATRIX.md`.

| Capability | Status | Where |
| --- | --- | --- |
| Secure vault integration (reuse, no redesign) | **PASS** | `vault.reveal` in main; `core/vault-crypto` untouched |
| Deterministic field detection/classification | **PASS** | `src/shared/vault-autofill.ts` `classifyField`/`findLoginFields` |
| Live origin matching (scheme/host/port, subdomain, lookalike, IDN) | **PASS** | `matchCredentialOrigin`; authority = `guest.getURL()` |
| Credential selection (metadata only) | **PASS** | `matchCredentials`; popover account chooser |
| Password protection (never displayed) | **PASS** | popover masks; `matchCredentials` carries no password |
| Secret isolation (main-only lifetime) | **PASS** | `injectCredential`; secret never in state/logs/IPC/AI |
| AI boundary | **PASS** | no AI in autofill path; deterministic selection |
| Renderer boundary | **PASS** | IPC returns only `{ filled }` |
| IPC security (capability-specific, Zod, request-only) | **PASS** | `passwordManager.autofill` + `vaultAutofillSchema` |
| PermissionEngine (ASK blocked / ASSIST+AGENT explicit) | **PASS** | renderer + main gates |
| Profile isolation (revalidate active profile) | **PASS** | `loadProfilesIndex().activeProfile`; window-owned guest |
| Private mode (no persistence) | **PASS** | no autofill history in any mode |
| Worker Assistant integration (detect only) | **PASS** | "Login form detected" banner → opens vault popover |
| Click-to-Go (`vault`/`passwords`/`fill login`) | **PASS** | shared registry `panel: 'vault'` |
| No auto-submit | **PASS** | injector sets values + `input`/`change` only |
| OTP detection (no auto-retrieval) | **PASS** | classified `OTP`; manual entry only |
| Browser execution (fixed snippet, eid targeting) | **PASS** | no eval/new Function/AI selectors/coords |
| Accessibility (dialog role, keyboard, live status) | **PASS** | `VaultAutofillPopover` |
| Tests | **PASS** | 478/478 (+20 core, +9 source-guard) |
| Security audit | **PASS** | `NEXA_STEP_6_SECURITY_AUDIT.md` |
| GUI verification | **NOT_CONFIGURED** | headless environment |

## 7c. STEP 7 — Privacy Center & Real-Time Privacy Diagnostics

Additive, honesty-first Privacy Center reusing P3 protection, P4 VPN, profiles, IPC
and design tokens. **No engine replaced; no AI required for diagnostics.** Full
detail: `NEXA_STEP_7_PRIVACY_CENTER.md`, `NEXA_STEP_7_SECURITY_AUDIT.md`,
`NEXA_STEP_7_TEST_MATRIX.md`.

| Capability | Status | Where |
| --- | --- | --- |
| Privacy Center view (toolbar/settings/palette/click-to-go) | **PASS** | `views/PrivacyCenter.tsx`; AdPanel; `Privacy` palette group; click-to-go `privacy` |
| HTTPS diagnostic (live URL) | **IMPLEMENTED** | `classifyHttps` |
| Local interface IPs (IPv4/IPv6, availability) | **IMPLEMENTED** | main `os.networkInterfaces` + `summarizeInterfaces` |
| Site-visible public IP | **NOT_CONFIGURED** | no external echo shipped (honest) |
| DNS diagnostic | **IMPLEMENTED (platform-dependent)** | main `dns.getServers` + `normalizeDns` |
| WebRTC diagnostic | **IMPLEMENTED** | renderer `RTCPeerConnection` (empty iceServers) + `normalizeWebrtc`; public-candidate = NOT_CONFIGURED |
| Fingerprint surface (deterministic) | **IMPLEMENTED** | renderer signal probe + `buildFingerprint` |
| Permissions | **IMPLEMENTED** | `navigator.permissions.query` |
| Content protection telemetry | **PASS (reused P3)** | store snapshot `perDomain` |
| VPN telemetry | **PASS (reused P4)** | `VpnStatus` (verified-only positive labels) |
| Cookies | **IMPLEMENTED (count only)** | main `session.cookies.get` → length; values never shown |
| Active live origin authority | **PASS** | `guest.getURL()` via `webContents.fromId`, window-owned |
| Profile isolation | **PASS** | main revalidates active profile; state reset on switch |
| Private mode (no persistence) | **PASS** | in-memory report only |
| AI boundary (deterministic) | **PASS** | no AI in diagnostics |
| IPC security (capability-specific, Zod) | **PASS** | `privacy.diagnose`; no generic/eval/shell |
| No fake protection states | **PASS** | honest enums; `aggregatePrivacy` counts only |
| Accessibility | **PASS** | `aria-live`, semantic headings, dialog-free view |
| Tests | **PASS** | 512/512 (+25 core, +9 source-guard) |
| Security audit | **PASS** | `NEXA_STEP_7_SECURITY_AUDIT.md` |
| GUI verification | **NOT_CONFIGURED — ENVIRONMENT** | headless |

## 7d. STEP 8 — Google Drive & Secure Cloud Download Integration

Additive, read-only Google Drive **source provider** feeding the existing P2
Download Engine. OAuth + tokens live only in main. Full detail:
`NEXA_STEP_8_GOOGLE_DRIVE.md`, `NEXA_STEP_8_SECURITY_AUDIT.md`,
`NEXA_STEP_8_TEST_MATRIX.md`.

| Capability | Status | Where |
| --- | --- | --- |
| Drive view + Cloud settings card + Click-to-Go + palette | **IMPLEMENTED** | `views/Drive.tsx`; `CloudSettings`; click-to-go `drive`; `Cloud` palette group |
| OAuth 2.0 + PKCE (S256) + state + loopback redirect | **IMPLEMENTED** | `services/drive.ts` + `shared/drive.ts` |
| Live OAuth / Google API calls | **NOT_CONFIGURED — REQUIRES GOOGLE CLOUD OAUTH CREDENTIALS** | env `NEXA_GOOGLE_CLIENT_ID` |
| Secure token storage (OS safeStorage, per profile) | **IMPLEMENTED** | `SecureStorage` `drive:tokens:<profile>` |
| Minimum read-only scope | **IMPLEMENTED** | `drive.readonly` only |
| File browser / search / pagination / folders | **IMPLEMENTED** | `DriveService.list/search` + `DriveView` |
| Workspace export mapping (+ EXPORT_NOT_SUPPORTED) | **IMPLEMENTED** | `exportFormatFor` |
| Download → **existing P2 engine** (no 2nd manager) | **IMPLEMENTED** | `downloads.enqueueUrl` → `session.downloadURL` |
| File-id / URL / filename validation (P2 sanitizer) | **IMPLEMENTED** | `isValidFileId`, authoritative `files.get`, P2 sanitize |
| Profile isolation (main revalidates) | **IMPLEMENTED** | `assertActive` + store reset |
| Private-mode policy | **IMPLEMENTED** | inherits active-tab private flag; nothing persisted |
| Disconnect (revoke only; never deletes files) | **IMPLEMENTED** | revoke + `clearTokens` |
| No write/delete/upload/rename/move/share/sync | **BY DESIGN** | read/download only |
| No generic IPC / eval / shell / AI-in-path | **PASS** | source-guarded |
| Tests / typecheck / build | **PASS** | 550/550 |
| Security audit | **PASS** | `NEXA_STEP_8_SECURITY_AUDIT.md` |

## 7b. STEP 9 — Turbo Mode & Navigation Performance

| Item | Status | Evidence |
| --- | --- | --- |
| Turbo state model (OFF/ON/OPTIMIZING/NOT_SUPPORTED) | **IMPLEMENTED** | `src/shared/turbo.ts` `deriveTurboState`; honest, derived from real inputs |
| Turbo settings (master + predict/progress/metrics) | **IMPLEMENTED** | `prefs.toggles.turbo` + `prefs.turbo`; `Settings → Turbo & Performance` |
| Safe navigation prediction (preconnect) | **IMPLEMENTED** | `turbo.preconnect` IPC → `session.preconnect`; sensitive/private/profile validated |
| Cache & connection reuse | **CHROMIUM-NATIVE** | persistent partitions unchanged; no custom stack; nothing disabled |
| Duplicate-navigation guard | **IMPLEMENTED** | `isDuplicateNavigation` in `store.navigate` (400 ms, bounded) |
| Progressive rendering + progress indicator | **IMPLEMENTED** | active-tab-only webview; `NavProgress` (no %/ETA, reduced-motion safe) |
| Real navigation timing (local-only) | **IMPLEMENTED** | `PerformanceNavigationTiming` snippet; in-memory; `summarizePerf`/`classifyNavigation` |
| Toolbar indicator + popover + palette + Click-to-Go | **IMPLEMENTED** | `TurboButton`/`TurboPopover`; palette Turbo group; `turbo` command |
| Private mode / profile isolation | **IMPLEMENTED** | no private preconnect; metrics in-memory; state reset on switch |
| Capability-specific IPC (no generic RPC/eval/shell/AI) | **PASS** | source-guarded; only `turbo.preconnect` added |
| No second engine / cloud rendering / proxy | **BY DESIGN** | reuses Chromium + P2; source-guarded |
| Tests / typecheck / build | **PASS** | 575/575 |
| Security audit | **PASS** | `NEXA_STEP_9_SECURITY_AUDIT.md` |
| Benchmark / GUI | **NOT_CONFIGURED — ENVIRONMENT** | methodology documented; instrumentation ships; no fabricated numbers |

## 7c. STEP 10 — Per-Profile Timezone, Locale & Language

| Item | Status | Evidence |
| --- | --- | --- |
| Per-profile regional prefs (tz/locale/languages/date/time/week/measurement) | **IMPLEMENTED** | `prefs.regional` + `src/shared/regional.ts` validator |
| IANA timezone validation (Intl-authoritative) | **IMPLEMENTED** | `isValidTimeZone` rejects `GMT+6`/`Dhaka Time`/`foo/bar` |
| BCP-47 locale/language validation | **IMPLEMENTED** | `isValidLocale` + `Intl.getCanonicalLocales`; ordered languages |
| Accept-Language at session level | **SUPPORTED** | `RegionalService.setUserAgent(ua, acceptLanguages)` per profile session |
| Page timezone/locale runtime | **PARTIALLY_SUPPORTED** | Chromium process-global; reported honestly; not faked; no JS monkeypatch |
| NEXA UI date/time/number formatting | **SUPPORTED** | `Intl.DateTimeFormat`/`NumberFormat`; deterministic tests |
| Capability-specific IPC (no generic RPC/header interceptor) | **PASS** | `regional.apply` only; source-guarded |
| Profile isolation (active-profile only + reset on switch) | **IMPLEMENTED** | main applies `activeProfile`; store resets `regionalCaps` |
| Private mode | **IMPLEMENTED** | inherits profile config; nothing extra persisted |
| Worker regional context (no silent submit) | **IMPLEMENTED** | `describeRegional` in trusted user-context; confirm-gated workflow unchanged |
| Not fingerprint spoofing / anti-detection | **PASS** | no navigator/canvas/WebGL/hardware spoofing; Privacy audit unchanged; source-guarded |
| Settings + palette + Click-to-Go + Privacy card | **IMPLEMENTED** | `RegionalSettings`, Region palette group, `regional` command, config card |
| Tests / typecheck / build | **PASS** | 602/602 |
| Security audit | **PASS** | `NEXA_STEP_10_SECURITY_AUDIT.md` |
| GUI | **NOT_CONFIGURED — ENVIRONMENT** | headless |

## 7b. STEP 11 — Dashboard Customization & Unified Browser Home

| Capability | Status | Notes |
|---|---|---|
| Widget registry (pure core) | **IMPLEMENTED** | `src/shared/dashboard.ts`: 15 widgets, category/size, default layout; no engine/IPC/I/O |
| Real status widgets | **IMPLEMENTED** | Downloads/Protection/VPN/Turbo/AI/Worker/Drive/Privacy/Profile/Regional/Recent/Bookmarks/History/Collections — all read existing store state |
| Customization (show/hide/reorder/reset) | **IMPLEMENTED** | `CustomizeDash` + `setDashLayout`/`resetDashLayout`; pure `moveWidget`/`showWidget`/`hideWidget` |
| Per-profile persistence | **IMPLEMENTED** | `DashboardPrefs.visible` (+`v`) via existing profile index; no global storage |
| Persisted-config validation | **PASS** | `normalizeDashboardLayout` on read + write; drops unknown/dupes; safe default |
| Migration | **IMPLEMENTED** | `migrateDashboardLayout` on hydrate; legacy aliases; new widgets appended once |
| Private mode | **PASS** | activity widgets read non-private `historyRows`; "Private" indicator only |
| Profile switch | **PASS** | active-profile layout + existing transient resets; no cross-profile leakage |
| No fabricated status | **PASS** | VPN via `vpnUiProjection`; "No blocked requests yet"; no fake %/files/speed |
| Command palette | **IMPLEMENTED** | "Open Dashboard" + "Customize Dashboard" |
| Accessibility / tokens / motion | **PASS** | `<section aria-label>`+`<h3>`, dot+text, semantic tokens, reduced-motion |
| Performance / startup | **PASS** | no network/AI/polling at boot; one-shot lazy history load; no webviews |
| Security audit | **PASS** | `NEXA_STEP_11_SECURITY_AUDIT.md` |
| Tests / typecheck / build | **PASS** | 634/634 |
| GUI | **NOT_CONFIGURED — ENVIRONMENT** | headless |

## 7c. STEP 12 — Multi-Provider AI Architecture

| Capability | Status | Notes |
|---|---|---|
| Provider abstraction + registry | **IMPLEMENTED** | `AIProviderAdapter` + `AIProviderRegistry`; one unified `AIService` (no per-provider consumer services) |
| Model registry + capability detection | **IMPLEMENTED** | `src/shared/ai-providers.ts`; honest `supported/unsupported/unknown`; Ollama `/api/show` + curated cloud catalog |
| Ollama provider (migrated) | **IMPLEMENTED** | wraps existing `OllamaClient` (loopback, no 2nd runtime) |
| OpenAI / Anthropic providers | **IMPLEMENTED** | lightweight HTTPS + SSE; host-locked; disabled until key configured |
| Local-first routing | **PASS** | deterministic `routeAIRequest`; model never selects provider |
| Privacy policy | **PASS** | `local_only`/`local_preferred`/`cloud_allowed`; default local_only |
| Explicit fallback | **PASS** | `none`/`local_only`/`configured_provider`; local failure never escalates to cloud |
| Profile-scoped AI config | **IMPLEMENTED** | `<profileDir>/ai-config.json` validated on read; per-profile isolation |
| Secure API-key storage | **PASS** | OS `safeStorage` only (`ai.key.<provider>`); never renderer/JSON/logs |
| Provider health | **IMPLEMENTED** | real states incl. LOCAL_OFFLINE/NETWORK_OFFLINE/AUTH_ERROR/NOT_CONFIGURED |
| Streaming / cancellation | **PASS** | preserved via `ai.event`; SSE for cloud; AbortController throughout |
| Context budgeting | **IMPLEMENTED** | `planContextBudget` (reserve output, preserve priority, report truncation) |
| Prompt-injection defense | **PASS** | `wrapUntrusted`/`INJECTION_GUARD` for all providers (unchanged) |
| Agent / Worker / Vision / Embeddings | **PASS** | route through unified service; authority + confirm-to-submit intact; local embeddings default |
| Settings / Dashboard / Palette / Click-to-Go | **IMPLEMENTED** | provider cards + key entry + privacy/fallback; widget shows provider+model; commands added |
| Capability-specific IPC (no secrets) | **PASS** | `ai.providers`, `ai.provider.configure/remove/test`, `ai.config.get/update`; no generic bridges |
| Security audit | **PASS** | `NEXA_STEP_12_AI_SECURITY_AUDIT.md` |
| Tests / typecheck / build | **PASS** | 682/682 |
| Live Ollama | **NOT_CONFIGURED — ENVIRONMENT** | runtime down; new path proven via simulated loopback |
| Cloud providers | **NOT_CONFIGURED** | no credentials (valid state) |
| GUI | **NOT_CONFIGURED — ENVIRONMENT** | headless |

## 7d. STEP 13 — Browser Extensions Architecture + Runtime

| Capability | Status | Notes |
|---|---|---|
| Existing architecture audited | **DONE** | `NEXA_STEP_13_EXTENSION_AUDIT.md`; `<webview>` per-profile partitions + `session.extensions` (Electron 37) |
| MV3 validation | **IMPLEMENTED** | `validateManifest` (MV3-only, SW background, content-script matches, WAR); MV2 → UNSUPPORTED |
| Lifecycle | **IMPLEMENTED** | DISCOVERED→…→REMOVED + INVALID/BLOCKED/ERROR; transitions guarded; persisted per profile |
| Local installation | **IMPLEMENTED** | pick folder → main validates (preview) → permission review + confirm → load; no silent/remote install |
| Permission model | **IMPLEMENTED** | explicit taxonomy; high-risk flagged; forbidden → BLOCKED (never loaded) |
| Host-permission validation | **IMPLEMENTED** | http/https/*/`<all_urls>` only; file/chrome/devtools/electron/data/javascript rejected |
| Profile isolation | **PASS** | per-profile records + per-partition sessions; untrusted-on-read normalizer |
| Private-mode policy | **PASS** | disabled by default; opt-in per extension; ephemeral private partition |
| Extension storage | **IMPLEMENTED** | `chrome.storage` per-session → profile-isolated automatically |
| Content scripts / service workers | **SUPPORTED (runtime)** | isolated world; Chromium-managed SW; failure-isolated |
| Extension action | **PARTIALLY_SUPPORTED** | metadata + click; hosted popup rendering is a documented limitation |
| Extension Manager + permission UI | **IMPLEMENTED** | dense list, install/enable/disable/remove, details, site access, private toggle |
| Site access controls | **IMPLEMENTED** | Always / When clicked / On selected / Never (persisted) |
| Extension API boundary | **PASS** | no `nexa.*` to extensions; capability-specific Zod IPC; no generic bridge |
| AI integration | **DESIGN (gated)** | no bridge this phase; documented permission-gated route |
| Downloads via P2 / Protection P3 authority | **PASS (design)** | reuse P2 engine; P3 evaluates first over webRequest/DNR |
| VPN / Vault / Drive secrets inaccessible | **PASS** | no keys/tokens exposed |
| Command Palette / Click-to-Go / Dashboard | **IMPLEMENTED** | palette commands, keywords, compact widget (real state) |
| Security audit / compatibility / test matrix | **DONE** | `NEXA_STEP_13_EXTENSION_{SECURITY_AUDIT,COMPATIBILITY,TEST_MATRIX}.md` |
| Tests / typecheck / build | **PASS** | 732/732; typecheck + build pass; source guards added |
| Real MV3 extension | **PARTIAL** | `test-extension/` validates as MV3; live load needs GUI |
| GUI | **NOT_CONFIGURED — ENVIRONMENT** | headless |

## 8. Known limitations (environment)

- **Google Drive — live OAuth/API:** NOT_CONFIGURED — REQUIRES GOOGLE CLOUD OAUTH CREDENTIALS (`NEXA_GOOGLE_CLIENT_ID`). Code compiles, tests pass, and the UI honestly shows "Not configured" without secrets.
- **Privacy Center — site-visible public IP:** NOT_CONFIGURED (no external IP-echo shipped; local interface IPs are shown instead, clearly labelled).
- **Privacy Center — WebRTC public candidates / DNS leak certainty:** platform-dependent; conservative honest states.
- **VPN live native validation:** BLOCKED — ENVIRONMENT (no privileged desktop/WireGuard runtime here).
- **Vision live multimodal:** NOT CONFIGURED (no vision-capable Ollama model installed; honest `VISION_NOT_CONFIGURED`).
- **Interactive Chromium GUI validation:** BLOCKED — ENVIRONMENT (headless).
- **Vault autofill GUI validation:** NOT_CONFIGURED (headless; behaviour covered by unit + source-guard tests).
- **Registrable-domain matching:** compact multi-label suffix set, not the full Public Suffix List (documented in `protection.ts`).

## 9. Hardening & Release-Readiness (post-P13) — status updates

These supersede earlier factual claims where noted. See
`NEXA_HARDENING_CHANGELOG.md` and `NEXA_RELEASE_READINESS_FINAL.md`.

| Area | Prior | Now |
|------|-------|-----|
| **Lint** | NOT CONFIGURED (stub) | **PASS** — real ESLint flat config (typescript-eslint + react-hooks), `eslint . --max-warnings 0` = 0 errors / 0 warnings |
| **SEC-1 permission policy** | handler on defaultSession only | **PASS** — deny-by-default on defaultSession + every profile persist/private partition; 14 tests |
| **Electron** | 37.10.3 | **44.4.1** — runtime + extract-zip advisories resolved; async `clipboard` adapted |
| **npm audit** | 4 (2 moderate, 2 high) | **2 moderate** (dev-only vitest); runtime advisories resolved |
| **Tests** | 732/732 | **746/746** |
| **Release channel** | hardcoded `'dev'` | honest `app.isPackaged ? 'stable' : 'dev'` |
| **DOC-1 `prefs.extState`** | unused debt | retained + documented (removable via future migration) |
| **macOS signing** | none | hardened runtime + entitlements ready (inert without identity) |
| **Runtime/GUI on Electron 44** | — | BLOCKED — ENVIRONMENT (required release gate) |
