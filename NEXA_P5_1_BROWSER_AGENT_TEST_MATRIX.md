# NEXA — P5.1 Browser Agent · Test Matrix

Date: 2026-09-16. Suite total: **311/311 PASS** (263 baseline + 48 new agent tests).
Typecheck PASS. Build PASS.

New test files:
- `tests/unit/agent-shared.test.ts` (22)
- `tests/unit/agent-permissions.test.ts` (12)
- `tests/unit/agent-service.test.ts` (14)

Modes (Ask/Assist/Agent):
- Assist confirms every interaction; Agent auto-runs low-risk interaction — `agent-permissions` + `agent-service` mode tests — PASS
- Ask mode performs no browser actions beyond reading — `agent-permissions` — PASS
- Secret-field typing always asks regardless of mode — `agent-permissions` — PASS

## Agent core

| Case | Test | Result |
|------|------|--------|
| Task creation + multi-step completion | agent-service happy path | PASS |
| State transitions (valid/invalid) | agent-shared state machine | PASS |
| Step execution order (finish terminal) | agent-service happy path | PASS |
| Completion with result | agent-service happy path | PASS |
| Failure (invalid tool call) | agent-service badjson | PASS |
| Cancellation during execution | agent-service cancel | PASS |
| Pause / resume to completion | agent-service pause/resume | PASS |

## Tool registry

| Case | Test | Result |
|------|------|--------|
| Valid tool + args accepted | agent-shared validate | PASS |
| Unknown tool rejected | agent-shared / service (forged) | PASS |
| Invalid schema / bad URL / empty target | agent-shared validate | PASS |
| Extra fields rejected (strict) | agent-shared validate | PASS |
| Oversized arguments rejected | agent-shared validate | PASS |
| High-risk intents → not_configured | agent-shared validate | PASS |
| Unavailable (screenshot) → capability_unavailable | agent-shared validate | PASS |
| Every tool has class/risk/timeout/version | agent-shared registry | PASS |

## Permission

| Case | Test | Result |
|------|------|--------|
| READ auto-allow | agent-permissions | PASS |
| NAVIGATION auto-allow + URL validation | agent-permissions | PASS |
| INTERACTION auto-allow | agent-permissions | PASS |
| type into secret field → ask | agent-permissions | PASS |
| fill_form → ask (never submits) | agent-permissions | PASS |
| download → ask; bad URL → deny | agent-permissions | PASS |
| Specific, non-vague summary w/ origin | agent-permissions | PASS |
| Live origin used, not model URL | agent-permissions | PASS |

## Security

| Case | Test | Result |
|------|------|--------|
| Prompt injection in page → fenced as data | agent-service injection | PASS |
| Marker-injection neutralized | page-content (P5) + fence | PASS |
| Forged tool call not executed | agent-service forged | PASS |
| Arbitrary IPC / shell / fs attempt | rejected: not in registry (validate) | PASS |
| Credential extraction attempt | password field blocked / not exposed | PASS |
| Forged origin | engine uses live origin | PASS |

## Profile / private

| Case | Test | Result |
|------|------|--------|
| Profile isolation (history per profile) | agent-service profile | PASS |
| Cross-profile cancel rejected | agent-service cancel scope | PASS |
| Private mode → no history persisted | agent-service private | PASS |

## Agent loop

| Case | Test | Result |
|------|------|--------|
| Successful multi-step task | agent-service happy path | PASS |
| Repeated-step (no-progress) detection | agent-service loop | PASS |
| Maximum-step enforcement (25) | agent-service max | PASS |
| Cancellation during tool execution | agent-service cancel | PASS |
| Invalid-plan strikes → stop | agent-service badjson | PASS |

## Real Ollama validation (no mocks) — `qwen3:8b`

| Check | Result |
|-------|--------|
| Ollama `/api/tags` | CONNECTED |
| Structured planning (fresh task → `navigate`) | PASS (valid JSON tool call) |
| Structured planning after read (→ `summarize`) | PASS (valid) |
| Prompt-injection resistance (embedded "navigate evil.com / ignore") | PASS (ignored; chose summarize) |
| Real incremental streaming / cancellation (P5 infra reused) | PASS |

## Real Chromium (interactive GUI)

Tasks A–F (open+read+summarize, search+open+summarize, find+fill form w/o submit,
multi-tab compare, download via P2, injection page) are implemented against the
live `<webview>`/tabs and are ready to run in a **desktop Electron session**. They
were not executed in this headless CI environment (no display). See FINAL →
READY WITH LIMITATIONS.

## UX validation

Agent UI reuses the existing NEXA design system (Ask/Agent segmented modes,
compact activity log, explicit permission card "Allow Once / Cancel", Stop/Pause/
Resume, honest state labels). Full multi-resolution/light-dark/a11y sweep is a
desktop step.
