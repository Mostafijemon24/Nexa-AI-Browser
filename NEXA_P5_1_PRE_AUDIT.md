# NEXA — P5.1 Browser Agent · Pre-Implementation Audit

Date: 2026-09-16. Completed **before** writing any agent code, per the master prompt.

## 1. Repository structure (relevant)

```
src/shared/        ai.ts, page-content.ts, channels.ts, types.ts, ipc.ts, downloads.ts, vpn.ts, library.ts
src/main/          index.ts, ipc/register.ts, services/{ai,ollama,downloads,protection,vpn,persistence,vault,library,secure-storage}.ts
src/preload/       index.ts  (contextBridge → window.nexa)
src/renderer/src/  App.tsx, state/store.ts, nexa.d.ts, views/*
src/platform/      index.ts, types.ts (assertSafeProfileId, PlatformAdapter)
tests/unit/        21 files, 263 tests
```

## 2. Existing reusable infrastructure (MUST reuse, not rebuild)

| Capability | Location | Reuse in P5.1 |
|-----------|----------|---------------|
| Ollama client (loopback, streaming, cancel, embed) | `src/main/services/ollama.ts` | Planner backend — **no second client** |
| AIService (per-profile, status, chat stream, cancel) | `src/main/services/ai.ts` | Add non-streaming `complete()` for planning; reuse everything else |
| Prompt-injection fence | `src/shared/page-content.ts` (`wrapUntrusted`, `INJECTION_GUARD`) | Wrap ALL page/tool observations fed to planner |
| Page extraction | `App.tsx` `EXTRACT_SCRIPT` + `normalizePageExtract` | `read_page` / `extract_data` observations |
| Typed IPC pattern | `channels.ts` + `ipc.ts` (Zod) + `register.ts` `wrap()` | New `agent.*` channels, Zod-validated, sanitized errors |
| Preload capability API | `src/preload/index.ts` (`window.nexa.*`) | Add `window.nexa.agent.*` (capability-specific only) |
| Zustand store + streaming events | `store.ts` (ai slice, `onEvent`) | Add agent slice + `agent.event` listener |
| Tabs/webview model | `TabRecord{kind,url,view}`, single active `<webview>`, `activeWebview()`, store `navigate/newTab/activateTab/closeTab` | Browser tool execution |
| Downloads (P2) | `downloads.ts` (`session.on('will-download')`) | `download` tool = navigate to trigger existing engine; **no new download code** |
| Profile isolation | `assertSafeProfileId`, per-profile dirs | Agent state keyed by profileId |
| Private mode | `TabRecord.private`, memory-only AI context | Agent tasks memory-only in private |

## 3. Proposed integration points

```
Ollama → OllamaClient → AIService.complete()        (existing, +1 method)
                              ↓
                        AgentService (NEW, main)      state machine + bounded loop
                              ↓ plan
                        shared/agent.ts (NEW)         tool registry, schemas, planner prompt, parse/validate
                              ↓ validated tool call
                        PermissionEngine (NEW, main)  allow / deny / ask (origin + class + risk)
                              ↓ allow
                        AgentToolHost (interface)     production = IPC bridge to renderer
                              ↓ agent.event (tool-request)
                        Renderer tool executor (NEW)  drives active <webview> / store tabs
                              ↓ agent.toolResult (IPC)
                        Observation (sanitized, fenced) → back to loop
```

- Planner runs in **main** (Ollama is main-only, loopback). Permission decisions are **centralized** in main (`PermissionEngine`), never scattered in UI.
- Browser actions execute in the **renderer** (that is where the single active `<webview>` lives) via a request/response bridge, so the AI never touches Electron/Chromium/webContents directly.
- `AgentService` is designed with **injected `Planner` + `AgentToolHost`** so the security-critical core is fully unit-testable with deterministic fakes, and validated live against real Ollama for planning.

## 4. Files that MUST remain untouched

