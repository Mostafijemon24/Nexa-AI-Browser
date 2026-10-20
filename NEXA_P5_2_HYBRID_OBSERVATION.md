# NEXA P5.2 — Hybrid Observation Model

## Priority

Observation prefers **semantic evidence over pixels**:

```
Accessibility (role, aria-label, name, state)
   ↓
Semantic DOM (tag, label, placeholder, href, type)
   ↓
Readable content (P5 page-content.ts — article/main/headings)
   ↓
Visual (screenshot) — only when required AND a vision model is configured
```

Visual observation never overrides strong semantic evidence.

## Capture → normalize → redact (two stages)

1. **Renderer capture** (`OBSERVE_SRC`, fixed non-model script): collects visible
   interactive elements + landmarks + dialogs from the live `<webview>`. Assigns
   ephemeral `data-nx-eid="element_N"` in DOM order. Returns raw descriptors.
2. **Pure normalization** (`buildObservation`, `src/shared/observation.ts`):
   bounds to `OBS_MAX_ELEMENTS` (60), drops invisible elements, clamps strings,
   classifies sensitive fields, and produces `PageObservation`.

`formatObservation()` renders a compact, bounded (≤ 6 000 char) list for the
planner. All page-derived observations are then fenced with the P5
`wrapUntrusted()` / `INJECTION_GUARD` before reaching the model.

## Structured representation

```
PageObservation
├── url, title
├── structure { hasHeader/Nav/Main/Aside/Footer/Search, forms, tables, dialogs, landmarks[] }
├── dialogs[]          (role=dialog/alertdialog, <dialog open>)
├── elements[]         (element_N)
│     ├── id, tag, role, name (a11y-first)
│     ├── value        (OMITTED when secret)
│     ├── href (http/https only), type
│     ├── disabled, checked, selected, required
│     ├── secret       (credential-looking → value never included)
│     └── interactive
├── truncated, totalElements
```

## Sensitive-field redaction

`isSensitiveField()` flags `password`/`otp`/`totp`/`cvv`/`pin`/`card`/`ssn`/
`api-key`/`token`/`secret`/`credential` by field name, type, and `autocomplete`
(`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`).
For flagged fields the **value is dropped entirely** — only a `secret: true`
flag survives into the observation, the planner text, logs, and task history.
Secret typing remains `ASK` in every mode; credential automation stays
`NOT CONFIGURED`.

## Ephemeral element ids

- Assigned per-observation in stable DOM order (`element_1..N`).
- Valid only for the observation that produced them.
- Never a permanent DOM identifier; never trusted across navigation.
- A stale id → `resolveTarget` returns `NOT_FOUND` → recovery/re-observe.

## Target resolution states

`resolveTarget()` → `EXACT | STRONG | AMBIGUOUS | NOT_FOUND`. Ties return
`AMBIGUOUS` with candidates instead of guessing. `index` can disambiguate a tie
deterministically.

## Vision (honest)

`visionSupported(model)` matches known multimodal models (llava, llama3.2-vision,
qwen-vl, minicpm-v, pixtral, gemma3, internvl…). For text-only models (e.g.
`qwen3:8b`) `observe_visual` returns **`VISION NOT CONFIGURED`** — screenshots
are never sent to a text-only model pretending to interpret them. The
architecture is ready for future multimodal models.
