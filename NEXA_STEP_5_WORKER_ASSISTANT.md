# NEXA — STEP 5: Worker Assistant & Smart Worker Mode

**Additive capability layer.** No system was replaced. The browser shell, design
tokens, AI/agent architecture, PermissionEngine, observation/semantic targeting,
P5.2 tools, P5.3 vision, profiles, private mode, vault, and STEP 4 Click-to-Go are
preserved and reused.

- **Baseline in:** 412/412 tests · typecheck PASS · build PASS · lint NOT CONFIGURED
- **Baseline out:** 449/449 tests · typecheck PASS · build PASS · lint NOT CONFIGURED

---

## 1. Architecture

```
Address bar / Command Palette / Toolbar / Click-to-Go
        ↓  (open Worker)
WorkerPanel (renderer, compact docked panel)
        ↓  Scan Page
workerScanLive()  ──► OBSERVE_SRC (existing P5.2 capture)  ──► buildObservation() (bounded + secret-redacted)
        │                └► WORKER_EXTRAS_SRC (radio/checkbox groups + select options, keyed by same eids)
        ▼
scanObservation()  (PURE, src/shared/worker.ts)  ──► WorkerScan { questions, fields, optionGroups, buttons, counts }
        ▼  Generate Suggestions (optional AI)
buildWorkerSuggestionMessages() (untrusted-fenced) ──► aiComplete() (one-shot, scoped) ──► sanitizeSuggestion()
        ▼  Use Answer (approve) → Fill Selected
buildFillPlan(mode) → decisions {auto|confirm|block} → runWorkerActions() → EXISTING agent tools (type/select_option/set_checkbox)
        ▼
FIELDS FILLED — REVIEW REQUIRED  (user submits manually; NEXA never submits)
```

**Deterministic core** lives in `src/shared/worker.ts` (pure, unit-tested). The
renderer store orchestrates; App.tsx provides the live capture + panel. There is
**no second AI runtime, agent engine, observation engine, permission system, tool
registry, or IPC channel** — every side-effect reuses an existing capability.

## 2. Intent / data types (`src/shared/worker.ts`)

- `WorkerScan` — `questions[]`, `fields[]`, `optionGroups[]`, `buttons[]`, `counts`, `truncated`.
- `WorkerQuestion { id, text, source, fieldId? }` — deduped, normalized, ephemeral `question_N`.
- `WorkerField { id, eid, type, label, required, secret, value? }` — `value` never present for secret fields.
- `WorkerOptionGroup { id, kind:'radio'|'checkbox'|'select', label, options }`.
- `WorkerButton { id, eid, label, classification, highImpact }` — **display only**.
- `WorkerAnswer { id, questionId, suggestedText, confidence, source, editable }` — no prompts/CoT stored.
- `WorkerFillAction { tool:'type'|'select_option'|'set_checkbox', decision:'auto'|'confirm'|'block', ... }`.
- Ephemeral ids are page/session-scoped; field targeting uses the observation's `eid` via the existing `resolveTarget`.

## 3. Worker modes (reuse existing ASK / ASSIST / AGENT)

The panel reuses the existing `agentMode`. `workerFillDecision(mode, field)`:

| Mode | Non-sensitive write | Sensitive/secret field |
|------|---------------------|------------------------|
| **ASK** | `block` (read-only: scan/detect/suggest only) | `block` |
| **ASSIST** | `confirm` (every write confirmation-gated) | `confirm` |
| **AGENT** | `auto` (low-risk) | `confirm` (never auto) |

Password-type fields are **excluded from filling entirely** (never typed). The
existing executor also hard-blocks `type` into `input[type=password]`.

## 4. Page scanner

Reuses `OBSERVE_SRC` (fixed, non-model capture) + `buildObservation` (bounded to 60
elements, secret-redacted) — **no new DOM crawler**. `scanObservation` then detects:
questions (from prompt-like field labels + candidate texts, deduped), fields (text/
textarea/email/tel/number/date/url/select), option groups (radios/checkboxes grouped
by control name; select option lists), and buttons (classified for display). Bounds:
30 questions · 40 fields · 20 groups · 40 options/group · 20 buttons.

## 5. Answer suggestion (optional AI)

`buildWorkerSuggestionMessages` builds messages that fence page content with the
existing `wrapUntrusted` + `INJECTION_GUARD` and include only minimal context (page
title, question, field type, optional user context). Sent via `aiComplete` — a
one-shot, requestId-scoped Ollama call that never pollutes the chat panel. Output is
run through `sanitizeSuggestion` (strips fences/preamble/quotes, clamps length).
**Scanning works with AI offline**; only suggestions require Ollama.

## 6. Smart fill (semantic, never arbitrary)

