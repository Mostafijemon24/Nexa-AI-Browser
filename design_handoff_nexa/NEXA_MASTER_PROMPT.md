# NEXA BROWSER — MASTER IMPLEMENTATION PROMPT

**Paste this file into Cursor together with the NEXA repository and the rest of
`design_handoff_nexa/`.** It is the single authoritative instruction set for turning the
approved NEXA design into a real, installable desktop browser.

---

## 0. ROLE

You are the Principal Product Architect, Senior UX Engineer, Frontend Architect, Electron
Engineer, Security Engineer and QA Lead working **inside the existing NEXA repository**.

Your job is:

```
AUDIT → UNDERSTAND → REUSE → EXTEND → VERIFY
```

You are **not** building a new browser. You are implementing an approved design on top of
existing work.

---

## 1. WHAT NEXA IS

**NEXA — The Open-Source AI Browser Built Around Downloads.**
Tagline: *Browse. Protect. Download. Understand. Transfer.*

A Chromium-based desktop browser (macOS / Windows / Linux) unifying:
browsing · AI assistant & agent · IDM-class download engine · content protection (ad/tracker
blocking) · VPN/network layer · cloud transfer (Drive/GCS/Dropbox/OneDrive/S3) · local
encrypted password manager · profiles & workspaces · personalization/theme engine ·
Click-to-Go navigation · Worker Assistant · Privacy Center · Turbo Navigation.

---

## 2. INPUTS YOU ARE GIVEN

| File | What it is |
|---|---|
| `NEXA_prototype.dc.html` | **High-fidelity design reference.** Interactive, but an HTML prototype — NOT shippable code. |
| `NEXA_DESIGN_SYSTEM.md` | Exact tokens: color, type, spacing, radii, shadow, motion. |
| `NEXA_FEATURE_MATRIX.md` | Per-feature status: functional / simulated / requires-backend. |
| `NEXA_ARCHITECTURE.md` | Target architecture, platform adapters, IPC, state model. |
| `NEXA_SECURITY.md` | Vault crypto, firewalls, threat model, data-flow, privacy defaults. |
| `NEXA_CROSS_PLATFORM.md` | Build matrix, packaging, signing, installers, auto-update. |
| `NEXA_CURSOR_EXECUTION_PLAN.md` | Phased P0–P6 order. |
| `NEXA_FINAL.md` | Honest status of what the prototype already proves. |

**Recreate the design in the real app. Do not paste prototype HTML into production.**

---

## 3. ABSOLUTE RULES

### 3.1 Preserve
The existing NEXA design and architecture are **sacred**. Preserve the browser shell, tabs,
toolbar, address bar, sidebar, status bar, settings architecture, command palette,
dashboard, download UI, AI panel, VPN UI, cloud UI, profile UI, design tokens, typography,
icons, spacing, radii, shadows, light/dark themes and interaction patterns.

### 3.2 Never duplicate
Do **not** create a second: AI runtime · Ollama client · AgentService · observation engine ·
download engine · protection engine · permission engine · command palette · profile engine ·
IPC architecture · design system · component library · settings architecture · sidebar.

Prefer **extend / compose / reuse / adapter / wrapper** over **rewrite / replace / duplicate**.

### 3.3 Never fake
No fake functionality, fake data, fake success, fake security, fake VPN status, fake cloud
connection, fake auth, fake download progress, fake metrics, fake update results.
Use honest runtime states instead:

```
READY · CONNECTING · CONNECTED · OFF · ERROR
NOT CONFIGURED · REQUIRES AUTH · REQUIRES PERMISSION
EXPERIMENTAL · BLOCKED — ENVIRONMENT · COMING SOON
```

### 3.4 No dead buttons
Every visible interactive control must: work, or open a real screen, or show a real
unavailable state — or not exist.

### 3.5 Security is non-negotiable
> AI decides what it wants to do. NEXA decides whether it is allowed. Chromium performs the action.

AI, extensions, cloud and the renderer must **never** reach: shell · filesystem · OS commands ·
arbitrary IPC · arbitrary JS · the password vault · cookies · OAuth tokens · API keys ·
payment data. High-risk actions stay confirmation-gated. Never implement anti-fraud or
anti-abuse evasion. Never claim absolute anonymity.

### 3.6 Do not visually overdesign
No giant cards, excessive rounded corners, glassmorphism, neon/gaming aesthetics,
unnecessary gradients, excessive animation, dashboard clutter, or Chrome cloning.

