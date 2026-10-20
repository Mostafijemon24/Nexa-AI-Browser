# NEXA STEP 12 — Current AI Architecture Audit

*Source-of-truth audit of the existing AI implementation, performed before any
STEP 12 change. Repository code is authoritative.*

## 1. Files & responsibilities

| File | Role |
|------|------|
| `src/shared/ai.ts` | Shared contract: endpoint constants, limits, `AiMessage`/`AiModel`/`AiStatus`/`AiSettings`/`AiStreamEvent`, Zod schemas, `clampContext`, `buildActionMessages`, `pageContextSystemMessage`, `aiErrorMessage`. Local-only by design (`cloudEnabled: false`). |
| `src/main/services/ollama.ts` | `OllamaClient` — dependency-free HTTP client **locked to loopback** (`assertLoopback`). `listModels` (`/api/tags`), `show` (`/api/show`, capabilities), `chat` (`/api/chat`, NDJSON stream, real abort), `embed` (`/api/embed`), `ping`. Pure `parseChatLine`/`mapTagsModel`. |
| `src/main/services/ai.ts` | `AIService` — wraps one `OllamaClient`; owns request lifecycle + cancellation (`Map<requestId, {profileId, controller}>`), profile-scoped settings (`<profileDir>/ai.json`), `status`, `models`, `testConnection`, `chat` (streaming via `emit`), `complete` (non-stream, for Agent), `visionStatus`, `visionAnalyze`, `embed`, `cancel`, `dispose`. Never logs prompts/responses/images. |
| `src/main/services/agent.ts` | `createAIPlanner(ai)` → `Planner.plan = ai.complete(...)`. Agent plans via AIService; NEXA authorizes; renderer tool host acts. |
| `src/main/ipc/register.ts` | AI IPC handlers (`ai.status/models/testConnection/getSettings/selectModel/chat/cancel/embed/visionStatus/visionAnalyze`), all Zod-validated, active-profile-scoped. |
| `src/preload/index.ts` | `nexa.ai` bridge (invoke wrappers + `onEvent`). |
| `src/renderer/src/state/store.ts` | Renderer AI state (`aiStatus`, `aiMessages`, `aiRun`, vision, agent, worker) + actions; consumes `nexa.ai.*`. |
| `src/renderer/src/views/Settings.tsx` | AI settings section (model pickers, connection test). |
| `src/renderer/src/views/NewTab.tsx` | STEP 11 AI dashboard widget consuming `aiStatus`. |

## 2. Call paths (all AI flows today)

- **Ask / Page Q&A / Summarize / Explain / Translate / Rewrite** → renderer builds messages (`buildActionMessages` / `pageContextSystemMessage`) → `nexa.ai.chat` → `AIService.chat` → `OllamaClient.chat` (stream) → `ai.event` deltas.
- **Agent (P5.1/5.2/5.3)** → `AgentService` → `createAIPlanner(ai).plan` → `AIService.complete` → `OllamaClient.chat` (accumulated).
- **Worker (P6)** → renderer worker flow → `nexa.ai.chat` / `complete` for suggestions (confirm-gated fill; never auto-submit).
- **Vision (P5.3)** → `nexa.ai.visionStatus` / `visionAnalyze` → `AIService.visionAnalyze` → `OllamaClient.chat` with `images:[…]`. Honest capability via `/api/show` + `classifyVisionCapability`.
- **Embeddings** → `nexa.ai.embed` → `AIService.embed` → `OllamaClient.embed` (`nomic-embed-text`).

## 3. Direct Ollama dependencies

- Only `AIService` and `agent.ts`'s planner reference the Ollama path, and both go **through `AIService`**. The renderer never talks to Ollama directly. `OllamaClient` is the sole runtime client. Endpoint is hard-locked to `http://127.0.0.1:11434` (`assertLoopback`).

## 4. Streaming & cancellation

- Streaming: `OllamaClient.chat` reads the NDJSON body incrementally, calling `onDelta`; `AIService.chat` maps to `AiStreamEvent` (`start`/`delta`/`done`/`cancelled`/`error`) over `ai.event`.
- Cancellation: `AbortController` per request in `AIService`; `cancel(profileId, requestId)` aborts; `OllamaClient.withTimeout` merges an external signal with a timeout and aborts the real HTTP request. `dispose()` aborts all (shutdown/profile switch).

## 5. Credential / key paths

- **No AI credentials exist today** (local-only). `SecureStorage` (OS `safeStorage`, `userData/secure/secrets.bin.json`, mode `0600`) already backs **VPN** and **Drive** secrets and will be reused for cloud AI keys. `AiSettings.cloudEnabled` is the literal `false`.

## 6. Existing tests

- `tests/unit/ai-service.test.ts` — status/models/chat(stream)/embed/cancel via a fake `OllamaClient` (constructor `new AIService(persist, emit, { client })`).
- `tests/unit/ai-vision.test.ts` — vision capability + analyze.
- Additional shared-contract coverage in agent/worker/vision/page-content tests.

## 7. Constraints STEP 12 must preserve

1. `AIService` constructor signature `(persist, emit, { client })` and all existing method behaviors (backward-compatible; tests must stay green).
2. `AiStatus` remains the **local Ollama** status (`cloudEnabled: false`, `processing: 'local-only'`).
3. Renderer never receives secrets; IPC stays typed + Zod + capability-specific.
4. `wrapUntrusted` / `INJECTION_GUARD` remain the contract for page content to **every** provider.
5. Loopback lock for Ollama; known-host lock for any cloud endpoint.
6. Private-mode + profile isolation guarantees intact.

## 8. STEP 12 strategy (additive)

- New **pure shared core** `src/shared/ai-providers.ts`: provider ids/types, `AICapabilities`, normalized `AIModelInfo`, health states, non-secret `AIProviderInfo`, `AIPrivacyMode`, `AIFallbackPolicy`, `ProfileAIConfig` (+defaults + validation), normalized error codes, cost metadata, capability detection, **deterministic router**, and context budgeting.
- New **main providers**: internal `AIProvider` interface + `OllamaProvider` (wraps existing `OllamaClient`, no 2nd runtime) + `OpenAIProvider` + `AnthropicProvider` (lightweight HTTPS, disabled until configured, known-host locked).
- New **registry/config**: `ProviderRegistry` + profile AI config (non-secret in profile dir) + API keys in `SecureStorage` (`ai.key.<provider>`), integrated into `AIService` additively.
- New **capability-specific IPC**: `ai.providers`, `ai.provider.configure/remove/test`, `ai.config.get/update`, `ai.models` (all-provider). Renderer sees metadata only.
- **UI**: extend Settings AI section (provider cards + config), Dashboard widget, palette commands.
- **Docs + tests** per the STEP 12 brief.
