# NEXA P0–P13 — Consolidated Production Audit

*Audit only. No code was modified. Repository source is the source of truth;
prior phase reports are supporting evidence. Companion docs:
`NEXA_P0_P13_ARCHITECTURE_AUDIT.md`, `…_SECURITY_AUDIT.md`,
`…_PERFORMANCE_AUDIT.md`, `…_TEST_AUDIT.md`.*

---

## 1. Executive Summary

NEXA is an Electron 37 + React 19 + TypeScript browser with 13 completed phases.
The implementation is **architecturally coherent and security-first**: a single
sandboxed renderer, a single typed IPC surface, one owner-service per capability,
per-profile session partitions, secrets confined to the main process behind
`safeStorage`, and pure/shared contracts that are heavily unit-tested.

Verification at audit time: **732/732 tests pass, typecheck passes, build passes.**
Lint is **NOT_CONFIGURED** (placeholder). `npm audit` shows **4 vulnerabilities
(2 moderate, 2 high)** rooted in Electron 37 + a build-time transitive
(`extract-zip`), fixable only via a major Electron upgrade.

Two Medium findings warrant attention before a public release: (SEC-1) the device
permission policy is applied only to `defaultSession`, not to the profile
partitions where tabs actually run; and (SEC-2) the dependency advisories. Neither
is a confirmed data leak. No P0/P1 blocking security defects were found.

**Decision: PRODUCTION-READY WITH LIMITATIONS** (targeted hardening + environment
validation required before shipping a signed build).

---

## 2. Current Architecture
See `NEXA_P0_P13_ARCHITECTURE_AUDIT.md`. Highlights: sandboxed renderer;
`window.nexa` = invoke-wrappers only; ~150 capability-specific channels; per-profile
`persist:nexa-<id>` + in-memory `nexa-private-<id>` partitions; explicit deny
firewall for AI/cloud/extension → vault. No circular deps, no duplicate services,
no renderer leakage of privileged concerns.

## 3. Security Audit
See `NEXA_P0_P13_SECURITY_AUDIT.md`. `sandbox/contextIsolation/webSecurity` on,
`nodeIntegration` off, strict CSP (`script-src 'self'`). No `eval`/`new Function`/
`shell:true`. `executeJavaScript`/`execFile` are controlled (fixed templates;
`shell:false`). Zero `as any`/`@ts-ignore`. Secrets stay in main. **SEC-1 (P2):**
permission handler only on `defaultSession`. **SEC-2 (P2):** dependency advisories.

## 4. IPC Audit
Single registry (`shared/channels.ts`) + single handler module
(`main/ipc/register.ts`) with Zod parse and `safeError()`. Capability-specific
naming; no generic `execute/invoke(arbitrary)/fetch/fs/shell`. `agent.*` remains one
typed architecture (no per-tool IPC duplication — correct). Deny firewall channels
throw `denied`. **PASS.**

## 5. Profile Isolation
`assertSafeProfileId` enforced at every stateful service boundary (11 services +
register). Persistence is per-profile dir; sessions are per-profile partitions.
Renderer has **no** `localStorage/sessionStorage/indexedDB` — state is persisted via
IPC to profile-scoped files. **PASS.**

## 6. Private Mode
Private content uses `nexa-private-<id>` (no `persist:` → in-memory). Downloads,
protection, regional, and extensions all branch on the private partition.
Extensions are disabled in private by default (opt-in). **PASS.**

## 7. P2 Downloads
Real Chromium `will-download` engine (`downloads.ts`): progress/speed/ETA, pause/
resume/cancel/retry, queue + concurrency, destination, `sanitizeFilename` (reserved
names, path-separator + `..` rejection), duplicate handling, per-profile + private
partitions. Drive and (future) extension downloads route here — no second engine.
**PASS** (races around cancel/retry/shutdown covered by service tests; live churn
= inspection-level).

## 8. P3 Protection
`webRequest`-based blocking with rules/exceptions/site overrides/stats, attached per
partition (persist + private). Cannot become global/cross-profile (per-partition
attach + `assertSafeProfileId`). Remains authoritative over extension webRequest/DNR
(documented precedence in P13). **PASS.**

## 9. P4 VPN
WireGuard parser + validation, platform adapters, privileged **helper process**
(`src/helper`, `execFile` with `shell:false`), health polling with cleanup, kill
switch/DNS/handshake handling in code. `PROTECTED` state is verification-gated in
logic. Live tunnel = **BLOCKED — ENVIRONMENT** (no privileged helper/WireGuard here).
**PASS WITH LIMITATIONS.**