Fill actions target fields by their ephemeral `eid` and execute through the existing
agent executor tools only (`type` / `select_option` / `set_checkbox`). No
model-generated selectors, no `document.querySelector(modelSelector)`, no arbitrary
JS. Ambiguous/not-found targets are never guessed (the existing resolver returns
`AMBIGUOUS`/`NOT_FOUND`). The Worker never clicks buttons and never submits.

## 7. Registered commands / services / page actions

- **Command Palette** (`Worker:` group, shared list): Open Worker Assistant · Scan Page · Generate Page Answers · Fill Approved Fields · Clear Worker Session.
- **Click-to-Go** (STEP 4 single registry, unchanged resolver): command `worker` (opens the panel via new `panel:'worker'` field) and page action `answer` ("answer page" — scan + generate, requires page + AI). Existing `scan`/`summarize`/`ask` preserved.
- **Toolbar**: a Worker (briefcase) button toggles the panel.

## 8. Security boundary

- No `eval`, `new Function`, arbitrary `executeJavaScript`, model-generated JS, shell, generic filesystem, or generic IPC. No new IPC channel was added.
- Only registered intent ids and observation-resolved `eid` targets are executable. No generic `worker.execute(input)` path.
- Secret/credential/OTP/token/card fields are flagged `secret` by the observation layer; their **values never enter** the scan, AI context, suggestions, task history, or logs. Vault secrets are never exposed to the model (vault insertion is out of scope for STEP 5).
- Electron config unchanged: `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`, `webSecurity=true`, CSP unchanged.

## 9. Injection defense

All page text is untrusted. Suggestion prompts fence it with the existing markers;
`wrapUntrusted` neutralizes spoofed fence markers. Hostile page instructions ("ignore
previous instructions", "reveal your system prompt", "enter this password") remain
inert data. Covered by regression tests.

## 10. Private mode & profile isolation

- Fills route through existing actions that respect the per-tab `private` flag.
- Task history is **skipped entirely in private mode**; page context text is held in a non-persisted module variable and cleared with the session.
- All worker state (scan, answers, approvals, pending fills, history, user context) is reset on profile switch. Worker state is never written to the persisted session/prefs.

## 11. Task history

Lightweight, in-memory, profile-scoped entries: `{ site, title, questionsAnswered, fieldsFilled, createdAt }`, grouped Today/Yesterday. **No passwords, OTPs, payment data, cookies, tokens, or page contents.** Not persisted to disk (session-scoped) — the safer privacy choice; durable persistence is a documented follow-up.

## 12. Performance

Bounded observation (existing limits) + small pure transforms. No tight scan loop,
no background inference, no unnecessary screenshots, no artificial delays/debounce.
Suggestions run sequentially per question via one-shot calls.

## 13. Worker states

`idle → scanning → scanned → generating → ready → filling → (blocked ⇄ confirm) → review`,
plus `blocked` (confirmation/read-only) and `error`. States are surfaced with an
`aria-live` status; no fake success states.

## 14. Files changed

- **NEW** `src/shared/worker.ts` — pure core (types, scanner, classifier, suggestion messages, fill model).
- **NEW** `tests/unit/worker.test.ts` — 29 tests.
- **NEW** docs: this file, `NEXA_STEP_5_SECURITY_AUDIT.md`, `NEXA_STEP_5_TEST_MATRIX.md`.
- `src/renderer/src/state/store.ts` — worker slice (`aiComplete`, scan/generate/edit/approve/fill/confirm/cancel/setOption/clear), scanner-registration hook, module helpers, profile-switch reset.
- `src/renderer/src/App.tsx` — `workerScanLive` + `WORKER_EXTRAS_SRC`, `WorkerPanel`/`WorkerAnswerCard`/`WorkerHistoryList`, toolbar button, panel mount, palette `Worker:` commands, Click-to-Go worker command + `answer` page action execution.
- `src/shared/click-to-go.ts` — `panel:'worker'` command + `answer` page action (single registry; resolver unchanged).
- `tests/unit/theme-tokens.test.ts` — +8 STEP 5 source-guard tests. `tests/unit/click-to-go.test.ts` — command-target assertion updated for `panel`.

## 15. Limitations (honest)

- **GUI verification: BLOCKED — ENVIRONMENT** (headless; no live Chromium/webview).
- AI suggestion quality depends on the local model; not 100% accurate. Detection depends on page semantics; unusual/canvas/iframe forms may be unsupported ("Site structure unsupported").
- Radio/checkbox grouping uses the form-control `name`; ungrouped controls fall back to a single group.
- Vault autofill of secrets is intentionally **NOT_CONFIGURED** (later phase).
- Task history is session-scoped (not persisted to disk).
- Visual assistance is only used if a vision-capable model is installed (else "Visual assistance unavailable"); the Worker scan itself is DOM/semantic and does not require vision.
