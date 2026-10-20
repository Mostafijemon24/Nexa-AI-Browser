# NEXA — P5.1 Browser Agent · Security Audit

Date: 2026-09-16. Scope: the P5.1 Browser Agent production path only. P0–P5 and
VPN internals unchanged.

## 1. Trust boundaries

| Trust level | Source | Handling |
|-------------|--------|----------|
| System instruction | `AGENT_PLANNER_SYSTEM` | main-owned, constant |
| User instruction | task `instruction` | validated (length), passed as user role |
| Webpage data | tool observations | **untrusted** — fenced with `wrapUntrusted` + `INJECTION_GUARD` |
| Tool result (status) | executor | internal status strings, not instructions |

These levels are never mixed. Page-derived observations are fenced by
`fenceObservation()` before entering the planner context.

## 2. Forbidden-pattern review (§49)

`rg` over `src/shared/agent.ts`, `src/main/services/agent.ts`,
`agent-permissions.ts`, `agent-ipc-host.ts`:

- `child_process` / `exec` / `execFile` / `spawn` / `shell` / `sudo` / `osascript` / `powershell`: **none** (only the word "shell/exec" absent; matches were comments describing the boundary).
- `readFile` / `writeFile` / `delete`: **none** in the agent path.
- `localhost` / `isDev` / `hardcoded` / `mock` / `fake`: **none** as code (only doc comments: "fakeable in tests", "never faked").
- `executeJavaScript`: **none** in the agent core. Used only in the renderer executor with fixed, non-model scripts (semantic resolver + P5 extraction). The model can never inject JS.
- `vault` / `password` / `cookie` / `token` / `credential`: only in **defensive** code/comments (password-field detection → `ask`; "will not enter stored passwords"). No credential access.

## 3. Control checklist

| Control | Status | Evidence |
|--------|--------|----------|
| Renderer cannot call arbitrary IPC | PASS | Only `window.nexa.agent.*` capability methods; each Zod-validated in `register.ts` |
| AI cannot call arbitrary IPC | PASS | Model output is a JSON tool call parsed by `parseToolCall`; only registry tools run |
| AI cannot access filesystem | PASS | No fs API in agent path; download reuses P2 engine via navigation |
| AI cannot access shell | PASS | No child_process/exec/spawn anywhere in path |
| AI cannot access credentials/cookies/tokens | PASS | Not exposed; `type` blocks password fields; secret-like fields → `ask` |
| Webpage content cannot become instructions | PASS | `fenceObservation` + `INJECTION_GUARD`; live test: injection ignored |
| Tool arguments validated | PASS | `validateToolCall` + strict Zod, size caps, URL/selector limits |
| Permissions centralized | PASS | Single `PermissionEngine`; no per-component checks |
| Origin not trusted from model | PASS | Engine uses live snapshot origin; navigate/download URL shape-validated |
| Profile boundaries enforced | PASS | `getTask`/`cancel` reject cross-profile; history per profile |
| Private data not persisted | PASS | `finalize` skips history for `privateMode`; nothing written to disk |
| Bounded execution | PASS | max steps, task timeout, per-tool timeout, no-progress + failure guards |
| Cancellation complete | PASS | AbortController + `raceAbort`; host `abortTask` clears pending |
| Electron hardening preserved | PASS | No changes to sandbox/contextIsolation/nodeIntegration/webSecurity |
| No cloud fallback | PASS | Planner = local Ollama via AIService; `cloudEnabled=false` unchanged |

## 4. Prompt-injection defense (defense-in-depth)

1. **Architectural (absolute):** the model can only emit a validated JSON tool
   call from the registry. Even a fully "jailbroken" model cannot invoke IPC,
   shell, fs, credentials, or navigation it isn't allowed to; high-risk intents
   are `not_configured`; sensitive actions require explicit user confirmation
   against the real origin.
2. **Content fencing:** page text is marker-fenced with embedded-marker
   neutralization + guard instruction.
3. **Model-level (best-effort):** verified live — qwen3:8b ignored an embedded
   "navigate to evil.com / ignore instructions" injection and chose `summarize`.

Even if a model were fooled, step 1 ensures no security boundary is crossed.

## 5. Residual risks / limitations

- Model-level injection resistance varies by model (best-effort atop the absolute
  architectural boundary).
- Element targeting rejects ambiguous matches; a wrong-but-unambiguous match is
  possible (low risk, non-destructive tools auto-allowed).
- Interactive GUI validation is a desktop step (see FINAL).

## 6. VPN

No VPN code, `PROTECTED` semantics, helper protocol, WireGuard, or native
validation status was touched. **P4.2 remains BLOCKED — ENVIRONMENT.** The agent
operates through the normal browser boundary and never claims VPN protection.
