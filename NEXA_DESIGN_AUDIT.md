# NEXA — Design Audit (STEP 0 + STEP 1 + STEP 2 + STEP 3)

> Visual reference = `design_handoff_nexa/` (`NEXA_DESIGN_SYSTEM.md`, `NEXA_FEATURE_MATRIX.md`,
> `Conduit.dc.html` prototype, `assets/`). Compared against the real renderer.
> STEP 0 = audit · STEP 1 = design-system · STEP 2 = browser-shell · **STEP 3 = app surfaces (below).**

Status legend: **IMPLEMENTED · PARTIAL · MISSING · NOT CONFIGURED · EXPERIMENTAL**

---

## STEP 3 — App Surfaces Pass (Dashboard · Sidebar · Settings · Command Palette)

**Command Palette** — added the missing **keyboard navigation** (Arrow/Enter/Esc + hover-select,
token-based selected row) and **category grouping** (Browser/Library/Downloads/Protection/AI/Agent/
VPN/Appearance/Privacy&Vault/App via a pure classifier + stable sort). Added combobox/listbox/option
roles + `aria-activedescendant`. No commands added/removed; local ephemeral state only.

**Sidebar** — added **MAIN / TOOLS** group hierarchy (real view-backed items only) using the existing
uppercase-label pattern; added `aria-current` + tooltips. STEP 2 real AI-status preserved.

**Settings** — audited; **already coherent and honest** (clean Row/Toggle/Cycle, group eyebrow+title,
honest states like "Not configured · OAuth required", "MODEL NOT INSTALLED"). No changes required.

**Dashboard** — audited; honest (real counts/status, honest empty states, no dead buttons). Added
`button.card` hover/active feedback for interactive widget cards (does not affect static Settings cards).

**Typography / Spacing** — verified consistent hierarchy; not tokenized (no font-size token layer;
per instruction not redesigned). **PARTIAL.**

**Theme consistency** — all new states use semantic tokens; source-safe for light+dark. Live render
BLOCKED — ENVIRONMENT.

**Accessibility** — palette fully keyboard-operable with proper roles; sidebar `aria-current`/tooltips;
focus, Esc, reduced-motion preserved.

**Responsive / Performance** — palette fixed-width + internal scroll; local state + scoped listeners
only. Live pixel QA BLOCKED — ENVIRONMENT.

**STEP 2 regression check** — tabs (hover/active/close/pin/context-menu/Esc), address bar
(hover/focus-within), sidebar AI status, toolbar controls: all intact.

---

## STEP 2 — Browser Shell Fidelity Pass (update)

**Shell refinements** — reusable token-driven context-menu primitives (`.menu*`); no structural
change to `TitleBar/TabStrip/Toolbar/BookmarkBar/Sidebar/StatusBar`.

**Tab refinements** — non-active hover state; active-tab title weight for hierarchy; tokenized
`.tab-x` close (default+hover) with aria-label; **graceful overflow** (`flex:0 1 172px; min 44px`)
so many tabs compress instead of overflowing; **real right-click context menu** (New Tab · Reload ·
Pin/Unpin · Reopen · Close) replacing the previous hidden silent-pin — existing store actions only.

**Toolbar refinements** — reload icon normalized 15→16px to match nav cluster; honest disabled
Back/Forward preserved; hit areas unchanged.

**Address-bar refinements** — container-level focus (`:focus-within` accent border + `--accent-weak`
ring) with inner-input ring suppressed; subtle hover; motion transition. Prepared as the primary
surface for later Click-to-Go **without implementing it**.

**Sidebar refinements** — fixed a **fake-status bug**: the "Local AI" card was hardcoded to
`NOT CONFIGURED`; it now reflects real `aiStatus` (CONNECTED / CHECKING / OFFLINE) and opens the AI
panel. Width/grouping/active states preserved.

**Profile / Downloads / VPN / Protection** — inspected; already token-driven + honest; **unchanged**.

**Theme verification** — all new states use semantic tokens; verified as source-safe for light+dark
(no hardcoded per-theme colors). Live theme-switch render: BLOCKED — ENVIRONMENT.

