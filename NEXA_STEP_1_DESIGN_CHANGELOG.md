# NEXA — STEP 1 Design Fidelity Changelog

> Scope: **design-system + visual-fidelity pass only.** No product features added.
> Method: AUDIT → UNDERSTAND → REUSE → NORMALIZE → REFINE → VERIFY.
> Key finding: the renderer was already ~95% token-driven, so STEP 1 **hardened and
> formalized** the existing system rather than overhauling it. No architecture, IPC, AI,
> agent, download, VPN, protection, or vault behavior was touched.

---

## 1. Design-system changes

- Formalized the **semantic interaction-state** layer and **sizing/motion scales** as a single
  source of truth in `tokens.css`, and wired the shared component classes to consume them.
- Completed the **control state matrix** (default · hover · **active** · focus · disabled) for
  icon buttons and ghost buttons (previously hover+focus only).
- No second design system, no second token system, no new component framework introduced.

## 2. Token changes (all additive / non-duplicating)

New semantic + scale tokens in `:root` (dark inherits via per-theme aliases):

| Token | Value | Purpose |
|---|---|---|
| `--surface-hover` | `var(--surface-2)` | Interaction hover surface (alias — no new color) |
| `--surface-active` | `var(--chrome-2)` | Pressed/active surface |
| `--on-accent` | `#ffffff` | Foreground on accent/error fills (replaces scattered `#fff`) |
| `--focus` | `var(--accent)` | Focus-ring color (semantic) |
| `--ctl-h` | `34px` | Standard control height (buttons, nav rows) |
| `--ctl-h-sm` | `32px` | Compact control height (icon buttons, tabs) |
| `--field-h` | `38px` | Text-field height |
| `--motion-fast` | `0.12s` | Fast transition |
| `--motion-base` | `0.16s` | Base transition |
| `--ease` | `ease` | Default easing |

> No duplicate tokens were created for existing concepts. Base colors, radius (`--r`),
> density (`--dash-pad`), spacing (`--space`), and shadows were **reused unchanged**.

## 3. Browser shell changes

- Tab / icon-button / nav-button / primary / ghost / field heights now reference the
  control-height scale (`--ctl-h`, `--ctl-h-sm`, `--field-h`) — **identical pixel values**,
  now centralized (single source of truth).
- Icon-button and ghost-button gained a proper `:active` pressed state.
- Focus ring now uses `--focus`; button transitions use `--motion-base`/`--ease`.
- **Shell structure was not modified** (titlebar, tabstrip, toolbar, omnibox, sidebar,
  statusbar markup untouched) — only sizing/state tokens were centralized.

## 4. Dashboard changes

- `NewTab.tsx`: replaced the off-palette ambient blob color `#8b5cf6` with `var(--accent-2)`
  so the ambient background is **accent-driven** (matches the design-system color intelligence).
  No layout or functional change.

## 5. Settings changes

- None functional. Verified `var(--mono, monospace)` uses a safe fallback (no bug).

## 6. Command Palette changes

- None. Palette already routes to real services and uses tokens; left intact.

## 7. Existing feature-screen changes

- `App.tsx` AI chat bubble: fixed a **real fidelity bug** — assistant-message text used the
  non-existent token `var(--text-1)` (silent fallback → wrong color, notably fragile across
  themes). Now uses `var(--text)`. User-message text `#fff` → `var(--on-accent)`.
- `App.tsx`: avatar, window-close hover, and accent notification badges now use
  `var(--on-accent)` instead of raw `#fff`.
- Downloads / Bookmarks / History / Collections / Protection views: inspected — already fully
  token-driven; **no changes required**.

## 8. Accessibility changes

- Preserved visible focus ring (`outline: 2px solid var(--focus); outline-offset: 2px`).
- Preserved `prefers-reduced-motion` handling and `[data-motion]` scale.
- Added pressed (`:active`) affordances (state no longer signaled by hover alone).
- No color used as the sole state signal was introduced.

## 9. Responsive verification

- **By inspection (headless — live GUI BLOCKED — ENVIRONMENT):** layout uses flex + auto-fill
  grids + max-width content containers + a fixed 216px sidebar; no fixed-width content blocks
  that would overflow at 1280–2560 width. No fluid font scaling that would break density.
- Live pixel verification at 1280×800 / 1440×900 / 1920×1080 / 2560×1440 requires a desktop
  display and is **BLOCKED — ENVIRONMENT** in this session.

## 10. Performance considerations

- Pure CSS-token/inline-literal edits. No new observers, polling, timers, screenshot capture,
  or re-render sources introduced.
- `App.tsx` (2627 LOC) and `store.ts` (1024 LOC) were **not** made more monolithic — changes
  were minimal in-place literal→token substitutions; no components were relocated or grown.

## 11. Remaining visual gaps

- **Typography tokenization:** font sizes remain inline literals (within the design scale,
  visually consistent). Not tokenized — full tokenization would be large churn across 2600 LOC
  and is deferred (acceptable; values already conform).
- **Live theme-switch / responsive QA:** BLOCKED — ENVIRONMENT (no GUI).
- **Lint:** still a stub (`echo`). Not configured in this visual step (see §20 of the prompt).
- Feature screens for later steps (Click-to-Go, Worker, Privacy, Cloud/Drive) are out of scope.

## 12. Files changed

**Changed**
- `src/renderer/src/design-system/tokens.css` — new semantic/scale tokens + class wiring + `:active` states
- `src/renderer/src/App.tsx` — `#fff`→`--on-accent` (avatar, close hover, 2 badges, chat user), `--text-1`→`--text` (chat assistant bug fix)
- `src/renderer/src/views/NewTab.tsx` — ambient blob `#8b5cf6`→`var(--accent-2)`

**Created**
- `tests/unit/theme-tokens.test.ts` — token-contract + theme-derivation regression tests
- `NEXA_STEP_1_DESIGN_CHANGELOG.md` (this file)

**Docs updated**
- `NEXA_DESIGN_AUDIT.md`, `NEXA_IMPLEMENTATION_AUDIT.md`

---

### Verification
`npm test` → **380/380 PASS** · `npm run typecheck` → **PASS** · `npm run build` → **PASS**
· `npm run lint` → **NOT CONFIGURED (stub)**.
