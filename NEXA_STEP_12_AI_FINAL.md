# NEXA STEP 12 — Multi-Provider AI Architecture · Final Report

Local-first. Privacy-first. Provider-agnostic. Additive to P0–P11. No rewrite.

## Architecture

```
UI / Agent / Worker  →  AIService  →  AIProviderRegistry  →  routeAIRequest (pure)
                                                              ↓
                                            ┌───────── Ollama (LOCAL, default) ─────────┐
                                            │           OpenAI (CLOUD, opt-in)          │
                                            └───────── Anthropic (CLOUD, opt-in) ───────┘
```

- **`src/shared/ai-providers.ts`** — pure core: provider/model registry,
  capability model (honest `supported|unsupported|unknown`), health states,
  privacy modes, fallback policy, `ProfileAIConfig` (+ validation), normalized
  error model, cost model, **deterministic router**, context budgeting, IPC Zod
  schemas, locked-host assertion. No I/O, no Electron, no secrets.
- **`src/main/services/ai-provider-adapters.ts`** — internal `AIProviderAdapter`
  contract + `OllamaProviderAdapter` (wraps the existing `OllamaClient`, no 2nd
  runtime), `OpenAIProviderAdapter`, `AnthropicProviderAdapter` (lightweight
  HTTPS + SSE streaming, host-locked, key per-call/never stored).
- **`src/main/services/ai-registry.ts`** — `AIProviderRegistry`: profile config
  (on disk, non-secret), keys (SecureStorage only), health/model cache, provider
  metadata, deterministic `route()`.
- **`src/main/services/ai.ts`** — `AIService` gains an optional registry;
  `chat`/`complete`/`embed` route through it. **No registry ⇒ original local-only
  behavior** (backward-compatible; existing tests unchanged).

## Providers

- **Ollama** — LOCAL, default, loopback-locked. Existing functionality intact.
- **OpenAI** — CLOUD, optional, disabled until a key is configured.
- **Anthropic** — CLOUD, optional, disabled until a key is configured.
- New providers require only a new adapter + catalog entry — no consumer changes.

## Models

- Ollama models are discovered live and capability-detected from `/api/show`.
- Cloud models use a curated catalog with published capabilities + pricing
  (`gpt-4o`, `gpt-4o-mini`, `text-embedding-3-small`, `claude-3-5-sonnet/haiku`).
  Capabilities are never invented; unknown → `unknown`.

## Routing

Deterministic (`routeAIRequest`): required capability → privacy → profile config
→ provider health → model capability → provider. Local-first; the model never
selects the provider. Returns a normalized error when no eligible provider.

## Privacy

`local_only` (default) / `local_preferred` / `cloud_allowed`. Cloud is reachable
only when privacy **and** fallback explicitly allow it. Local failure never
silently escalates to cloud.

## Secrets

Cloud keys in OS `safeStorage` only (`ai.key.<provider>`). Never in profile JSON,
renderer state, logs, prompts, or errors. Renderer sees `AIProviderInfo` only.
Key input is password-style and cleared after submit.

## Streaming / Cancellation

Preserved via the existing `ai.event` channel (`start/delta/done/cancelled/
error`). Cloud adapters stream via SSE. All ops use `AbortController` + timeout;
cancellation propagates renderer → service → adapter → network.

## Context Management

`planContextBudget` reserves output tokens, preserves high-priority sources, and
truncates/reports the rest against the model context window (+ optional user
`contextLimit`). Builds on the existing `clampContext`/`wrapUntrusted`.

## Agent / Worker / Vision / Embeddings

- **Agent** — `AgentService → AIService.complete → router`; authority unchanged.
- **Worker** — same routing; confirm-to-submit intact; never auto-submits.
- **Vision** — capability-gated; `vision:'off'` or incapable model → not used;
  screenshots never silently sent to cloud.
- **Embeddings** — local `nomic-embed-text` by default; cloud only when an
  explicit configured cloud embedding provider is selected.

## Settings / Dashboard / Command Palette / Click-to-Go

- **Settings → AI**: provider cards (health without color-only cues), password
  key entry + Save&Test/Remove, and Active-provider / Privacy / Fallback / Vision
  selectors.
- **Dashboard AI widget**: shows the active provider + model + honest health.
- **Palette**: AI: Choose Provider / Choose Model / Test Provider / AI Settings /
  Use Local AI / Enable Cloud AI.
- **Click-to-Go**: `ai`, `ai settings`, `ai models`, `ollama`, `local ai`,
  `cloud ai` open AI settings (deterministic; never executes a provider action).

## Tests

`npm test` → **39 files / 682 tests passing**. New: `ai-providers.test.ts` (27),
`ai-provider-runtime.test.ts` (13, incl. end-to-end wiring + secret isolation),
plus 8 STEP 12 source-guards appended to `theme-tokens.test.ts`.

## Typecheck

`npm run typecheck` → passing.

## Build

`npm run build` → passing.

## Lint

`NOT_CONFIGURED` — the repo's lint script is still a placeholder; not claimed.

## GUI

`NOT_CONFIGURED — ENVIRONMENT` (headless). No visual validation performed.

## Known Limitations

- Live Ollama not running in this environment (`NOT_CONFIGURED — ENVIRONMENT`);
  the new provider→Ollama path is proven end-to-end with a simulated loopback
  transport (`ai-provider-runtime.test.ts`).
- Cloud providers are `NOT_CONFIGURED` without credentials (valid state).
- Cloud model catalog is curated (not fetched); pricing omitted when unknown.
- Cloud embeddings/vision are wired but exercised only via unit tests (no live
  cloud credentials).
