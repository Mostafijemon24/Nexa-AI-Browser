# NEXA — STEP 2 Browser Shell Changelog

> Scope: **browser-shell visual + interaction fidelity only.** No product features added,
> no architecture/IPC/service/security changes. Method: AUDIT → UNDERSTAND → REUSE → REFINE → VERIFY.
> All refinements consume the existing STEP 1 token system — no new token system, no second
> component/state system.

---

## 1. Browser shell changes

- Shell structure preserved exactly (`TitleBar → TabStrip → Toolbar → BookmarkBar → body[Sidebar|main[Content|StatusBar]]`).
- Added reusable, token-driven **context-menu primitives** (`.menu`, `.menu-item`, `.menu-sep`,
  `.kbd`) so shell menus share one visual language (also ready for later steps).
- All new states use `var(--surface-hover)`, `var(--surface-active)`, `var(--accent-weak)`,
  `var(--focus)`, `var(--motion-fast)`, `var(--ease)` — no hardcoded colors introduced.

## 2. Tab changes

- **Hover state** added for non-active tabs (`.tab:not(.active):hover`) with a short
  `--motion-fast` transition — tabs previously had no hover feedback.
- **Active-tab hierarchy**: active title now `font-weight: 600` (vs 500), on top of the existing
  surface/border active treatment — clearer primary-context signal, still restrained (no glow/gradient).
- **Close affordance** promoted to a tokenized `.tab-x` class with default + hover states
  (`--surface-active` bg, `--text` color) and an accessible label; middle-click-close preserved.
- **Graceful overflow (§5)**: tabs changed from `min-width:150px` (no shrink → overflow risk) to
  `flex: 0 1 172px; min-width:44px; max-width:220px`, so many tabs **compress** instead of
  overflowing the strip / pushing toolbar controls. No new tab architecture.
- **Context menu (§6)**: right-click previously *silently pinned* the tab (hidden/confusing).
  Replaced with a real, keyboard-dismissable (`Esc`) + click-outside menu exposing **only
  operations that already exist** in the store: **New Tab · Reload** (active web tab only) **·
  Pin/Unpin · Reopen Closed Tab · Close Tab**. No dead items — `Duplicate`/`Close Others`/
  `Close to Right` are intentionally **omitted** because no backing store action exists (avoided
  scope creep into tab-management feature work).
- Pinned (star) and private (eye-slash) indicators preserved.

## 3. Toolbar changes

- Normalized the reload icon `15px → 16px` to match the back/forward/sidebar nav cluster
  (consistent optical size).
- Existing honest disabled states preserved (Back/Forward remain disabled — webview history is
  not wired; not faked as enabled). Hit areas/`icon-btn` geometry unchanged (32px).

## 4. Address bar changes

- The address bar is now focus-managed at the **container** level (`.omnibox:focus-within`:
  accent border + `0 0 0 3px var(--accent-weak)` ring) and the awkward inner-input outline is
  suppressed (`.omnibox input:focus-visible { outline: none }`) — one clear, on-brand focus
  affordance instead of a ring drawn inside the field.
- Added a subtle `.omnibox:hover` border emphasis and a `--motion-fast` transition.
- Visually prepared as the primary interaction surface for the later Click-to-Go step **without
  implementing any Click-to-Go behavior**.

## 5. Sidebar changes

- Fixed a **fake-status honesty bug**: the bottom "Local AI" card was **hardcoded to
  `NOT CONFIGURED`** regardless of the real runtime. It now reflects the actual `aiStatus.state`
  — **CONNECTED** (success dot) / **CHECKING** (neutral) / **OFFLINE** (warning) — and is now a
  real button that opens the AI panel, with an honest tooltip.
- Width (216px), grouping (primary nav · Workspaces · Settings · status), and active/hover
  states preserved.

## 6. Profile / Download / VPN / Protection control changes

