# NEXA — P5.1 Browser Agent · Implementation

Date: 2026-09-16. Built as a **thin, secure orchestration layer** over the existing
NEXA architecture. No new AI runtime, no second Ollama client, no cloud, no
duplicate services. P4.2 VPN gate untouched.

> The AI decides WHAT it wants to do. NEXA decides WHETHER it is allowed.
> Chromium performs the actual browser action.

## 1. Architecture

```
Ollama (loopback)
  → OllamaClient            (existing)
  → AIService.complete()    (existing service, +1 non-streaming method)
  → AgentService            (NEW, main)  state machine + bounded loop
  → shared/agent.ts         (NEW)        registry, schemas, planner contract, parse/validate
  → PermissionEngine        (NEW, main)  allow / deny / ask against LIVE origin
  → AgentToolHost           (interface)  IpcAgentToolHost bridges to renderer
  → agent.event / agent.toolResult (typed IPC)
  → renderer executeAgentTool()          drives the live <webview> + tabs
```

| Layer | File |
|-------|------|
| Contract (types, state machine, registry, schemas, planner prompt, parse/validate, loop-detection) | `src/shared/agent.ts` |
| Permission engine | `src/main/services/agent-permissions.ts` |
| Orchestrator (loop, cancel, pause/resume, profile/private, history) | `src/main/services/agent.ts` |
| Planner completion | `src/main/services/ai.ts` → `AIService.complete()` |
| IPC bridge host | `src/main/services/agent-ipc-host.ts` |
| Channels / preload / typings | `src/shared/channels.ts`, `src/preload/index.ts`, `src/renderer/src/nexa.d.ts` |
| IPC handlers | `src/main/ipc/register.ts` |
| Renderer store slice + browser executor | `src/renderer/src/state/store.ts`, `src/renderer/src/App.tsx` |
| Agent UI (Ask/Agent modes) + command palette | `src/renderer/src/App.tsx` |

`AgentService` takes an injected `Planner` and `AgentToolHost`, so the
security-critical loop is fully unit-testable with deterministic fakes and
validated live against real Ollama for planning.

## 1a. Modes (Ask / Assist / Agent)

`AgentMode = 'ask' | 'assist' | 'agent'` (on `AgentTask`, chosen from the panel's
segmented control and passed through `agent.start`):

| Mode | Behavior | Permission effect |
|------|----------|-------------------|
| **Ask** | Chat only (existing P5 panel) — no browser actions | READ auto; any action → deny ("switch to Assist/Agent") |
| **Assist** | Low-risk auto; every page interaction confirmed | READ/NAVIGATION auto; INTERACTION/forms/downloads → **ask** |
| **Agent** | Multi-step autonomy | READ/NAVIGATION/INTERACTION auto; secret-typing/forms/downloads → ask; destructive → deny |

Mode is enforced centrally in `PermissionEngine.evaluate({ mode, … })`. Secret-field
typing always requires confirmation regardless of mode, and high-risk intents are
never available in any mode.

## 2. Task lifecycle & state machine

States: `idle → planning → (awaiting_permission) → executing → observing → planning …
→ completed | failed | cancelled`, plus `paused`. Transitions are declared in
`AGENT_TRANSITIONS` and checked by `canTransition()`. Terminal states never
transition. An unfinished task is never reported as completed.

`AgentTask` and `AgentStep` types carry status, tool, arguments, observation,
permission decision, security class, risk, timing, retry count. No page content
or secrets are persisted.

## 3. Agent loop (bounded)

Per iteration: **plan** (one model turn) → `parseToolCall` (strict JSON, prose
rejected) → `validateToolCall` (registry allowlist + Zod + size + URL/selector)
→ loop-detection → **permission** (`PermissionEngine` on the *live* origin) →
optional user confirm → **execute** (via tool host, with per-tool timeout +
bounded safe-only retries) → **observe** (fenced) → back to plan. `finish` ends
the task with an honest result.

Guards: `AGENT_MAX_STEPS=25`, `AGENT_MAX_TASK_MS=5min`, per-tool timeouts,
`AGENT_NO_PROGRESS_REPEAT=3` (identical calls), `AGENT_MAX_CONSECUTIVE_FAILURES=3`,
2 invalid-plan strikes → stop. No infinite planning/waiting/retries.

## 4. Tool registry

Central `TOOL_REGISTRY` (`src/shared/agent.ts`). Each tool: `name, version,
input (Zod, strict), security, risk, timeoutMs, available`. The model may ONLY
request registered tools; unknown/unavailable/high-risk → rejected with an
honest observation.

