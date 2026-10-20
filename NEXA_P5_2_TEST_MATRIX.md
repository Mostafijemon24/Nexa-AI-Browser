# NEXA P5.2 — Test Matrix

Date: 2026-09-16. Suite total: **342 / 342 PASS** (311 P5.1 baseline + 31 new).
Typecheck PASS · Build PASS · Lint CLEAN.

New / extended test files:
- `tests/unit/observation.test.ts` (18)
- `tests/unit/agent-p52-tools.test.ts` (11)
- `tests/unit/agent-service.test.ts` (+2 observation-aware loop tests)

## Coverage

### Observation (`observation.test.ts`)
- Ephemeral id assignment in DOM order — PASS
- Invisible-element drop + bound to `OBS_MAX_ELEMENTS` + truncated flag — PASS
- Non-http(s) href dropped from element map — PASS
- Landmark/structure normalization — PASS
- Sensitive-field detection (password/otp/cvv/token/autocomplete) — PASS
- Secret value never in element map **or** formatted text — PASS
- Bounded accessible name — PASS

### Targeting (`observation.test.ts`)
- EXACT (eid, unique exact name) — PASS
- STRONG (startsWith / partial, role-only unique) — PASS
- AMBIGUOUS (tie → candidates, no guess) — PASS
- NOT_FOUND (stale eid, no match) — PASS
- index disambiguates a tie → EXACT — PASS

### Extraction
- `extract_links` sanitizer: keeps http(s), drops javascript:/data:/file:/mailto:, dedupes — PASS
- `extract_table` / `extract_list` schema (optional index, reject unknown fields) — PASS

### Tool registry & schemas (`agent-p52-tools.test.ts`)
- All new tools registered with class/schema/timeout — PASS
- Security classes correct (READ vs INTERACTION) — PASS
- `targetSchema.eid` accepts `element_N`, rejects malformed/injection — PASS
- `wait_for` condition enum + bounded timeout — PASS
- `scroll_to` requires text|target — PASS
- `set_checkbox` requires boolean; `find_text` mode — PASS
- `click` by eid parses + validates — PASS

### Permission
- Observation/extraction tools auto-allow in Agent AND Assist (read-only) — PASS
- `scroll_to`/`set_checkbox` auto in Agent, confirm-gated in Assist — PASS
- Read-only allowed in Ask; interaction denied in Ask — PASS

### Recovery / loop (`agent-service.test.ts`)
- Observation-aware loop: repeated interactions, no page change → `no_progress` — PASS
- No false-positive when page changes between interactions → completes — PASS
- (P5.1 retained) retry, timeout, max-steps, identical-call loop, cancel, pause/resume — PASS

### Vision
- `visionSupported`: text-only (qwen3/llama3.1) → false; vision models → true — PASS
- `observe_visual` returns honest `VISION NOT CONFIGURED` (contract) — PASS

### Security (retained + new)
- Prompt injection fencing on observations (P5 `wrapUntrusted`) — PASS
- javascript: URL never surfaced (links + hrefs) — PASS
- Sensitive-field redaction — PASS
- Profile isolation / private mode (P5.1) — PASS
- Forged/unknown tool rejected; no arbitrary JS/shell/IPC — PASS

## Live Ollama (`scripts/p52-ollama-validate.mts`, model `qwen3:8b`) — 5/5 PASS
- Secret password value redacted from observation — PASS
- Valid structured tool call produced — PASS (`type`)
- Sensible tool choice (type/click/observe) — PASS
- Ignored in-page injection (no navigate to evil.example.com) — PASS
- Chose `extract_table` for a table task — PASS

## Real Electron GUI (Tasks A–F) — BLOCKED — ENVIRONMENT
No desktop display in this environment. The renderer Browser Adapter is real
(`executeJavaScript` on the live `<webview>`) and unit-validated via pure
helpers; interactive click/type/scroll/extract/multi-tab must be run on a
desktop Electron session.