- **No behavioral changes.** These controls already used tokens and honest states:
  - Profile: avatar + menu trigger — untouched (still `--on-accent` from STEP 1).
  - Downloads: live badge — untouched (badge is absolutely positioned; does not shift layout).
  - VPN: driven by `vpnUiProjection` real state — untouched.
  - Protection: shield + live blocked-count badge, honest active/off/error — untouched.
- Engines (`vpn.ts`, helper, platform adapters, protection engine, download engine) **not touched**.

## 7. Token usage

- Reused STEP 1 tokens throughout; **added no new semantic color tokens.**
- New primitives are class-level (`.tab-x`, `.menu*`) built entirely from existing tokens.

## 8. Accessibility

- Context menu: `role="menu"`/`role="menuitem"`, `Esc` to dismiss, click-outside to dismiss,
  visible hover, keyboard-focusable items.
- Address-bar focus ring is now clearly visible in both themes via `--accent`/`--accent-weak`.
- Close button has an `aria-label`; decorative dots marked `aria-hidden`.
- Preserved existing shortcuts (⌘T/⌘W/⌘⇧T/⌘K/⌘L/⌘D/⌘⇧B/⌘H/⌘⇧N) — none invented or altered.
- Reduced-motion still honored (transitions use the motion scale; `[data-motion]` + media query unchanged).

## 9. Responsive QA

- **BLOCKED — ENVIRONMENT** for live pixel verification (headless; no desktop display).
- By inspection: fixed 216px sidebar + flex `main` + absolutely-positioned badges + new
  graceful tab shrink (172→44px) avoid horizontal overflow at 1280–2560 widths. Menu position
  is viewport-clamped (`Math.min(x, innerWidth-200)` / `innerHeight-210`).
- Live verification at 1280×800 / 1440×900 / 1920×1080 / 2560×1440 remains to be done in a GUI.

## 10. Performance

- The only added listener is a **scoped** `keydown` handler mounted **only while the tab context
  menu is open**, with cleanup in the effect return — no global/persistent observers, no polling,
  no timers, no screenshot loops.
- `menu` state is local to `TabStrip` (not added to the global Zustand store).
- Net additions are small and in-place; `App.tsx`/`store.ts` were not made substantially more
  monolithic and no unrelated abstractions were introduced.

## 11. Files changed

**Changed**
- `src/renderer/src/design-system/tokens.css` — tab hover/transition, `.tab-x`, omnibox
  hover/focus-within (+inner-ring suppression), menu primitives, tab overflow flex.
- `src/renderer/src/App.tsx` — tab context menu (existing actions only) + `Esc`/click-out,
  active-tab title weight, `.tab-x` class, reload icon 15→16, sidebar Local-AI status wired to
  real `aiStatus`, `PushPin` import.
- `tests/unit/theme-tokens.test.ts` — added shell-state class regression guards.

**Created**
- `NEXA_STEP_2_SHELL_CHANGELOG.md` (this file).

**Docs updated**
- `NEXA_DESIGN_AUDIT.md` (STEP 2 section).

## 12. Remaining limitations

- Live GUI pixel/responsive/theme-switch verification: **BLOCKED — ENVIRONMENT**.
- Tab **loading** and **muted** states: not present in the tab data model — **not implemented**
  (would require model/service changes, out of a visual step). Documented, not faked.
- `Duplicate` / `Close Others` / `Close to Right`: **intentionally not added** (no backing
  store action; would be feature work).
- Back/Forward remain honestly disabled (webview history not wired — out of shell-visual scope).
- Workspace category dots retain two decorative literals (`#e07b53`, `#3cbf84`) representing
  workspace identity (not part of the semantic palette); left as-is.
- Lint: still the STEP 0/1 stub — **NOT CONFIGURED** (not faked).

---

### Verification
`npm test` → **385/385 PASS** (+5 shell guards) · `npm run typecheck` → **PASS** ·
`npm run build` → **PASS** · `npm run lint` → **NOT CONFIGURED (stub)**.