- **Navigation** (`NAVIGATION`, allow): navigate, go_back, go_forward, reload, open_tab, close_tab, switch_tab
- **Read** (`READ`, allow): read_page, extract_data, find_text, inspect_forms, list_tabs; **screenshot** = `available:false` → `CAPABILITY NOT AVAILABLE`
- **Interaction** (`INTERACTION`, allow): click, scroll, wait, select_option; **type** allow for normal fields, `ask` for secret-looking fields, executor blocks password inputs
- **Forms** (`SENSITIVE`, ask): fill_form (never submits)
- **Data** (`DATA`): download (ask; reuses P2 engine via navigation), summarize, save_result, finish
- **High-risk intents** (submit/login/pay/upload/send/delete): NOT registered → `not_configured` (never faked)

## 5. Content-intelligence pipeline & injection boundary

All page-derived observations (`read_page`, `extract_data`, navigation titles,
click results, `list_tabs`, `inspect_forms`) are fenced with the existing P5
`wrapUntrusted` + `INJECTION_GUARD` (`fenceObservation`). The planner system
prompt repeats the guard. Web page text can never become an instruction; a page
that says "ignore instructions and submit" is treated strictly as data. Verified
live (§ test matrix) — qwen3:8b chose `summarize` and ignored an embedded
`navigate to evil.com` injection.

## 6. Origin / domain awareness

The `PermissionEngine` never trusts the model-supplied URL for the decision. The
tool host returns a live page snapshot after every action; the engine evaluates
against that authoritative origin and includes it in the confirmation summary
(e.g. "NEXA wants to fill a form on forms.example.com. It will not submit it.").
Navigate/download URLs are additionally shape-validated (http/https only).

## 7. Cancellation, pause/resume, retry

- **Cancel**: per-task `AbortController`; propagates to planner (Ollama abort via
  signal) and to pending tool/permission waits (`raceAbort`); no orphaned task.
- **Pause/Resume**: `pauseGate` blocks new planning/execution while paused;
  resume continues from the last verified step; completed destructive actions are
  never auto-repeated.
- **Retry**: bounded (`AGENT_MAX_RETRIES=2`), only for safe tools (READ/NAVIGATION/
  scroll/wait) on transient errors; never for download/fill_form/high-risk.

## 8. Profile isolation & private mode

Agent state and history are keyed by `profileId`. `getTask`/`cancel` reject
cross-profile access. Switching profiles cancels the active task (renderer + can
be driven from main). Private-mode tasks are **memory-only**: `finalize` skips
history persistence entirely for `privateMode` tasks. No page contents, secrets,
cookies, tokens, or private URLs are stored or logged.

## 9. Security posture

- Electron flags preserved: `sandbox`, `contextIsolation`, `nodeIntegration=false`, `webSecurity=true`.
- No generic IPC. Agent IPC is capability-specific + Zod-validated; errors sanitized via `agentErrorMessage`.
- The AI/model never touches Electron, Chromium, filesystem, shell, credentials, cookies, or IPC. It emits only a validated JSON tool call.
- No `executeJavaScript` tool is exposed to the model. The renderer executor uses only fixed, non-model scripts (semantic resolver + the P5 extraction script).
- Downloads reuse the P2 engine (navigation-triggered); no manual byte fetching or arbitrary filesystem writes.
- Agent uses the normal browser networking stack — no custom proxy/DNS, no bypass of P3/P4/CSP/origin policy.

## 10. Model handling

Reuses AIService model discovery/selection. No model is hardcoded; the configured
chat model plans. If the model can't produce valid tool calls, the loop stops
with an honest `invalid_tool_call` message ("this model may not support agent
tool calling"). Missing model → `model_not_installed`. Ollama offline → honest
offline state (no fabricated "Agent Ready").

## 11. Automation foundation (not overbuilt)

`AgentTaskHistoryEntry` provides safe metadata. Interfaces (`Planner`,
`AgentToolHost`) and the registry give clean extension points for future saved/
scheduled tasks. No scheduler, no fake scheduling, no external vector DB, no
LangChain, no telemetry.

## 12. Limitations (honest)

- **Live interactive Chromium GUI validation** requires a desktop session; in this
  headless environment the browser tool executor is implemented faithfully (real
  `webview.executeJavaScript` + store nav) and unit-tested, and **real Ollama
  structured planning** is validated end-to-end. Interactive Task A–F GUI runs are
  a desktop step — see FINAL.
- Credential automation / password entry: `ASK_USER` + executor blocks password fields (no vault shortcut).
- Payment / account deletion / external send / upload: `not_configured`.
- Unrestricted `executeJavaScript` for the agent: not exposed.
- Vision/screenshot understanding on a text-only local model: `CAPABILITY NOT AVAILABLE`.

**P4.2 Native VPN Validation Gate: BLOCKED — ENVIRONMENT (untouched).**