## 10. P5 AI
Page extraction/readability/sanitization, chunking, injection defense
(`wrapUntrusted`/`INJECTION_GUARD`), Q&A/summarize/explain/translate/rewrite,
streaming + cancellation (AbortController), profile-scoped context. Page content is
treated as untrusted data. **PASS.**

## 11. P5.1 Agent
`Planner → PermissionEngine → Tool Registry → AgentService → renderer adapter →
Chromium`. Model output is a **plan**; execution is a fixed `switch` of semantic
tools (no raw model JS). `AGENT_MAX_STEPS=25`, no-progress detection, pause/resume/
cancel, permission modes, secret-field handling. **PASS.**

## 12. P5.2 Tools
Semantic targeting via ephemeral `data-nx-eid`, DOM/A11y observation, ambiguity
handling; tools validated (`agent-p52-tools.test.ts`). Arguments JSON-escaped into
fixed snippets. **PASS.**

## 13. P5.3 Vision
Visual observation / screenshot handling gated by capability + privacy; honest
`VISION_NOT_SUPPORTED`/`NOT_CONFIGURED` (`ai-vision.test.ts`, `vision.ts`).
**PASS (code); live multimodal = NOT_CONFIGURED.**

## 14. Worker
`Scan → Understand → Suggest → Edit → Fill → user confirms Submit`; no silent submit
(guard-tested). Question/form/checkbox/option detection, sensitive-field handling,
profile isolation, private mode (`worker.test.ts`). **PASS.**

## 15. Vault
PBKDF2 + AES-GCM + safeStorage (no downgrade — `vault-crypto.test.ts`). Origin
matching (scheme/host/port/registrable domain), `injectCredential` keeps secrets in
main, reveal/copy only on explicit user action against an unlocked vault. **PASS.**

## 16. Privacy Center
Diagnostics (IP/DNS/WebRTC/fingerprint/HTTPS/IPv6/VPN/protection) with honest
`SUPPORTED/PARTIALLY_SUPPORTED/NOT_CONFIGURED`; external public-IP echo is
NOT_CONFIGURED (local interface IPs shown, labelled). **PASS WITH LIMITATIONS.**

## 17. Drive
OAuth + PKCE + state + loopback redirect; tokens stored via `secure`
(safeStorage), **never** returned to renderer (`getStatus` = metadata only); Bearer
only in main-side `fetch`; downloads via P2; disconnect revokes. Live OAuth =
NOT_CONFIGURED (needs `NEXA_GOOGLE_CLIENT_ID`). **PASS WITH LIMITATIONS.**

## 18. Turbo
Preconnect + navigation-timing projection; no fake speed/benchmark claims
(guard-tested); sensitive/private/cross-profile prediction gated. **PASS.**

## 19. Regional
IANA timezone + BCP47 locale + Accept-Language at session level; page-runtime
timezone/locale honestly **PARTIALLY_SUPPORTED**; no Date/Intl monkey-patch, no
navigator/fingerprint spoofing, no CDP override (`regional.ts`, `regional.test.ts`).
**PASS.**

## 20. Dashboard
Widgets are projections of real state (Downloads/Protection/VPN/AI/Worker/Drive/
Privacy/Turbo/Profile/Regional/Recent/Bookmarks/Collections/History/Extensions); no
duplicate engines; layout persisted per profile, migrated + validated on read
(`dashboard.test.ts`). **PASS.**

## 21. Extensions (P13)
MV3 validator, permission taxonomy + risk class, host-permission parser (rejects
file/chrome/devtools/electron/data/javascript), lifecycle, per-profile records,
`session.extensions` load with **`allowFileAccess:false`** on every load, private
opt-in, capability IPC (no `extension.execute/fetch/fs/shell/ipc`). Action popup
rendering PARTIAL; history/bookmarks/identity/sidePanel UNSUPPORTED (honest).
**PASS (runtime live-load = NOT_CONFIGURED — ENVIRONMENT).**

## 22. Multi-Provider AI (P12)
Provider/model registry, Ollama/OpenAI/Anthropic, deterministic routing, privacy
modes, explicit fallback, profile config, safeStorage keys, health, streaming,
context budget, vision/embeddings, honest cost model. Keys never in renderer/
localStorage/logs/plain persistence/IPC responses/context (guard-tested). Local-first
default. **PASS (live providers = NOT_CONFIGURED).**

## 23. Performance
See `…_PERFORMANCE_AUDIT.md`. Lazy AI/extension init; bounded+cleaned timers; agent
step caps; no renderer web-storage. **PERF-1 (P3):** single ~1.56 MB renderer chunk.
Measured latency/memory = BLOCKED — ENVIRONMENT. **PASS WITH LIMITATIONS.**