---

## 4. METHOD (follow in order)

1. **Audit the actual repository** — package.json, source tree, Electron main, preload,
   shared layer, renderer, stores, design tokens, shell, tabs, toolbar, address bar, sidebar,
   dashboard, settings, command palette, profiles, downloads, protection, VPN, AI, agent,
   observation engine, vision layer, IPC, security boundaries, tests, docs. **Never assume a
   feature exists because this prompt mentions it.** Do not guess filenames.
2. **Baseline** — run `npm test`, `npm run typecheck`, `npm run build`, lint. Record results.
3. **Write `NEXA_IMPLEMENTATION_AUDIT.md`** — for each feature: current behavior, expected
   behavior, affected files, affected services, missing backend, status
   (IMPLEMENTED / PARTIAL / NOT CONFIGURED / EXPERIMENTAL / BLOCKED), risks, tests.
   **Only then write feature code.**
4. **Implement the design system as tokens first.** Never scatter literals.
5. **Implement by phase** (§6), smallest-diff-first, modular — not one giant component.
6. **Verify each feature** against the Definition of Done (§5).
7. **Final gates** — tests, typecheck, build, lint, security review, visual QA, docs, final audit.

---

## 5. DEFINITION OF DONE (per feature)

```
UI → EVENT HANDLER → STATE CHANGE → SERVICE/BACKEND → PERSISTENCE
   → UI UPDATE → SUCCESS/ERROR FEEDBACK → RESTART RESTORE
   → PROFILE ISOLATION → TEST
```

A toggle must change real state. A dropdown must **open a menu** and change value only on
selection (never instant-change on click). A menu item must not open an empty panel. A
setting must survive restart unless intentionally session-only. Profile-scoped data must not
leak between profiles.

---

## 6. IMPLEMENTATION PHASES

### P0 — Foundation
Renderer sandbox + strong CSP · typed, Zod-validated, permission-checked IPC (no generic
`execute()`/`invoke()`/`run()`) · `PlatformAdapter` + Windows/macOS/Linux implementations ·
design-token system + light/dark + runtime accent-variant generation · central state
architecture · persistence layer with **profile-scoped vs global** separation · OS secure
credential storage adapter · secret scanning in CI.

### P1 — Core browser
Browser shell (collapsible title bar **hidden by default**, persisted; tab strip; toolbar;
collapsible sidebar; contextual status bar) · real tabs (open/close/switch/close-others/
close-left/close-right/close-all/reopen ⌘⇧T/pin/duplicate/move/context menu/session restore;
define valid final-tab behavior) · profiles with **real isolation** (unlimited logical
profiles, no artificial cap) · workspaces bound to real tab/session sets · **bookmarks
(currently a placeholder — implement fully:** add/edit/delete/open/folders/nested/search/
bar/manager/drag-drop/import-export, Chromium-compatible) · history · collections ·
**full-page Settings** with real dropdowns + keyboard support + persistence · command palette
routed to the same services the UI uses · theme engine (presets, accent, address-bar styles,
radius/density/motion, ambient backgrounds, reduced-motion).

### P2 — Downloads · Cloud · AI · VPN
Native download engine (multi-connection/segmented, pause/resume/retry/queue/priority/
schedule/bandwidth limit/ETA/integrity/recovery) wired to the existing Downloads UI,
detection popover, destination picker, detail drawer, and **clear completed / failed /
cancelled / all history** (clearing records must never delete files from disk) ·
cloud transfer with OAuth + real folder pickers + local↔cloud↔cloud transfers, tokens in the
OS credential store via typed IPC only · AI provider abstraction (OpenAI-compatible,
Anthropic, Google, Ollama, LM Studio, custom endpoint), **local-first default**, ASK/ASSIST/
AGENT preserved, execution-plan confirmation before consequential actions, granular context
permissions · VPN adapters (WireGuard/OpenVPN/SOCKS5/proxy) with kill switch, DNS, WebRTC/
IPv6 leak protection, split tunneling, diagnostics, per-download and per-transfer routing.
**Never show "Protected" without a verified tunnel.**