**Responsive verification** — by inspection only (viewport-clamped menu, graceful tab shrink, fixed
sidebar + flex main). Live pixel QA at 1280/1440/1920/2560: **BLOCKED — ENVIRONMENT**.

**Accessibility verification** — menu roles + Esc + click-outside; visible focus preserved;
aria-labels added; reduced-motion honored; existing shortcuts unchanged.

**Remaining limitations** — tab loading/muted states not in model (not faked); Duplicate/Close-Others/
Close-to-Right omitted (no backing action); Back/Forward history not wired; live GUI QA env-blocked;
lint still NOT CONFIGURED.

---

## STEP 1 — Visual Fidelity Pass (update)

**What was normalized**
- Formalized semantic interaction-state tokens (`--surface-hover`, `--surface-active`,
  `--on-accent`, `--focus`) and sizing/motion scales (`--ctl-h`, `--ctl-h-sm`, `--field-h`,
  `--motion-fast`, `--motion-base`, `--ease`) as the single source of truth, wired into the
  shared control classes with **identical pixel values** (zero-regression centralization).
- Completed the control state matrix with `:active` states for icon/ghost buttons.

**What was preserved**
- Entire shell structure, all base color tokens, radius/density/motion engine, both themes,
  every implemented feature screen. No architecture/IPC/service behavior touched.

**Token changes** — additive only; no duplicate tokens created (see `NEXA_STEP_1_DESIGN_CHANGELOG.md` §2).

**Screen changes**
- `NewTab` ambient background is now accent-driven (`#8b5cf6` → `var(--accent-2)`).
- AI panel chat bubble fixed: assistant text used a **non-existent** `--text-1` token → now
  `--text`; user text `#fff` → `--on-accent`. This is a genuine cross-theme fidelity fix.
- Avatar / window-close hover / accent badges: `#fff` → `--on-accent`.

**Remaining visual mismatches / limitations**
- Font sizes remain inline literals (conform to the design scale; not tokenized — deferred to
  avoid large churn).
- Live theme-switch + responsive pixel QA at 1280/1440/1920/2560: **BLOCKED — ENVIRONMENT** (no GUI).
- Later-step feature screens (Click-to-Go, Worker, Privacy, Cloud/Drive) out of scope.

**Responsive verification** — by inspection only (flex + auto-fill grids + max-width containers +
fixed 216px sidebar; no overflow-prone fixed content). Live GUI verification env-blocked.

**Accessibility verification** — visible focus ring preserved (`--focus`), reduced-motion
preserved, pressed states added, no color-only state signals introduced.

---

## 1. Design-token fidelity (verified against `tokens.css`)

| Token group | Design source | `tokens.css` | Match |
|---|---|---|---|
| `--bg` light / dark | `#e8eaed` / `#08090b` | `#e8eaed` / `#08090b` | **EXACT** |
| `--accent` light / dark | `#4b57e6` / `#7c84f5` | `#4b57e6` / `#7c84f5` | **EXACT** |
| Accent-mix generation | `color-mix` accent-2/weak per mode | `color-mix(in srgb, var(--accent) …)` | **IMPLEMENTED** |
| Radius `--r` | sharp/compact/balanced 9 (default)/rounded | `--r: 9px` + scale | **IMPLEMENTED** |
| UI font | IBM Plex Sans | `'IBM Plex Sans', system-ui` | **EXACT** |
| Mono font | IBM Plex Mono (numeric/badges) | present (`.mono` usage throughout) | **IMPLEMENTED** |
| Surfaces/border/text tokens | full semantic set | present light+dark | **IMPLEMENTED** |
| Shadow / elevation | `--shadow`, `--shadow-lg` | present | **IMPLEMENTED** |
| Motion (`data-motion`, reduced-motion) | none/minimal/smooth/expressive | present | **IMPLEMENTED** |
| Density (compact/comfortable/spacious) | 12/15/19 padding | present | **IMPLEMENTED** |

> **The design system is faithfully ported — one token system, no second design system,
> no scattered literals in the token layer.** This is the strongest area of the app.

---

## 2. Screen-by-screen: design source vs current app