## 24. Accessibility
Design system + guard tests assert semantic headings, `aria-label`s, focus-visible
tokens, reduced-motion, contrast tokens (`theme-tokens.test.ts`). Full manual AT/
keyboard sweep across every dialog = NOT_CONFIGURED — ENVIRONMENT. **PASS WITH
LIMITATIONS.**

## 25. Storage

| Data | Storage | Scope | Encryption | Profile-scoped | Private-mode | Sensitive |
|------|---------|-------|------------|----------------|--------------|-----------|
| Prefs/session | JSON (`profileDir`) | profile | no | yes | n/a | no |
| Bookmarks/history/collections | JSON | profile | no | yes | not recorded in private | no |
| Downloads store | JSON | profile | no | yes | private partition | no |
| Protection rules/stats | JSON | profile | no | yes | per-partition | no |
| AI config | `ai-config.json` | profile | no | yes | n/a | no |
| AI provider keys | safeStorage (`ai.key.<id>`) | profile | **yes** | yes | n/a | **yes** |
| Drive tokens | safeStorage (`TOKEN_KEY`) | profile | **yes** | yes | n/a | **yes** |
| Vault | safeStorage + AES-GCM | profile | **yes** | yes | n/a | **yes** |
| Extensions records | `extensions.json` | profile | no | yes | ephemeral private partition | no |
| Extension storage | Chromium per-session | profile/ext | per-Chromium | yes | in-memory (private) | varies |

No global/localStorage leakage; no profile collision (`assertSafeProfileId`). All
persisted records are untrusted-on-read (normalizers). **PASS.**

## 26. State Management
Single Zustand store; profile switch resets AI/providers/config/extensions and
re-hydrates; event channels update lists live. No web-storage; no secrets in store
(guard: `store` never sets `apiKey`). Potential hydration/profile-switch races exist
by nature (async loads) but are ordered and idempotent. **PASS (INFO: verify
switch-during-inflight-load ordering under GUI).**

## 27. Concurrency
Reviewed: profile switch, private mode, download queue, VPN connect/disconnect,
extension enable/disable, Drive disconnect, AI/agent cancellation, shutdown. Guards:
AbortController for AI/agent, `safeRemove` guards for extensions, timer cleanup,
`before-quit` disposal. Live race reproduction = ENVIRONMENT. **PASS (inspection).**

## 28. Testing
732/732 pass, 0 skipped; typecheck+build pass; security grep clean. Boundary
coverage is strong (isolation, secrets, IPC, extension runtime, AI routing, vault).
No coverage metric (no tooling). See `…_TEST_AUDIT.md`. **PASS.**

## 29. Build
`electron-vite build` emits main + preload + renderer. No dev-only code/secrets in
output inspected; renderer is one large chunk (PERF-1). Packaging (`electron-builder`)
present; signed packaging = NOT_CONFIGURED. **PASS WITH LIMITATIONS.**

## 30. Dependencies
`npm audit`: 4 (2 moderate, 2 high). `extract-zip` high (symlink traversal) is a
build/packaging transitive; Electron 37 advisories apply to runtime, mitigated
in-app. Fix = Electron 44 (breaking). **PASS WITH LIMITATIONS — SEC-2.**

## 31. Documentation
Rolling audits (`NEXA_IMPLEMENTATION_AUDIT.md`, `NEXA_DESIGN_AUDIT.md`) and per-step
reports match code; lint honestly documented as NOT_CONFIGURED. Stale item:
`prefs.extState` remains in `shared/types.ts` after P13 replaced the static
extensions list (unused field). **PASS (INFO: DOC-1 remove unused pref later).**

## 32. Environment Limitations
GUI, signed build, WireGuard helper, Google OAuth creds, live AI providers, live
extension load, external IP-echo — all **BLOCKED/NOT_CONFIGURED — ENVIRONMENT**, not
code failures.

## 33. Findings

| ID | Sev | Area | File/Evidence | Summary | Action |
|----|-----|------|---------------|---------|--------|
| SEC-1 | P2 | Security | `main/index.ts:122` vs partitions (`App.tsx:1282`) | Permission handler only on defaultSession; tabs run on partitions | Install permission request/check handler on profile partitions |
| SEC-2 | P2 | Dependencies | `npm audit` | 2 high (extract-zip) + Electron 37 advisories; fix = Electron 44 | Plan dependency-upgrade phase |
| PERF-1 | P3 | Performance | build output | Single ~1.56 MB renderer chunk | Optional view-level code splitting |
| DOC-1 | INFO | Docs/Types | `shared/types.ts:150,312` | Unused `prefs.extState` after P13 | Remove field in a cleanup pass |
| INFO-1 | INFO | Security | `register.ts:109–140` | `injectCredential` uses fixed template + JSON-escaped secret | None (documented control) |
| INFO-2 | INFO | Security | CSP `index.ts:31` | `style-src 'unsafe-inline'` (React inline styles) | Acceptable exception |
| INFO-3 | INFO | Perf | `App.tsx:3303` | 5 s AI status poll (gated + cleared) | Acceptable |

