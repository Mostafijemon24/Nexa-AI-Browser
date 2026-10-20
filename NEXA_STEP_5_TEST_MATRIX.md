# NEXA — STEP 5 Test Matrix (Worker Assistant)

Totals: **449/449** passing (baseline 412 + **29** worker core + **8** source-guard).
Typecheck PASS · Build PASS · Lint NOT CONFIGURED.

New: `tests/unit/worker.test.ts` (29). Extended: `tests/unit/theme-tokens.test.ts`
(+8 STEP 5 guards), `tests/unit/click-to-go.test.ts` (command-target assertion).

## Scanner

| Case | Test | Status |
|------|------|--------|
| Field type classification (text/email/textarea/select/radio/checkbox/password) | `fieldTypeOf` | PASS |
| Text / textarea / select field detection | scanObservation — detection | PASS |
| Question detection from prompt-like labels | detects questions… | PASS |
| Duplicate question removal | detects questions… (dedup) | PASS |
| Radio + checkbox option-group detection | detects radio + checkbox groups | PASS |
| Radio grouping by control name + select option lists (extras) | uses extras to group… | PASS |
| Button classification + high-impact flag | classifies buttons… | PASS |
| Stable ephemeral ids (question_/field_/option_group_/button_) | produces counts and ids | PASS |
| Bounded output (max questions/fields) | bounds output… | PASS |
| Empty input → no questions/fields | bounds output… (empty) | PASS |

## Security

| Case | Test | Status |
|------|------|--------|
| Password field flagged secret, value omitted | fieldTypeOf / redaction | PASS |
| OTP / API key / card / password redaction | flags credential/OTP/token/card… | PASS |
| No question derived from secret field | never derives a question… | PASS |
| No secret value in serialized scan (state/logs) | a serialized scan contains no secret values | PASS |
| Injection text treated as untrusted (fenced) | buildWorkerSuggestionMessages — injection safety | PASS |
| Fence-marker spoofing neutralized | neutralizes attempts to spoof… | PASS |
| System prompt carries injection guard | fences untrusted page content… | PASS |

## Suggestions

| Case | Test | Status |
|------|------|--------|
| Injection-safe message construction | buildWorkerSuggestionMessages | PASS |
| User context included, no fabricated secrets | includes user context… | PASS |
| Sanitize preamble / quotes / fence markers | sanitizeSuggestion | PASS |
| Bounded answer length | sanitizeSuggestion (clamp) | PASS |
| Ollama unavailable (scan still works) | runtime (store guard) + doc | PASS (deterministic scan independent of AI) |

## Targeting (no guessing)

| Case | Test | Status |
|------|------|--------|
| EXACT by ephemeral eid | resolveTarget reuse | PASS |
| NOT_FOUND for stale/unknown eid | resolveTarget reuse | PASS |
| STRONG / AMBIGUOUS behavior | covered by existing `observation.test.ts` (reused resolver) | PASS |

## Permissions & fill

| Case | Test | Status |
|------|------|--------|
| ASK blocks all writes | workerFillDecision / buildFillPlan | PASS |
| ASSIST confirmation-gates every write | workerFillDecision | PASS |
| AGENT auto low-risk, confirm sensitive | workerFillDecision | PASS |
| Password field excluded from fill entirely | buildFillPlan | PASS |
| Secret (non-password) field → confirm, never auto | buildFillPlan | PASS |
| Fill maps only to type/select_option/set_checkbox | buildFillPlan | PASS |
| Unknown/unfillable field → no action | toolForFieldType / buildFillPlan | PASS |
| Never submits (no submit/click in fill path) | source guard (theme-tokens) | PASS |

## Integration (source guards)

| Case | Test | Status |
|------|------|--------|
| Uses shared worker core (single source of truth) | Worker Assistant (STEP 5) | PASS |
| Reuses OBSERVE_SRC + buildObservation (no new crawler) | reuses existing observation capture | PASS |
| Fills via existing agent executor (no new path) | fills only through existing agent tools | PASS |
| Private mode + profile isolation | respects private mode + profile isolation | PASS |
| Scoped one-shot AI (no chat-panel pollution) | one-shot AI completion is scoped | PASS |
| Accessible roles + live status | Worker panel exposes accessible roles | PASS |
| Palette + Click-to-Go share one registry | Command Palette + Click-to-Go share one registry | PASS |

## Regression

| Suite | Status |
|-------|--------|
| STEP 4 Click-to-Go (18) | PASS |
| Design/tokens + STEP 2/3/4/5 guards (33) | PASS |
| Agent / observation / vision / permissions / downloads / vpn / library / session / ai | PASS |
| **Total** | **449/449 PASS** |

## GUI

`GUI Verification: BLOCKED — ENVIRONMENT` (headless; no live Chromium/webview).
Resolutions 1280×800 / 1440×900 / 1920×1080 / 2560×1440 not visually verified.