### P3 — Security · Protection · Extensions
Port the prototype's **real WebCrypto vault** (PBKDF2-SHA256 210k → AES-GCM-256; stored blob
is `{v,salt,iters,iv,ct}`; plaintext never persisted; decrypted entries memory-only) and
**seal the derived key to the OS keychain** (macOS Keychain / Windows DPAPI / Linux Secret
Service). Auto-lock (default 5 min) + lock on profile switch. Clipboard clears after 30s.
Never log secrets. **Fail-closed autofill:** validate scheme+host+port+origin+frame; block
cross-origin, look-alike domains and iframe leakage; password requires strict origin match.
Generator uses CSPRNG only. Strength/reuse analysis stays on-device.
Content Protection engine (EasyList-compatible network + cosmetic filtering, Balanced/Strict/
Custom, categories, filter-list auto-update, per-site exceptions, custom rules, logger, **real
counters**) · Chromium extensions (sandboxed, least-privilege, explicit permissions, **no
vault/AI-key/VPN-credential access**, enable/disable/remove/details/reload/developer mode/
load-unpacked) · Chromium DevTools (F12) · Security Center + Privacy Center bound to real
subsystem state · data export/deletion controls.

### P4 — Click-to-Go · Worker · Privacy Center · Drive · Turbo
- **Click-to-Go** — integrated into the address bar (not a separate launcher). Focus/affordance
  opens a grouped panel: Websites · NEXA Actions · Downloads · Privacy · Profiles. Central
  intent resolver: `input → intent → capability validation → permission check → execute`,
  ranked (exact → prefix → keyword → substring). Keyboard: ⌘/Ctrl+L, ↑/↓, ⏎, Esc; click-outside
  closes without selecting. Unknown input stays normal URL/search. **Only registered NEXA
  capabilities may be invoked — never shell, filesystem, OS commands, arbitrary JS or arbitrary
  IPC.** State-aware (e.g. *Connect Drive* vs *Open Drive*); gated intents show "Requires
  permission" and never execute silently.
- **Worker Assistant** — a **UX preset over the existing AI/agent architecture, not a fourth
  runtime**. Flow: `SCAN → UNDERSTAND → SUGGEST → USER REVIEWS → FILL → USER SUBMITS`.
  Reuse the existing observation engine for scanning (questions, forms, text fields,
  checkbox/radio/select, buttons, tables, lists) via DOM + accessibility tree + semantic map +
  vision where available. Suggest answers via the existing AI service; allow Use / Edit / Copy;
  fill only selected fields on explicit action. **NEXA must never silently submit a form.**
  Smart Fill is allowed for ordinary fields (name, email, phone, address, text);
  **password, OTP, card number, CVV, API keys and tokens stay confirmation-gated or NOT
  CONFIGURED.** Never guess ambiguous targets — use semantic element IDs.
- **Privacy Center** — unified dashboard: IP, DNS, WebRTC, IPv6, fingerprint, HTTPS, trackers,
  VPN, plus **Run Privacy Check**. Real diagnostics only; states `VERIFIED / LEAK DETECTED /
  NOT CONFIGURED / UNAVAILABLE`. Fingerprint is **audit/reduce exposure only**. Never fabricate
  IP/DNS/WebRTC/fingerprint/VPN results. Do not market as guaranteed anonymity.
- **Google Drive click-to-connect** — `Not Connected → [Connect Drive] → OAuth → Connected →
  Browse / Download`. Least-privilege scopes. Tokens **never** in renderer, localStorage,
  IndexedDB, logs, UI state or generic IPC. Downloads route through the **existing** download
  engine and appear in the existing Download Manager. Only expose actions that actually work.
- **Turbo Navigation** — real optimizations only: connection reuse, DNS/HTTP cache reuse,
  preconnect, *safe* prefetch, local navigation prediction, protection-driven request
  reduction. States: Active / Optimizing / Limited / Off. **Never promise "1 second", never
  display fabricated speed metrics, never break sites, never blanket-disable JavaScript or
  block essential resources.** Prediction stays local — never ship browsing history to a cloud
  service for prediction.

### P5 — Profiles · Regional · Personalization
Per-profile identity (name, status, avatar upload with validation/resize + initials fallback,
accent) · per-profile **dashboard customization** (widget registry, show/hide/reorder, quick
actions, layout compact/comfortable/spacious, greeting, reset) with **one source of truth**
shared by Home, Settings, profile menu and command palette · per-profile **timezone** and
**language/locale** — implement only what Chromium/Electron genuinely supports; label anything
else **EXPERIMENTAL** or **NOT CONFIGURED**, and never claim website-level locale/timezone
spoofing · profile-scoped AI context (memory-only by default, never shared across profiles,
never persisted in private mode) · private mode isolation.

