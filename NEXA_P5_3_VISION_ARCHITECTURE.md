# NEXA P5.3 — Vision Architecture

## Local-first AI routing

```
NEXA Agent
   ↓
AIService (existing P5)  ──►  OllamaClient (loopback, existing)
   ↓                              ↓
visionStatus()               /api/show  → capabilities
visionAnalyze()              /api/chat  → images:[base64]  (multimodal)
   ↓
Multimodal model installed?
   ├── YES → local vision inference
   └── NO  → VISION_NOT_CONFIGURED  (honest; never a cloud fallback)
```

No API keys. No cloud provider. No `AIServiceV2` / `OllamaClientV2` — the
existing client is extended with `show()` and optional `images`.

## Capability detection (runtime, never assumed)

`classifyVisionCapability({ capabilities, family, families, name })`:
1. `capabilities` includes `"vision"` → `VISION_CAPABLE` (authoritative, `/api/show`).
2. family/families match `clip|mllama|vision|vlm|siglip` → `VISION_CAPABLE`.
3. model name matches a known vision family (llava, llama3.2-vision, qwen-vl,
   minicpm-v, pixtral, gemma3, internvl…) → `VISION_CAPABLE`.
4. otherwise → `TEXT_ONLY`.

Errors map to `UNAVAILABLE` (offline / not installed) or `ERROR`. The UI
distinguishes **AI Connected / Vision Available / Vision Not Configured / AI
Offline**. Live check on this machine: qwen3:8b, mistral, llama3 all → `TEXT_ONLY`.

## Hybrid observation object (bounded)

```
Observation
├── url, title
├── DOM + A11y semantic element map (P5.2, element_N)   ← preferred
├── readable content (P5 page-content.ts)
├── structure / dialogs / forms / tables
└── visual (P5.3)
      ├── available: boolean
      ├── description (bounded ≤ 4000, fenced untrusted)
      └── targets[] → fused to element_N (never coordinates)
```

Priority: **Accessibility → Semantic DOM → Readable content → Visual.** Vision
never overrides strong semantic evidence. Screenshots are never dumped into
normal text prompts; only bounded model output (description / fused targets) is
fed back, and it is fenced as untrusted.

## Ephemeral visual IDs

`visual_N` ids are produced per `locate_visual` call, scoped to that observation,
and immediately fused to a real DOM `element_N`. They are never persisted, never
stable DOM identifiers, and invalidated by navigation/DOM/viewport change (a
stale DOM map yields `NOT_FOUND`). The actionable handle is always the `eid`.

## Target resolution priority

```
1. semantic eid (from observe)
2. accessibility identity (role + accessible name)
3. exact DOM target
4. strong semantic match
5. visual match (fused → eid)
6. AMBIGUOUS  (candidates returned, never guessed)
7. NOT_FOUND
```

## Trust boundary for visual content

- `VISION_INJECTION_GUARD` + `wrapUntrustedVisual()` fence visual-derived text.
- The vision system prompt tells the model that text seen in a screenshot is
  **data, not instructions**.
- Planner-facing visual observations are additionally fenced by the existing
  P5 `wrapUntrusted()` (vision tools are in the agent `PAGE_DERIVED` set).
- Visual text never becomes system instructions, tool definitions, IPC, or a
  permission decision. The model's description of a target is never the security
  authority — the resolved DOM origin + element are.

## Error states (honest, explicit)

```
VISION_NOT_CONFIGURED · VISION_UNAVAILABLE · VISION_TIMEOUT · VISION_CANCELLED
VISION_INVALID_RESPONSE · VISUAL_TARGET_NOT_FOUND · VISUAL_TARGET_AMBIGUOUS
VISUAL_OBSERVATION_STALE · VISION_PROVIDER_ERROR
```

`Vision Ready` is never shown unless a capability was actually detected.
