# NEXA — STEP 4 Changelog: Click-to-Go Intent Navigation

**Scope:** STEP 4 only. Turn the existing address bar into a unified, deterministic
intent/navigation surface. No separate launcher, no shell redesign, no new feature
systems (see §33 out-of-scope).

**Baseline in:** 389/389 tests, typecheck PASS, build PASS, lint NOT CONFIGURED.
**Baseline out:** 412/412 tests, typecheck PASS, build PASS, lint NOT CONFIGURED.

---

## 1. Resolver architecture

```
Address Bar Input
      ↓
resolveClickToGo(input, ctx)   ← pure, synchronous, deterministic (src/shared/click-to-go.ts)
      ↓
Intent classification (URL → NEXA command → Service → Page action → Search)
      ↓
Capability + permission gate (ctx.onWebPage / ctx.aiConnected)
      ↓
executeClickToGo(suggestion)   ← renderer, maps registered id → existing store action
```

- Resolution is **pure and data-only**. `resolveClickToGo` returns `Suggestion[]` that
  carry only strings (label, sublabel, url, query, commandId, serviceId, actionId).
  **No functions / executables** ever cross the contract boundary.
- AI does **not** participate in routing. No Ollama call is made during resolution.
- The resolver lives in `src/shared/` so it is unit-testable in the node test project
  and shared by renderer + tests as a single source of truth.

## 2. Intent types (`ClickToGoIntent` / `Suggestion`)

```
kind:  'url' | 'command' | 'service' | 'page_action' | 'search'
group: 'URL' | 'NEXA' | 'SERVICES' | 'PAGE' | 'SEARCH'   (display order)
```

Precedence (highest first): **explicit http(s) URL → NEXA command → known service →
page action → web search**. First returned suggestion is the default selection.

## 3. Registered NEXA commands (single source of truth)

`NEXA_COMMANDS` — every entry maps to a **real** existing view/overlay:

| id | aliases (excerpt) | target |
|----|-------------------|--------|
| dashboard | dashboard, home, new tab | view `newtab` |
| downloads | downloads, download manager | view `downloads` |
| history | history | view `history` |
| bookmarks | bookmarks, favorites | view `bookmarks` |
| collections | collections | view `collections` |
| cloud | cloud, transfers | view `cloud` |
| protection | protection, adblock, shield | view `protection` |
| settings | settings, preferences, options | view `settings` |
| vpn | vpn | overlay `vpn` |

Execution routes through the same store actions (`setView` / `setOverlay`) the Command
Palette already uses. No duplicated command list / duplicated logic was introduced.

## 4. Service registry (navigation-only)

`KNOWN_SERVICES` — plain **https navigation only**, no OAuth / accounts / "connected"
semantics: gmail, drive, youtube, github, chatgpt, maps, calendar, wikipedia.
Each entry: `{ id, aliases, label, url }`. Google Drive opens `https://drive.google.com/`
as a website — it does **not** claim to be connected (Drive OAuth/browsing/download
remain out of scope for a later Cloud/Drive phase).

## 5. Page actions (capability-gated)

`PAGE_ACTIONS` exposes only capabilities that genuinely exist today:

| id | label | requires | backing capability |
|----|-------|----------|--------------------|
| summarize | Summarize Page | page + ai | `aiSummarizePage()` (P5) |
| ask | Ask About This Page | page + ai | `aiAskAboutPage()` (P5) |
| scan | Scan Current Page | page + ai | `agentStart(observe…)` (P5.2) |

A page action is offered **only** when its requirements are met (`ctx.onWebPage` and
`ctx.aiConnected`). If AI is offline or no web page is active, these are hidden and the
input falls through to search. Selection-only ops (explain/translate) are intentionally
**not** offered here (they remain in the AI panel/palette) so Click-to-Go never offers an
action it cannot honor.

## 6. URL detection & security boundary

- URL classification reuses the existing `looksLikeUrl` / `normalizeUrl` helpers
  (`src/shared/types.ts`) plus an explicit `toSafeHttpUrl` guard that returns a value
  **only** for `http:`/`https:` (and bare domains normalized to https).
- `javascript:`, `file:`, `data:`, `vbscript:`, `electron:`, `shell:` are **never**
  classified as URLs — they fall through to a plain web search and are passed to the
  existing search provider as a query string. They are never executed as protocols.
