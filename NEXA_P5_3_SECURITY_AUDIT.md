# NEXA P5.3 — Security Audit

Date: 2026-09-16. Scope: additive vision/multimodal layer.

## Forbidden-pattern scan

```
rg "child_process|execFile|execSync|spawn|shell:|osascript|powershell|eval(|
    new Function|writeFile|readFile|unlink|mkdir|mouseMove|mouseDown|
    keyboardPress|desktopClick|screenCoordinate"
  src/shared/vision.ts src/main/services/ai.ts src/main/services/ollama.ts
→ only pre-existing mkdirSync (settings dir in ai.ts, unrelated to vision)

rg "click_xy|screenCoordinateClick|clickAt|mouseClick"  src/
→ NONE (no coordinate-based click; no computer-control API)
```

`executeJavaScript` remains renderer-only with fixed, JSON-encoded scripts.
Screenshots use `toDataURL()` (memory-only) — there is no `toPNG`/`writeFile`
path, so screenshots are **never persisted, logged, or uploaded**.

## Anti-pattern checklist (§45)

```
[✓] no AIServiceV2 / AgentServiceV2 / OllamaClientV2 (existing client extended)
[✓] no generic computer-use API / desktop automation
[✓] no arbitrary coordinates as an execution primitive (fusion → eid only)
[✓] no generic IPC (ai.vision* are typed, Zod-validated AI-capability channels)
[✓] no cloud-only vision (local Ollama; honest NOT_CONFIGURED otherwise)
[✓] no persistent screenshots by default (memory-only toDataURL)
[✓] no fake vision capability (runtime /api/show detection)
[✓] no fake visual target IDs (visual_N fused to real element_N or NOT_FOUND)
[✓] no hardcoded model capability (detected at runtime, not assumed)
```

## Preserved boundaries (P5.1/P5.2, unchanged)

- `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`, `webSecurity=true`.
- Typed IPC + Zod validation + profile-id validation in main.
- `PermissionEngine` unchanged and authoritative; live origin, mode-aware.
- Navigation still http(s)-only; js/data/file blocked.
- Sensitive-field detection & redaction unchanged; secret typing → `ask` in every
  mode; credential automation `NOT CONFIGURED`.

## Vision-specific review

| Concern | Result |
|---------|--------|
| Screenshot may contain secrets | Never persisted/logged/uploaded; processed locally; memory-only; bounded dims |
| Visual prompt injection | `wrapUntrustedVisual` + `VISION_INJECTION_GUARD`; vision output also fenced by P5 `wrapUntrusted` (PAGE_DERIVED); tested |
| Visual text as authority | Never — decisions use resolved DOM origin/element, not the model's description |
| Coordinate control | Impossible — `locate_visual` fuses to an `eid`; action goes through existing click/type + PermissionEngine |
| Vision provider scope | Receives only the prepared image + prompt; no fs/shell/IPC/credentials/VPN/downloads access |
| Cost / runaway | Capability gate skips capture when no vision model; bounded timeouts; cancellable |
| Private mode / profile | Memory-only; `visionCapability` cleared on profile switch |

## Impossible through the agent (still holds)

```
AI → shell / OS commands / desktop control   ✗
AI → arbitrary filesystem / screenshot paths ✗
AI → arbitrary JS / eval                      ✗
AI → credentials / cookies / tokens           ✗
AI → coordinate-based clicking                ✗
AI → cloud vision without user config          ✗
AI → persisted screenshots                     ✗
```

## P4.2 VPN

Untouched. Native validation gate remains **BLOCKED — ENVIRONMENT**.
