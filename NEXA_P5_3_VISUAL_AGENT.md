# NEXA P5.3 — Visual / Multimodal Hybrid Agent (Implementation)

P5.3 is an **additive** layer on P5.1 + P5.2. It adds a screenshot/vision
observation layer to the existing hybrid engine **without** rebuilding the
Planner, `AgentService`, `PermissionEngine`, tool registry, IPC bridge, or the
Browser Adapter, and **without** a second AI runtime.

> DOM + A11y remain the preferred source of truth. Vision is an *additional*
> layer used only when deterministic observation is insufficient — and a visual
> target is ALWAYS fused back to a real DOM element before any action.

## 1. Pipeline (unchanged security spine)

```
User intent → Planner (P5 AIService/Ollama) → ONE JSON tool call
   → registry+Zod → PermissionEngine (LIVE origin, mode)
   → AgentToolHost (typed agent.* bridge) → renderer Browser Adapter
   → Chromium <webview> ──► DOM / A11y / readable / screenshot
   → Hybrid Observation → planner → verify / recover
```

The model still emits only a validated JSON tool call. It never gets coordinates,
shell, filesystem, arbitrary JS, or generic IPC.

## 2. New capabilities

### Vision provider (reuses Ollama — no new runtime)
- `OllamaClient.show()` — `/api/show` for authoritative model metadata.
- `OllamaClient.chat({ images })` — attaches base64 images to the user message.
- `AIService.visionStatus()` — runtime capability detection → `VISION_CAPABLE |
  TEXT_ONLY | UNAVAILABLE | ERROR` (never assumes vision just because Ollama runs).
- `AIService.visionAnalyze()` — verifies capability first, strips any data-uri
  prefix, runs locally, never logs/persists the image. Honest error mapping
  (`vision_not_configured` / `vision_unavailable` / `vision_cancelled` /
  `vision_timeout` / `vision_provider_error`).

### New agent tools (registry additions, all READ)
| Tool | Purpose |
|------|---------|
| `observe_visual` | Capture + describe main visual sections/controls (scope: viewport/full_page/region) |
| `analyze_visual` | Ask a vision model a question about the screenshot (charts/images/layout) |
| `locate_visual` | Use vision to find a described control, **fused to a real DOM `element_N`** |

### Vision IPC (AI capability, not an agent execution path)
- `ai.visionStatus`, `ai.visionAnalyze` — Zod-validated, bounded image size.
- Per spec §34 these are **not** competing `agent.*` execution channels; the
  agent tools still flow through the existing `agent.*` bridge, and the renderer
  executor uses `ai.vision*` purely for local inference.

## 3. Screenshot lifecycle (memory-only)

`captureScreenshot()` (renderer): `<webview>.capturePage()` → downscale to
`VISION_MAX_DIM` (1280 longest edge) via `boundImageDims` → `toDataURL()`.
- **No persistence** (no `toPNG`/`writeFile`), no cloud upload, no telemetry,
  no logging of bytes. The base64 lives only in-memory for one request.
- Respects active profile / private mode (memory-only, cleared on profile switch).

## 4. Adaptive observation (cost control)

The vision executors call `visionStatus` **first**. If the model is not
vision-capable, they return an honest `VISION_NOT_CONFIGURED` **without capturing
a screenshot** — no wasted capture/inference. DOM/A11y is always attempted first
by the planner; vision is a fallback for visually-structured/ambiguous pages.

## 5. Visual → DOM fusion (never coordinates)

`locate_visual`:
1. Capture screenshot → ask vision model for candidate targets (JSON labels/roles).
2. `parseVisionResponse` bounds/validates the response.
3. `fuseVisualTargets(suggestions, domElements)` resolves each suggestion against
   the deterministic DOM element map via `resolveTarget` → returns an actionable
   `element_N` **eid** (or `AMBIGUOUS` / `NOT_FOUND` — never a guess).
4. The model then acts via the existing `click`/`type` tools by `eid` → through
   the PermissionEngine → Chromium. **No `click(x,y)` tool exists.**

## 6. UI

- Agent panel header shows an honest vision chip: **● Vision available** /
  **○ Vision not configured** / **○ AI offline**.
- Command palette (state-aware): "Describe Page Visually", "Find Control Visually".

## 7. Files touched (additive)

- `src/shared/vision.ts` **(new, pure)** — capability classification, response
  parsing, image bounds, untrusted-visual fence, visual→DOM fusion.
- `src/main/services/ollama.ts` — `show()` + optional `images` on `chat()`.
- `src/main/services/ai.ts` — `visionStatus()` + `visionAnalyze()`.
- `src/shared/ai.ts` — vision IPC schemas + bounds.
- `channels.ts` / `preload` / `register.ts` / `nexa.d.ts` — `ai.visionStatus`, `ai.visionAnalyze`.
- `src/shared/agent.ts` — `observe_visual` upgrade + `analyze_visual` + `locate_visual`.
- `src/renderer/src/App.tsx` — capture + vision executors + fusion + vision chip.
- `src/renderer/src/state/store.ts` — `visionCapability` + `loadVisionStatus`.