No P0 or P1 findings.

## 34. Production Readiness Matrix

| Area | Status | Evidence | Risk | Action |
|------|--------|----------|------|--------|
| Architecture | PASS | single IPC, no cycles/dupes | Low | — |
| Security | PASS WITH LIMITATIONS | sandbox/CSP/no-eval; SEC-1 | Med | partition permission handler |
| IPC | PASS | Zod + capability-specific | Low | — |
| Profiles | PASS | assertSafeProfileId ×11 | Low | — |
| Private Mode | PASS | in-memory partitions | Low | — |
| Downloads | PASS | real DownloadItem + sanitize | Low | — |
| Protection | PASS | per-partition webRequest | Low | — |
| VPN | PASS WITH LIMITATIONS | helper + shell:false | Med | live validation |
| AI | PASS | injection guard + routing | Low | — |
| Agent | PASS | plan/authorize/fixed-exec, step cap | Low | — |
| Worker | PASS | no silent submit | Low | — |
| Vault | PASS | PBKDF2/AES-GCM/safeStorage | Low | — |
| Privacy | PASS WITH LIMITATIONS | honest states | Low | external IP echo |
| Drive | PASS WITH LIMITATIONS | tokens main-only | Low | live OAuth |
| Turbo | PASS | no fake claims | Low | — |
| Regional | PASS | no spoofing; honest partial | Low | — |
| Dashboard | PASS | real-state projections | Low | — |
| Extensions | PASS | MV3 + allowFileAccess:false | Low | live load |
| Multi-Provider AI | PASS | safeStorage keys, local-first | Low | live providers |
| Performance | PASS WITH LIMITATIONS | bounded timers; PERF-1 | Low | code-split |
| Accessibility | PASS WITH LIMITATIONS | tokens + guards | Low | manual AT sweep |
| Testing | PASS | 732/732 | Low | add coverage tool |
| Build | PASS WITH LIMITATIONS | emits all targets | Low | — |
| Packaging | NOT_CONFIGURED | no signing creds | Med | signed build |
| Documentation | PASS | matches code; DOC-1 | Low | remove extState |

## 35. Recommended Next Actions

### MUST FIX BEFORE RELEASE (blockers)
None. No P0/P1 defects found.

### SHOULD FIX BEFORE BETA
- **SEC-1:** apply `setPermissionRequestHandler` + `setPermissionCheckHandler` to
  the profile partitions (persist + private), mirroring the defaultSession policy.
- **SEC-2:** schedule the Electron upgrade (addresses runtime + `extract-zip`
  advisories) as an isolated, well-tested phase.
- Configure **ESLint** (replace the `echo` placeholder) so lint is a real gate.

### FUTURE HARDENING (non-blocking)
- **PERF-1:** view-level code splitting to shrink initial renderer parse.
- **DOC-1:** remove the unused `prefs.extState` field.
- Add a coverage tool to quantify boundary coverage.
- Consider a scheme allowlist assertion around `shell.openExternal` (already
  http/https-gated).

### ENVIRONMENT VALIDATION (needs real infrastructure)
- Signed/packaged builds (macOS/Windows/Linux) — signing credentials.
- WireGuard tunnel end-to-end — privileged helper on a real device.
- Google Drive live OAuth — `NEXA_GOOGLE_CLIENT_ID`.
- Live Ollama + cloud providers — runtime + API keys.
- Live Chromium extension load / content script / service worker — GUI session.
- GUI/accessibility sweep across resolutions + themes; measured latency/memory.

---

## P0–P13 AUDIT COMPLETE

- **Current blockers:** none (no P0/P1).
- **Current limitations:** SEC-1 (partition permission policy), SEC-2 (dependency
  advisories, Electron upgrade needed), packaging unsigned, several
  environment-only validations pending.
- **Current technical debt:** PERF-1 (single renderer chunk), DOC-1 (unused
  `extState`), lint placeholder, no coverage tooling.
- **Environment-only validation:** signed build, WireGuard, Google OAuth, live AI,
  live extension load, GUI/accessibility, measured performance.
- **Recommended next development phase:** a **Hardening & Release-Readiness** phase
  (SEC-1 partition permissions, ESLint, Electron upgrade, signed packaging,
  environment validation) — **not** a new feature phase.

**Final decision: PRODUCTION-READY WITH LIMITATIONS.**

*Audit task complete — no code was modified. STOP.*
