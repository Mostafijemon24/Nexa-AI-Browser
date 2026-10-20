# NEXA P5.2 — Advanced Browser Tools & Hybrid Agent (Implementation)

P5.2 is an **additive** layer on the validated P5.1 Browser Agent Foundation. It
does **not** rebuild P5.1: the same `AgentService`, `Planner` (P5 `AIService`/
Ollama), `PermissionEngine`, tool registry, IPC bridge, state machine, and
renderer Browser Adapter are reused. P5.2 adds hybrid observation, smart target
resolution, and a set of structured, bounded browser tools.

## 1. Architecture (unchanged security spine)

```
User intent → Planner (P5 AIService/Ollama) → ONE JSON tool call
           → validate (registry + Zod) → PermissionEngine (LIVE origin, mode)
           → AgentToolHost (typed IPC) → renderer Browser Adapter → Chromium <webview>
           → observe → verify → continue / recover / replan (bounded)
```

Principle preserved: **AI decides what it wants; NEXA decides if it's allowed;
Chromium performs the action.** The model still emits only a single validated
JSON tool call — never code, IPC names, selectors-as-code, or shell.

## 2. New tools (registry additions)

All added to the central `TOOL_REGISTRY` in `src/shared/agent.ts` with a
security class, Zod schema, risk, and timeout. No tool bypasses the registry.

| Tool | Class | Purpose |
|------|-------|---------|
| `observe` | READ | Structured page observation + semantic element map (`element_N`) |
| `page_structure` | READ | Landmarks (header/nav/main/sidebar/footer/search), forms/tables/dialogs |
| `extract_table` | READ | `{headers, rows}` preserving row/column relationships |
| `extract_list` | READ | Structured list/`ul`/`ol` items |
| `extract_links` | READ | Sanitized http(s) links (text, href, rel, target) |
| `find_text` | READ | `exact` / `ci` / `partial` search with bounded context |
| `observe_visual` | READ | Screenshot-for-vision contract — honest `VISION NOT CONFIGURED` |
| `scroll_to` | INTERACTION | Scroll to text or a semantic element (bounded) |
| `set_checkbox` | INTERACTION | Check/uncheck a checkbox or radio |
| `wait_for` | READ | Bounded, cancellable wait for text/element/navigation/idle |

Existing P5.1 tools (navigate, tabs, read_page, extract_data, click, type,
select_option, scroll, wait, inspect_forms, fill_form, download, summarize,
save_result, finish) are unchanged. `download` still delegates to the P2 engine.

## 3. Semantic element map & `eid` targeting

`observe` tags visible interactive elements with an ephemeral
`data-nx-eid="element_N"` (DOM order, ≤ 60) and returns descriptors. The pure
`buildObservation()` bounds + redacts them, and `formatObservation()` renders a
compact list. The model can then target by `eid`:

```json
{ "tool": "click", "input": { "target": { "eid": "element_3" } } }
```

`targetSchema` gained an optional `eid` (regex `^element_\d{1,4}$`). Ephemeral
ids are cleared and re-assigned on every `observe`; a stale id (post-navigation)
resolves to `NOT_FOUND` and triggers recovery — never a wrong click.

## 4. Smart target resolution

`resolveTarget(elements, target)` (pure, in `src/shared/observation.ts`) returns
`EXACT | STRONG | AMBIGUOUS | NOT_FOUND` using eid → role → accessible name →
text with exact/startsWith/includes scoring. Ties at the top score return
`AMBIGUOUS` with candidates — **it never guesses**. In the renderer adapter the
`__nxFind` resolver mirrors this and rejects ambiguous matches.

## 5. Recovery, loop protection, performance

- **Observation-aware loop detection** (new): repeated INTERACTION steps that
  never change the live page signature (`url|title`) terminate with `no_progress`
  — in addition to P5.1's identical-call detection.
- **Bounded waits**: `wait_for` polls at 300 ms up to `AGENT_MAX_WAIT_LONG_MS`
  (15 s) with real cancellation; no long blind sleeps.
- **Bounded observation**: ≤ 60 interactive elements, clamped names/values,
  table rows/cols and list items capped; readable content reuses the P5
  `page-content.ts` truncation/chunking. No full-DOM/A11y-tree dumps.

## 6. Files touched (additive)

- `src/shared/observation.ts` **(new)** — pure hybrid-observation model, element
  map, target resolver, link sanitizer, vision-support check.
- `src/shared/agent.ts` — registry additions, `targetSchema.eid`, planner guidance.
- `src/main/services/agent.ts` — page-derived/retriable sets + observation-aware loop.
- `src/renderer/src/App.tsx` — `OBSERVE_SRC`, `eid` in `__nxFind`, new executors.
- Command palette — state-aware entries (Observe, Extract Table/Links, Find/Scroll).

No new generic IPC was added: every new capability flows through the existing
typed `agent.*` bridge + registry (each tool is itself the typed capability).
