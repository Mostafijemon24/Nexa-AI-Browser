# NEXA P5.3 — Visual / Multimodal Hybrid Agent — FINAL

## P5.3 Status: READY WITH LIMITATIONS

The architecture and implementation are production-shaped and fully wired; the
only non-executable items are environment-dependent: no local multimodal model
is installed, and there is no desktop display for interactive Chromium capture.

```
Baseline tests (P5.2):     342
New P5.3 tests:            +27
Total tests:               369 / 369  PASS
Typecheck:                 PASS
Build:                     PASS
Lint:                      CLEAN
Ollama:                    capability detection + fusion VALIDATED (real code path)
Vision (live inference):   VISION_NOT_CONFIGURED (no multimodal model installed)
Security:                  PASS (no shell/fs/eval/coordinates/generic-IPC; screenshots memory-only)
GUI (Tasks A–F):           BLOCKED — ENVIRONMENT (no desktop display)
```

## Implemented

- Hybrid observation extended with a **vision layer** (DOM + A11y + readable +
  semantic + screenshot), DOM/A11y still preferred.
- **Runtime vision-capability detection** via `/api/show` (VISION_CAPABLE /
  TEXT_ONLY / UNAVAILABLE / ERROR) — never assumed.
- **Local-first vision** through the existing Ollama client (`show()` + `chat({images})`);
  no second runtime, no cloud fallback, no API keys.
- **Bounded, memory-only screenshot capture** (`capturePage → downscale → toDataURL`);
  never persisted, logged, or uploaded.
- New READ tools: `observe_visual`, `analyze_visual`, `locate_visual`.
- **Visual → DOM fusion**: vision suggestions resolve to real `element_N` eids
  (EXACT/STRONG/AMBIGUOUS/NOT_FOUND) — never coordinates.
- Untrusted-visual fence (`wrapUntrustedVisual` + `VISION_INJECTION_GUARD`) plus
  the existing P5 fence on planner-facing observations.
- Vision IPC (`ai.visionStatus`, `ai.visionAnalyze`) — typed, Zod-validated,
  reusing the existing bridge model (no competing `agent.*` execution path).
- UI vision chip (Available / Not configured / AI offline) + palette commands.
- Ask/Assist/Agent preserved; sensitive-field & permission model unchanged.

## Not Configured (honest)

- **Live multimodal inference** — no vision model installed (`qwen3:8b`, `mistral`,
  `llama3` are all TEXT_ONLY). `observe_visual`/`analyze_visual`/`locate_visual`
  honestly return `VISION_NOT_CONFIGURED`. Install e.g. `ollama pull llava` or
  `ollama pull llama3.2-vision` to enable.
- **full_page / region scopes** beyond viewport — accepted by schema; viewport
  capture is the implemented path.
- Deferred per §35 (later phases): Task Recorder, Workflow Compiler, Scheduler,
  MCP, external connectors, multi-agent, persistent memory, full visual agent,
  credential/payment automation, unrestricted JS, OS control.

## Environment Limitations

- **Live vision inference: BLOCKED — ENVIRONMENT** (no local multimodal model).
  The real `visionAnalyze` → Ollama `images` path is unit-validated with a fake
  vision model; capability detection + fusion are live-validated against Ollama.
- **Interactive Chromium GUI (Tasks A–F): BLOCKED — ENVIRONMENT** (no display).
  `<webview>.capturePage()` cannot run headlessly here.

## P4.2 Native VPN Gate

```
BLOCKED — ENVIRONMENT
```

Untouched. No VPN state machine, PROTECTED semantics, helper protocol/transport,
WireGuard, kill-switch, permissions, or native validation gate was modified.

## How to enable + validate vision on a desktop

```
ollama pull llama3.2-vision        # or: ollama pull llava
# NEXA → AI settings → select the vision model → Agent panel shows "● Vision available"
npx tsx scripts/p53-vision-validate.mts     # live capability + real image inference
npm run dev                                  # Agent: "Describe this page visually"
```