- **No generic execution path exists.** There is no `executeCommand(input)`,
  `executeShell`, `executeJS`, `openFile`, `eval`, or `clickToGo.execute(input)` IPC
  channel. `executeClickToGo` is a closed `switch` over registered intent kinds; only
  registered ids and resolver-validated http(s) URLs reach an action.
- No new IPC channel was added. Execution is renderer-side and reuses existing
  capability-specific actions (`navigate`, `setView`, `setOverlay`, AI/agent actions).
  `sandbox`, `contextIsolation`, `nodeIntegration=false`, `webSecurity` are unchanged.

## 7. Search reuse

Search reuses the existing `navigate()` store action, which already performs
URL-vs-search detection via `searchUrl(prefs.sv.search, …)`. No new search provider
architecture was introduced. The active engine name is shown in the suggestion sublabel.

## 8. Keyboard behavior

- **ArrowDown / ArrowUp** — move selection (clamped).
- **Enter** — execute the selected suggestion; if the dropdown is closed, run the default
  `navigate(addr)` (preserves prior address-bar behavior).
- **Escape** — dismiss the suggestion list (keeps focus/input).
- **Cmd/Ctrl + L** — existing global shortcut still focuses + selects the address bar; on
  focus the suggestion list opens. No existing shortcut was changed.
- **Mouse** — hover selects, click (via `onMouseDown`, so it fires before blur) executes,
  blur (click outside) dismisses. Listeners are scoped to the component (no global
  document listeners added) and clean up with the component.

## 9. Accessibility

`role="combobox"` on the input with `aria-expanded`, `aria-controls`,
`aria-activedescendant`; `role="listbox"` on the dropdown; `role="option"` +
`aria-selected` per row; unique `omni-opt-{i}` ids; visible selected state; Escape
dismissal; selected row auto-scrolls into view.

## 10. Private mode / profile isolation

- Navigation/service/command/search all route through existing actions that already
  respect the active profile and the per-tab `private` flag. `navigate()` records history
  only when `prefs.historyEnabled` and tags entries with the tab's `private` state.
- Suggestions are transient **local component state** — never persisted, logged, sent to
  analytics, or added to AI context. Private-mode input does not become persistent
  history via Click-to-Go.

## 11. Performance

- Deterministic resolver over small static registries (~25 entries); runs synchronously
  on each keystroke. **No `setTimeout`, debounce, loading spinner, or fake processing.**
- Suggestions use local `useState` only; no global Zustand state for transient UI.

## 12. Files changed

- **NEW** `src/shared/click-to-go.ts` — contract, registries, `toSafeHttpUrl`,
  `resolveClickToGo` (pure resolver).
- **NEW** `tests/unit/click-to-go.test.ts` — 18 resolver/security tests.
- `src/renderer/src/App.tsx` — new `Omnibox` component (replaces inline omnibox markup),
  `suggestionIcon`, `executeClickToGo`; added `Globe` icon + `@shared/click-to-go`
  import; removed now-unused Toolbar locals.
- `src/renderer/src/design-system/tokens.css` — added `.omni-pop` dropdown surface
  (reuses `--elevated`, `--border`, `--shadow-lg`, existing `cpop` animation).
- `tests/unit/theme-tokens.test.ts` — +5 STEP 4 source-guard tests (resolver wiring,
  tokens reuse, a11y roles, keyboard model, no generic execution path).

## 13. Test results

- **Tests:** 412/412 PASS (was 389; +18 resolver, +5 source-guard).
- **Typecheck:** PASS (`tsc` node + web projects).
- **Build:** PASS (`electron-vite build`).
- **Lint:** NOT CONFIGURED (`npm run lint` is still the pre-existing stub — not faked).

## 14. GUI limitations

**GUI Verification: BLOCKED — ENVIRONMENT.** Headless; no visual QA across resolutions
was performed. Automated verification (tests/typecheck/build) is clean. The suggestion
surface reuses existing tokens (surface/border/accent-weak/text/shadow/motion) and the
STEP 3 command-palette visual language, so it inherits dark/light theming.

## 15. Regression check

- **STEP 2:** tabs, tab context menu, sidebar, toolbar, address-bar focus — unchanged;
  omnibox markup preserved (lock icon, Ask AI, bookmark star) inside the new component.
- **STEP 3:** Dashboard, sidebar hierarchy, Settings, Command Palette + palette keyboard
  navigation — untouched.
- No architecture, security, or functionality regressions detected.