| Area | Design source | Current app | Difference | Required action |
|---|---|---|---|---|
| **Browser shell** | Collapsible title bar (hidden default, ⌘⇧H), tab strip, toolbar, sidebar, status bar | Shell present in `App.tsx` | Verify ⌘⇧H persistence + contextual status bar completeness | Verify/refine |
| **New Tab / dashboard** | Customizable widgets, greeting, quick actions, layout density | `NewTab.tsx` (141 LOC) static-ish | No widget registry / show-hide-reorder / single-source customization | Build dashboard widget registry |
| **Tabs** | pin/duplicate/close-others/left/right/reopen/context menu | open/close/switch/restore | Missing pin/duplicate/context menu/close-variants (verify) | Extend tab actions |
| **Toolbar** | Standard controls, AI entry | Present | Matches baseline | Verify AI entry affordance |
| **Address bar** | Solid/gradient/glass styles + **Click-to-Go grouped panel** | Standard address bar | **Click-to-Go panel MISSING** | Build Click-to-Go into address bar |
| **Sidebar** | Collapsible, nav sections | Present | Matches baseline | Verify collapse persistence |
| **Status bar** | Contextual status | Present | Verify contextual states | Verify |
| **Settings** | Full-page, real dropdowns, persistence, profile scope | `Settings.tsx` (948) | Strong match | Add timezone/locale/dashboard sections later |
| **Command palette** | ⌘K → real services; grouped | Present, routes to services | Not yet grouped intent resolver | Extend, don't duplicate |
| **Downloads** | Queue, detail drawer, detection popover, clear | `Downloads.tsx` (453) | Strong match | Verify popover/drawer parity |
| **AI panel** | ASK/ASSIST/AGENT, execution plan, streaming | Implemented (3 modes) | Provider selector limited to Ollama | Add provider abstraction UI later |
| **Agent** | Modes + vision chip + palette | Implemented | Matches | — |
| **Worker** | Scan→suggest→review→fill panel | **None** | **MISSING** | Build as agent UX preset |
| **Profiles** | Identity, avatar, accent, status, timezone, locale | Implemented minus timezone/locale | Missing regional | Add per-profile timezone/locale |
| **Bookmarks** | Folders, search, manager, import/export, bar | Implemented | Strong match | Verify bookmarks bar UI |
| **History** | Ranges, search, clear | Implemented | Match | — |
| **Collections** | Create/items | Implemented | Match | — |
| **Protection** | Modes, categories, lists, counters, per-site | Bundled lists + counters | Missing per-site exceptions / external update / cosmetic UI | Extend |
| **VPN** | State machine, catalog, quick panel, diagnostics, kill switch | Implemented UI + native | Matches design | Live validation env-blocked |
| **Privacy** | Privacy Center dashboard + Run Privacy Check | **None** | **MISSING** | Build Privacy Center |
| **Cloud** | Provider tiles, folder picker, transfers | Google Drive functional; others honest placeholders | **DONE (STEP 8, Drive)** | Other providers still NOT CONFIGURED |
| **Drive** | Not Connected→Connect→OAuth→Browse/Download | Full Drive browser (`views/Drive.tsx`) | **DONE (STEP 8)** | Live OAuth NOT_CONFIGURED without credentials |
| **Dialogs / popovers / menus** | `cpop`/`cslide` motion, `--shadow-lg` | Present (overlays, toasts) | Verify per-component states | Verify empty/loading/error states |
| **Empty / loading / error / unavailable states** | Full state matrix per element | Honest states used (`NOT CONFIGURED`, placeholders) | Coverage uneven across new areas | Ensure every new control has all states |

---

## 3. Design elements that already exist

- Complete token system (color/type/radius/shadow/motion/density), light + dark.
- Runtime accent-variant generation via `color-mix`.
- Browser shell, tabs, toolbar, address bar, sidebar, status bar.
- Full-page Settings with real dropdowns + persistence.
- Command palette (⌘K) routed to real services.
- Downloads UI, Protection UI, VPN UI, AI/Agent panel, Bookmarks/History/Collections.
- Honest runtime states (`NOT CONFIGURED`, `REQUIRES OAUTH`, placeholders).

## 4. Design elements NOT yet present

