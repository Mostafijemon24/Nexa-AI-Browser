# NEXA — STEP 3 App Surfaces Changelog

## Dashboard · Sidebar · Settings · Command Palette

> Scope: **visual + interaction consistency pass only.** No new feature systems, no
> architecture/IPC/service/security changes. Method: AUDIT → UNDERSTAND → REUSE → REFINE → VERIFY.
> All refinements reuse the STEP 1/2 token system and menu primitives — no second design/state system.

---

## Audit finding

Most surfaces were already coherent and honest (Settings has a clean `Row`/`Toggle`/`Cycle`
structure with honest states throughout; Dashboard shows only real state). The **one genuine
interaction gap** was the **Command Palette**: it had no keyboard navigation and no category
grouping. The **Sidebar** lacked visual grouping hierarchy. STEP 3 targeted those, plus small
shared-primitive polish.

## Command Palette (biggest change)

- **Keyboard navigation added** (was missing): `ArrowUp` / `ArrowDown` move a highlighted
  selection, `Enter` runs it, `Esc` closes (via existing global overlay handler), and hovering
  a row selects it. Selected row uses `--accent-weak` + `--accent-2` (token-based).
- **Category grouping added** (§17): commands are grouped under ordered headers —
  `Browser · Library · Downloads · Protection · AI · Agent · VPN · Appearance · Privacy & Vault · App`
  — via a pure `paletteGroup(label)` classifier + stable sort (original order preserved within a group).
- **Accessibility**: input is now `role="combobox"` with `aria-expanded`/`aria-controls`/
  `aria-activedescendant`; list is `role="listbox"`; rows are `role="option"` with `aria-selected`;
  the selected row auto-scrolls into view (`block:'nearest'`).
- **No commands added or removed** — the exact same registered actions (all state-aware/honest)
  are shown; **no dead commands**. Remains fully compatible with the future Click-to-Go step.
- **Performance/state**: selection is **local ephemeral state** (`useState`), reset on query
  change via a scoped effect; the only key handler is `onKeyDown` on the palette input (no global
  listener, nothing added to the Zustand store).

## Sidebar

- Added **information hierarchy** (§10) with real, view-backed groups: **MAIN** (Home, Downloads,
  Bookmarks, History, Collections) and **TOOLS** (AI, Cloud) — using the existing uppercase
  group-label pattern (same as "Workspaces"). No invented navigation sections.
- Added `title` tooltips and `aria-current="page"` on the active nav item.
- Preserved the STEP 2 real AI-status card, Workspaces section, Settings, widths, and all
  hover/active states.

## Settings

- **Audited — already coherent and honest; no structural changes required.** Verified: clean
  `Row` (label/desc/control) cards, `Toggle`/`Cycle` controls, group eyebrow + title, 220px nav
  with token active states, and honest statuses throughout (e.g. "Not configured · OAuth required",
  "MODEL NOT INSTALLED", "Enforcement needs the filter engine", "External filter updates … not
  enabled in this build"). No fake Connected/Enabled/Protected states found. Left intact.

## Dashboard (New Tab)

- **Audited — honest and functional; minimal change.** All numbers/blurbs derive from real state
  (downloads counts, AI status, VPN projection) with honest empty states ("No downloads yet",
  "Local AI unavailable — start Ollama"). Every button routes to an existing view/action — no dead
  buttons.
- Added interactive-card feedback: `button.card` now has hover/active states (dashboard widgets),
  scoped so it does **not** affect static `div.row.card` info cards in Settings.

## Token usage

- Reused STEP 1/2 tokens (`--surface-hover/active`, `--accent-weak`, `--accent-2`, `--motion-fast`,
  `--ease`, `--border-2`). **No new semantic tokens introduced.** New rule `button.card` is purely
  token-composed.

## Typography

- Verified consistent hierarchy across the four surfaces (page title, section eyebrow, row label,
  description, metadata, pill). No font-size **tokens** exist yet, so per §21 (no typography
  redesign) values were left as consistent inline literals rather than inventing a scale. **PARTIAL.**

## Spacing

- Verified rhythm (settings row padding, sidebar gaps, palette row height, group header spacing).
  Reused existing spacing; group headers match the established uppercase-label spacing. Not fully
  tokenized (consistent). **PARTIAL.**

## Accessibility

- Palette: full keyboard operation + combobox/listbox/option roles + activedescendant.
- Sidebar: `aria-current`, tooltips.
- Preserved visible focus, Esc dismissal, reduced-motion (all transitions use the motion scale).

## Responsive desktop

- By inspection: palette is fixed 600px centered with internal scroll (`max-height:360`); sidebar
  fixed 216px; grouped rows wrap safely; no new fixed-width content. **Live pixel QA at
  1280/1440/1920/2560: BLOCKED — ENVIRONMENT** (headless).

## Performance

- Local ephemeral palette state only; scoped input `onKeyDown`; `scrollIntoView` fires only for the
  selected row. No global listeners, polling, timers, resize loops, or new store state.
  `App.tsx`/`store.ts` not made substantially more monolithic (palette/sidebar edits in-place).

## Files changed

- `src/renderer/src/App.tsx` — palette keyboard nav + grouping + a11y; sidebar MAIN/TOOLS grouping
  + `aria-current`/tooltips.
- `src/renderer/src/design-system/tokens.css` — `button.card` hover/active states.
- `tests/unit/theme-tokens.test.ts` — STEP 3 palette/sidebar/card regression guards.
- `NEXA_DESIGN_AUDIT.md` — STEP 3 section.

## Files created

- `NEXA_STEP_3_APP_SURFACES_CHANGELOG.md` (this file).

## Remaining limitations

- Live GUI pixel/responsive/theme-switch verification: **BLOCKED — ENVIRONMENT**.
- Typography/spacing not tokenized (consistent; deferred — no font-size token layer exists).
- Sidebar "collapse" = hide entirely (no icon-rail) — so collapsed-icon tooltips (§11) are N/A;
  documented, not invented.
- Lint remains the STEP 0 stub — **NOT CONFIGURED** (not faked).

---

```text
STEP 3 STATUS

Dashboard:            PASS
Sidebar:              PASS
Settings:             PASS (audited; already coherent/honest — no changes needed)
Command Palette:      PASS
Typography:           PARTIAL (consistent; no token layer — not redesigned)
Spacing:              PARTIAL (consistent; not fully tokenized)
Light Theme:          PASS (source-level; live render env-blocked)
Dark Theme:           PASS (source-level; live render env-blocked)
Accessibility:        PASS
Responsive Desktop:   PARTIAL (by inspection; live pixel QA env-blocked)
Performance:          PASS

Tests:                389/389
Typecheck:            PASS
Build:                PASS
Lint:                 NOT CONFIGURED
GUI Verification:     BLOCKED — ENVIRONMENT
Architecture Regressions:   NONE
Security Regressions:       NONE
Functionality Regressions:  NONE
```