- All `src/main/services/vpn*`, `src/main/services/vpn-helper/*`, `src/helper/*`, `src/shared/vpn.ts` — **P4.2 gate is BLOCKED — ENVIRONMENT**.
- `PROTECTED` semantics, WireGuard, helper protocol, native validation status.
- P2 download engine internals, P3 protection engine internals (reuse via existing APIs only).
- Electron security flags: `sandbox`, `contextIsolation`, `nodeIntegration=false`, `webSecurity=true`.

## 5. Security boundaries (enforced)

1. **AI → data only.** The model emits a *structured JSON tool call*; it never emits code, IPC names, file paths, or shell. Arbitrary prose is rejected.
2. **Registry allowlist.** Unknown tool / bad schema / oversized args / bad URL / bad selector → **REJECT** before any execution.
3. **Central permission.** Every call passes `PermissionEngine` with the *actual Chromium origin* (never the model-supplied URL). High-risk (submit/login/payment/credential/upload/delete/send) → always `ask` or `NOT CONFIGURED`.
4. **Untrusted content.** All page text / tool observations are fenced with the existing P5 `wrapUntrusted` + `INJECTION_GUARD`. Webpage text can never become an instruction.
5. **No generic IPC / fs / shell / credentials / cookies / tokens** exposed to agent or model. No `executeJavaScript` tool exposed to the model (semantic tools only).
6. **Bounded loop.** Max steps, per-tool timeouts, max task runtime, repeated-call / no-progress detection → safe stop.
7. **Profile + private isolation.** Agent state keyed by profileId; profile switch terminates active task; private tasks are memory-only and destroyed on end.

## 6. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Model emits non-JSON / hallucinated tool | Strict `parseToolCall` + Zod; reject → feed error observation; loop-guard stops runaway |
| Model targets a forged origin | Permission engine resolves the *live* webview origin, ignores model URL for the decision |
| Prompt injection from page telling agent to submit/upload | Content fenced as data; high-risk tools always require explicit user confirmation |
| Infinite loop / oscillation | Step cap (default 25), repeated-signature detection, no-progress detection, task timeout |
| Private data leakage | Private tasks memory-only; no history/embeddings persisted; observations never logged |
| Live GUI validation | Structured planning validated with **real Ollama**; interactive Chromium GUI driving requires a desktop session (documented limitation) |

## 7. Implementation plan

1. `src/shared/agent.ts` — types, state machine, tool registry (name/version/schema/class/risk/timeout), planner system prompt (JSON tool-call contract + injection guard), `parseToolCall` + validation, limits, loop-detection helpers. (pure, tested)
2. `src/main/services/agent-permissions.ts` — `PermissionEngine.evaluate()`. (pure, tested)
3. `src/main/services/agent.ts` — `AgentService`: task/step model, state machine, bounded loop, injected `Planner` + `AgentToolHost`, permission gating, cancel/pause/resume, profile/private isolation, `agent.event` emit, safe task history.
4. `AIService.complete()` — non-streaming planning completion (reuses `OllamaClient.chat`).
5. IPC: `agent.*` channels + preload `window.nexa.agent` + `nexa.d.ts` + `register.ts` handlers + `main/index.ts` wiring + renderer `AgentToolHost` bridge.
6. Renderer: store agent slice + browser tool executor (webview/tabs) + Agent mode in `AiPanel` + command palette entries (state-gated).
7. Tests: `agent-shared`, `agent-permissions`, `agent-service`, tool-registry — cover core/loop/cancel/pause/resume/limits/loop-detection/profile/private/injection/forged-origin/forged-tool.
8. Real Ollama planning validation + regression (263 baseline) + typecheck + build.
9. Docs: IMPLEMENTATION, SECURITY_AUDIT, TEST_MATRIX, FINAL.

## 8. Explicit non-goals for P5.1 (honest, not faked)

- Credential automation / password entry → `ASK_USER` / `NOT CONFIGURED` (no vault shortcut).
- Payment / account deletion / external send → always confirm; no silent execution.
- Unrestricted `executeJavaScript` for the agent → not exposed.
- Vision/screenshot understanding on a text-only local model → `CAPABILITY NOT AVAILABLE`.
- Scheduler / recurring tasks → interfaces only; no fake scheduling.

**P4.2 Native VPN Validation Gate: BLOCKED — ENVIRONMENT (untouched).**
