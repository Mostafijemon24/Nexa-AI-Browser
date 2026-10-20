# NEXA STEP 12 — Multi-Provider AI Security Audit

Scope: the provider-agnostic AI platform added in STEP 12 (provider/model
registry, routing, secure key storage, cloud adapters, IPC, UI). Preserves all
P0–P11 security invariants; additive only.

## 1. Secret handling

- **Cloud API keys live ONLY in OS `safeStorage`** (`SecureStorage`, the same
  primitive that already backs VPN + Drive), keyed `ai.key.<provider>`, file
  mode `0600`. They are **never** written to profile JSON, never returned to the
  renderer, never logged, never placed in prompts/observations.
- The renderer's only interaction with a key is a **one-way, write-only**
  invocation: `ai.provider.configure { apiKey }`. The main process consumes it,
  stores it, and returns only `{ configured, health }`. The Settings input is
  `type="password"`, `autoComplete="off"`, and is **cleared after submission**
  (`setKeyDraft(… '')`, comment "never retained").
- Guards: `theme-tokens.test.ts` verifies the store never writes `apiKey` into
  state, no `localStorage/sessionStorage`, no `getApiKey/revealKey` preload
  helper; `ai-provider-runtime.test.ts` asserts a key never appears in provider
  metadata JSON or returned chat text; security grep finds no secret logging.

## 2. Provider trust boundaries

- **The model never chooses the provider.** Routing is deterministic
  (`routeAIRequest`) in the main process, driven by required capability →
  privacy mode → profile config → provider health → model capability.
- The model/provider never gains authority. Agent still flows
  `AgentService → AIService → router`; `PermissionEngine`/`AgentToolHost`
  unchanged. No `AgentOpenAIProvider`/alternate engines.

## 3. Cloud data flow

- Cloud is **opt-in**: a cloud provider is `NOT_CONFIGURED` until the user adds a
  key, and is only *routed to* when `privacyMode` **and** `fallback` explicitly
  allow it. Default profile config is `local_only` + `local_only` fallback.
- Endpoints are **locked** to known HTTPS hosts (`assertKnownHost`): OpenAI
  `https://api.openai.com`, Anthropic `https://api.anthropic.com`. No arbitrary
  URLs, no `ai.fetch(url)`, no generic proxy channel. All cloud traffic
  originates in the **main process**, never the renderer.

## 4. Local data flow

- Ollama remains loopback-locked (`assertLoopback`, `127.0.0.1:11434`) and is the
  default. The existing local streaming/cancellation path is unchanged; the
  registry wraps the **same** `OllamaClient` (no second runtime).

## 5. Private-mode guarantees

- Private mode adds no persistence. Under `local_only` (and by default), private
  page context can never escalate to the cloud. A local failure returns
  `PROVIDER_OFFLINE` ("AI unavailable offline") — it **never** silently uploads
  content to a cloud provider (`routeAIRequest` + `fallback` gating; covered by
  routing tests).

## 6. Profile isolation

- AI config is per profile (`<profileDir>/ai-config.json`), validated on read via
  `normalizeProfileAIConfig` (untrusted input). Switching profiles reloads
  provider/config state and clears the previous (`aiProviders`/`aiConfig` reset).
- Keys are account-level secrets in `SecureStorage` (not per-profile files); a
  profile only stores the non-secret *selection* of a provider.

## 7. IPC boundaries

- New channels are **capability-specific + Zod-validated + main-authorized**:
  `ai.providers`, `ai.provider.configure|remove|test`, `ai.config.get|update`.
  No `ai.execute`, `provider.execute`, `http.request`, `shell`, or `filesystem`
  bridges (guarded in tests). Renderer receives `AIProviderInfo` metadata only.

## 8. Prompt-injection defense

- `wrapUntrusted()` + `INJECTION_GUARD` remain the message-construction contract
  for **all** providers (the shared `buildActionMessages`/`pageContextSystemMessage`
  are provider-agnostic). Cloud adapters receive the identical guarded messages;
  page/DOM/OCR/PDF/model output are never treated as authorization.

## 9. Network restrictions

- HTTPS-only, known-host-only, main-process-only. Cloud health checks are lazy,
  cached (15 s), cancellable (AbortController + timeout). No cloud SDKs are
  loaded; adapters are lightweight `fetch` clients. Offline cloud health is
  reported as `NETWORK_OFFLINE` (no retry storms).

## 10. Logging restrictions

- No prompts, page content, images, keys, or `Authorization` headers are logged
  (grep-verified). Safe metadata only (providerId/modelId/operation/health).

## 11. Agent / Worker / Vision / Embedding security

- **Agent**: unchanged authority model; plans via `AIService.complete` →
  router. High-risk side effects still require NEXA authorization.
- **Worker**: same routing; confirm-to-submit workflow intact — AI never
  auto-submits forms (dashboard + worker guards).
- **Vision**: gated by honest capability detection; `config.vision:'off'` or an
  incapable model → not used. Screenshots are never silently sent to the cloud;
  cloud vision requires a vision-capable configured model + permissive privacy.
- **Embeddings**: local `nomic-embed-text` by default. Cloud embeddings require
  an explicitly selected, configured cloud `embedProviderId`; never uploaded by
  default (`AIService.embed` gate).

## 12. Fallback privacy rules

- `none`: primary only. `local_only`: only local fallbacks. `configured_provider`:
  local first, then configured cloud — and even then only if `privacyMode`
  permits cloud. There is no code path where a local failure alone sends private
  content to the cloud.

## 13. Error model

- Normalized, non-leaking codes (`PROVIDER_NOT_CONFIGURED`, `AUTHENTICATION_FAILED`,
  `RATE_LIMITED`, `CAPABILITY_UNAVAILABLE`, `PRIVACY_BLOCKED`, …). Messages never
  contain keys, paths, stack traces, or payloads (`aiProviderErrorMessage`).

## Residual notes

- With no cloud keys configured (default + this environment), OpenAI/Anthropic
  are `NOT_CONFIGURED` — a valid, honest state.
- Cost metadata is informational only (no billing/telemetry); prices are the
  provider-published values and are omitted when unknown.