- ~~Click-to-Go grouped address-bar panel.~~ **DONE (STEP 4)** — `.omni-pop` suggestion
  dropdown extends the address bar, grouped (URL/NEXA/SERVICES/PAGE/SEARCH), reusing
  `--elevated`/`--border`/`--shadow-lg`/accent-weak selected state + `cpop` motion and the
  STEP 3 command-palette visual language. combobox/listbox/option a11y. See
  `NEXA_STEP_4_CLICK_TO_GO_CHANGELOG.md`.
- ~~Worker Assistant panel (scan→suggest→review→fill).~~ **DONE (STEP 5)** — compact
  380px docked `WorkerPanel` (briefcase toolbar button, ⌘-palette `Worker:` group,
  Click-to-Go `worker`/`answer page`). Reuses existing tokens (surface/surface-2/
  border/accent/accent-weak/warning/success), the AI-panel header + `ModeTab`
  (Ask/Assist/Agent), `.primary`/`.ghost`/`.icon-btn`, and STEP-3/4 popover language.
  States idle→scanning→scanned→generating→ready→filling→(blocked)→review with
  `aria-live` status. No new visual system. See `NEXA_STEP_5_WORKER_ASSISTANT.md`.
- ~~Secure vault autofill UI (compact popover, not a dashboard).~~ **DONE (STEP 6)** —
  `VaultButton` (key toolbar indicator, shown only on web pages with a vault) opens a
  288px `VaultAutofillPopover` (`role="dialog"`, Escape-to-close, account radiogroup,
  masked password dots, `aria-live` status). Reuses existing tokens (surface/border/
  accent/warning/success/error), `.btn`/`.btn-primary`/`.icon-btn`, and STEP-3/4
  popover language. States: ineligible / unavailable / locked / nomatch / ready /
  filling / filled / failed. Worker panel shows a "Login form detected" hand-off.
  Click-to-Go `vault`/`passwords`/`fill login`. No new visual system. See
  `NEXA_STEP_6_SECURE_VAULT_AUTOFILL.md`.
- ~~Privacy Center dashboard + diagnostics visualization.~~ **DONE (STEP 7)** —
  `PrivacyCenterView` (new `privacy` ChromeView) with a compact card grid
  (Connection, DNS, WebRTC, Fingerprint Surface, Content Protection, VPN,
  Permissions, Site Privacy), honest status pills (success/warning/accent/muted
  tones), `aria-live` scan status and a "Run Privacy Check" action. Reuses existing
  tokens/cards/`.ghost`/`.mono`/`.pill` and the ShieldStar language; entry via the
  toolbar shield popover, Settings → Privacy, the `Privacy` palette group and
  Click-to-Go `privacy`. No new visual system. See `NEXA_STEP_7_PRIVACY_CENTER.md`.
- ~~Cloud/Drive connected UI (tiles, folder picker) — only placeholder.~~ **DONE (STEP 8)** —
  `DriveView` provides the Not-Connected→Connect→Browse/Search→Download flow using existing
  primitives (cards, `.ghost`/`.primary`, `.mono`, search input, table rows), `aria-live`
  status and a reduced-motion-safe `.spin`. Downloads reuse the P2 engine + Downloads UI. No
  redesign. Other cloud providers remain honest placeholders. See `NEXA_STEP_8_GOOGLE_DRIVE.md`.
- **DONE (STEP 9)** — Turbo Mode UI integrated into the existing shell: a compact
  `⚡` toolbar indicator (`TurboButton`) reusing `.icon-btn` + `Lightning` tokens (fill/regular,
  spins only while optimizing and respects reduced motion), a `.popover` (`TurboPopover`) with
  honest state + real last-navigation timing, a subtle 2px `.nav-progress-bar` (no %/ETA,
  static under `prefers-reduced-motion`), `Settings → Turbo & Performance` reusing `Row`/`Toggle`,
  a `Turbo` palette group and Click-to-Go `turbo`. No new visual system, no giant/neon/glass card.
  Color is always paired with icon/text. See `NEXA_STEP_9_TURBO_MODE.md`.