### P6 — QA · Packaging · Release
Visual regression at **1280×800 / 1440×900 / 1920×1080 / 2560×1440**, light + dark, OS scaling
100–200% · accessibility (keyboard nav, visible focus, ARIA, contrast, reduced motion, screen
readers; Click-to-Go, Worker and the profile switcher must be fully keyboard-operable; never
use color as the only state signal) · performance (no unnecessary rerenders, memory leaks,
global expensive observers, continuous screenshot capture, excessive polling, huge DOM dumps;
lazy-load hidden widgets and secondary UI; keep the shell instantly responsive; **no artificial
delays or fake progress**) · signed installers for macOS (.app/.dmg + notarization), Windows
(.exe/.msi) and Linux (AppImage/.deb) · signed auto-update channel with integrity + rollback ·
About page wired to real actions and real version/build/Chromium data.

---

## 7. TESTS TO ADD

**Click-to-Go:** URL · search · known service · NEXA command · unknown input · ambiguous input ·
permission-required action · keyboard navigation · outside-click does not select.
**Worker:** scan · question detection · suggestion · edit · copy · fill · confirmation gate ·
sensitive-field protection · **no silent submit**.
**Profiles:** create · switch · rename · delete · isolation · timezone · locale · private mode ·
persistence.
**Bookmarks:** add · edit · delete · folders · nested · search · import · export · persistence.
**Downloads:** folder selection · concurrency · start/pause/resume/cancel/retry · clear
completed/failed/history without deleting files · real state integration.
**Privacy:** honest states · no fabricated data · profile isolation.
**Drive:** disconnected · OAuth · connected · download via existing engine · token isolation.
**Turbo:** enabled · disabled · capability unavailable · no fake metrics.
**Vault:** create/unlock/lock · CRUD · auto-lock · wrong-origin autofill **BLOCKED** ·
renderer→vault **BLOCKED** · extension→vault **BLOCKED** · tampered vault detected ·
malformed import rejected · invalid profile-id IPC rejected.
**Settings:** change · persist · restart · reset · profile scope.
**AI (via the real NEXA code path, not a bypass):** page understanding · question detection ·
answer suggestion · tool selection · prompt-injection resistance · sensitive-data handling.

---

## 8. FINAL REPORT

Produce `NEXA_FINAL.md` containing: existing-feature audit · features implemented · UI changes ·
Click-to-Go · Worker · Profiles · Privacy · Drive · Turbo · command palette · toolbar · dashboard ·
security audit · privacy audit · test results · AI validation · typecheck · build · lint ·
visual QA · files changed · files added · known limitations · **NOT CONFIGURED** features ·
**BLOCKED — ENVIRONMENT** features.

Also produce (or update): `NEXA_IMPLEMENTATION_AUDIT.md`, `NEXA_DESIGN_AUDIT.md`,
`NEXA_SECURITY_AUDIT.md`, `NEXA_TEST_MATRIX.md`.

Final status must be **exactly one** of:

```
READY
READY WITH LIMITATIONS
NOT READY
```

Do not claim READY if important functionality is unverified. Do not claim a feature is
implemented when it is only visually mocked.

---

## 9. ACCEPTANCE

**Design:** NEXA identity recognizable · no unnecessary redesign · no second design system ·
light/dark consistent.
**Click-to-Go:** address-bar integrated · fast · keyboard accessible · URL/search intact ·
registered commands work · no arbitrary execution.
**Worker:** scan→suggest→review→fill · existing AI/agent reused · no silent submit ·
sensitive fields protected.
**Profiles:** no artificial cap · real isolation · timezone/locale honest.
**Privacy:** real diagnostics · honest states · no fabricated security.
**Drive:** click-to-connect · secure OAuth · connected state · download via existing engine.
**Turbo:** real optimization · no fake claims or metrics · no artificial delays.
**Security:** boundaries preserved · no generic IPC · no shell · no arbitrary JS · no credential
leakage · no anti-fraud bypass.
**Quality:** `npm test` PASS · `npm run typecheck` PASS · `npm run build` PASS · `npm run lint`
PASS · **no regressions**.

---

## 10. MOST IMPORTANT RULE

> **DO NOT REBUILD NEXA. EVOLVE IT.**

The result must feel like *the same NEXA browser — faster, smarter, more private, more useful,
dramatically easier to operate* — not a different product. Simple on the surface, powerful
underneath.

**NEXA — Browse. Protect. Download. Understand. Transfer.**
