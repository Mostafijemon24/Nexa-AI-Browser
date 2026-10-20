# NEXA P5.3 — Test Matrix

Date: 2026-09-16. Suite total: **369 / 369 PASS** (342 P5.2 baseline + 27 new).
Typecheck PASS · Build PASS · Lint CLEAN.

New / extended test files:
- `tests/unit/vision.test.ts` (17)
- `tests/unit/ai-vision.test.ts` (6)
- `tests/unit/agent-p52-tools.test.ts` (+4 vision-tool cases)

## Coverage

### Capability detection (`vision.test.ts`, `ai-vision.test.ts`)
- VISION_CAPABLE from capability list / vision families / model name — PASS
- TEXT_ONLY for text-only model even when Ollama runs — PASS
- `visionStatus`: TEXT_ONLY / VISION_CAPABLE / UNAVAILABLE (offline) — PASS

### Screenshot / image bounds
- `boundImageDims` downscales longest edge, preserves aspect, never upscales — PASS
- (renderer capture is memory-only `toDataURL`; live capture = GUI, env-limited)

### Visual observation
- `parseVisionResponse`: plain text, structured JSON targets — PASS
- invalid / empty / oversized payload → VISION_INVALID_RESPONSE — PASS

### Target resolution & fusion
- EXACT (vision suggestion → real eid) — PASS
- AMBIGUOUS (multiple identical → candidates, no guess) — PASS
- NOT_FOUND (control not in DOM) — PASS
- stale/empty DOM map → NOT_FOUND — PASS
- fused target carries an eid and **no x/y coordinate** — PASS

### Hybrid fusion / DOM-preferred
- vision suggestion always resolved against the deterministic DOM element map — PASS
- no coordinate-based click tool exists in the registry — PASS

### Vision inference (`ai-vision.test.ts`)
- text-only model → `vision_not_configured` **without sending an image** — PASS
- vision model → analyzes image; data-uri prefix stripped to raw base64 — PASS
- cancellation → `vision_cancelled`; timeout → `vision_timeout` — PASS

### Security
- `wrapUntrustedVisual` neutralizes visual + page marker spoofing — PASS
- vision tools are in the agent PAGE_DERIVED fence set — PASS (code)
- no coordinate/computer-control tool — PASS
- (P5.1/P5.2 retained) injection, sensitive-field redaction, profile/private — PASS

### Modes / permission
- observe_visual / analyze_visual / locate_visual are READ → allow in Ask/Assist/Agent — PASS
- schemas strict (scope enum, required question/description) — PASS

## Live Ollama (`scripts/p53-vision-validate.mts`)
```
Installed: qwen3:8b, nomic-embed-text, mistral, llama3  → all TEXT_ONLY (honest)
PASS  qwen3:8b reports TEXT_ONLY (no fake vision)
PASS  vision suggestion fuses to a real DOM eid (element_1), no coordinates
PASS  fused target carries no coordinate primitive
INFO  No multimodal model installed → VISION_NOT_CONFIGURED (honest)
```

## Environment-limited (honest)
- **Live multimodal image inference: BLOCKED — ENVIRONMENT** — no vision model
  installed locally. The real code path (`visionAnalyze` + Ollama `images`) is
  exercised by unit tests with a fake vision model; a real run requires e.g.
  `ollama pull llava` / `llama3.2-vision`.
- **Interactive Chromium GUI (Tasks A–F): BLOCKED — ENVIRONMENT** — no desktop
  display; `capturePage()` on a live `<webview>` cannot run headlessly.