- **DONE (STEP 13)** — Browser Extensions manager, additive to the existing Settings shell. The old
  fake `Settings → Extensions` placeholder (hardcoded Dark Reader / JSON Viewer + a dead "Load
  unpacked" button) is replaced by a real, dense manager driven by live per-profile state: an
  "Install local extension" action (folder pick → main-validated permission review → confirm), rows
  with name/version, a **risk pill** (LOW/MEDIUM/HIGH/BLOCKED, with text — never color-only), a
  permission summary, an enable toggle, a "When clicked/Always/On selected/Never" site-access
  selector, an "Allow in private" checkbox (disabled unless enabled), Remove, and an expandable
  details view (permissions, elevated, host access, blocked, runtime, source, status). Honest banner:
  "MANIFEST V3 · LOCAL UNPACKED ONLY · CHROMIUM SANDBOX · PER-PROFILE". A compact Dashboard
  **Extensions** widget shows X enabled / Y disabled (real state); palette adds Extensions / Manage /
  Install Local Extension / View Permissions; Click-to-Go resolves `extensions`/`extension settings`/
  `extension manager`. Reuses the existing NEXA visual language — no giant cards, no fake Web Store.

- **DONE (STEP 12)** — Multi-Provider AI, additive to the existing AI UI. Settings → AI gains a
  compact Providers section: token-driven provider cards (Ollama LOCAL / OpenAI · Anthropic CLOUD)
  with a dot **and** text health label (never color-only), a password-style API-key entry that is
  cleared after submit with Save&Test/Remove, and Active-provider / Privacy mode / Fallback / Vision
  selectors (`Cycle`). The Dashboard AI widget now reflects the active provider + model + honest
  health. Palette adds AI: Choose Provider/Model, Test Provider, AI Settings, Use Local AI, Enable
  Cloud AI; Click-to-Go resolves `ai`/`ai settings`/`ollama`/`local ai`/`cloud ai`. No secrets in the
  renderer, no giant cards/neon — reuses the existing NEXA visual language.

- **DONE (STEP 11)** — Unified, customizable Dashboard control center on the New Tab page.
  A pure widget registry (`src/shared/dashboard.ts`) drives 15 real status widgets (Downloads,
  Protection, VPN, Turbo, AI, Worker, Drive, Privacy, Profile, Regional, Recent Sites, Bookmarks,
  History, Collections + a Quick Actions grid), each a projection of existing P0–P10 state. Dense
  token-driven cards (icon + title + dot/text status → body → "Open" action) in a responsive
  `minmax(280px,1fr)` grid; large widgets span the row. Per-profile layout (validated + migrated),
  a Customize popover (show/hide/reorder/reset), and "Open/Customize Dashboard" palette commands.
  Honest empty/not-configured states, no fake metrics, no giant/neon/glass cards, color always
  paired with text. See `NEXA_STEP_11_DASHBOARD.md` / `NEXA_STEP_11_DESIGN_AUDIT.md`.
- **DONE (STEP 10)** — Per-profile Language & Region settings integrated into the existing
  Settings architecture (`RegionalSettings`): dense `Row`/`Cycle`/`.field`/`.pill`/`.honest`
  layout with a searchable timezone picker (UTC±offset), locale + ordered preferred-language
  pickers (add/reorder/remove), date/time/week/measurement selects, a live `Intl` preview, and
  an honest layered capability matrix (Accept-Language Applied · page tz/locale Partial). Adds a
  `Region` palette group, `regional`/`timezone`/`language` Click-to-Go, and a read-only Privacy
  Center "Regional Configuration" card (config, not fingerprint protection). No spoofing, no giant
  cards. See `NEXA_STEP_10_REGIONAL_PROFILES.md`.
- Address-bar style variants (solid/gradient/glass) — verify presence.
- Extensions manager screen.

## 5. Design guardrails to respect (from `NEXA_DESIGN_SYSTEM.md` §Do-not)

- No second design system; consume tokens, never scatter literals.
- No giant cards / glassmorphism / neon / excessive gradients / animation.
- Never use color as the sole state signal (pair with icon/text).
- Respect `prefers-reduced-motion`.

## 6. Hardening phase (post-P13) — design impact

The Hardening & Release-Readiness phase made **no UI/design changes**. It was
security/dependency/packaging only (SEC-1 permission policy, ESLint, Electron 44,
release config). The `Bookmarks` view's `items` was memoized (behaviour-neutral,
no visual change). All design guardrails above remain in force and unaffected.
See `NEXA_HARDENING_CHANGELOG.md`.
