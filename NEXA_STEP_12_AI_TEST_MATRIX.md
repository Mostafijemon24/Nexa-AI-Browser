# NEXA STEP 12 — AI Test Matrix

Automated results: **`npm test` → 39 files, 682 tests passing**; `npm run
typecheck` passing; `npm run build` passing. Lint: **NOT_CONFIGURED** (no real
lint script). GUI: **NOT_CONFIGURED — ENVIRONMENT** (headless). Live Ollama:
**NOT_CONFIGURED — ENVIRONMENT** (runtime not running on 127.0.0.1:11434); the
new provider→Ollama path is proven end-to-end via a simulated loopback transport.

| Area | Scenario | Expected | Actual | Status | Env |
|------|----------|----------|--------|--------|-----|
| Provider registry | known ids/types/hosts | 3 providers, locked hosts | matches | PASS | unit |
| Provider registry | `assertKnownHost` rejects other hosts/protocol | throws `invalid_endpoint` | matches | PASS | unit |
| Model registry | Ollama `/api/show` capability mapping (honest 'unknown') | no false positives | matches | PASS | unit |
| Model registry | cloud catalog capabilities + defaults | curated metadata | matches | PASS | unit |
| Config | default = local-only Ollama | as spec | matches | PASS | unit |
| Config | normalize untrusted persisted config | safe defaults / drop bad | matches | PASS | unit |
| Config | malformed model ref rejected | `model` undefined | matches | PASS | unit |
| Routing | local-first default | → ollama/qwen3 | matches | PASS | unit |
| Routing | local_only + no local fallback + cloud primary | PRIVACY_BLOCKED | matches | PASS | unit |
| Routing | local_only with local available | → local (never cloud) | matches | PASS | unit |
| Routing | local down under local_only | PROVIDER_OFFLINE (no cloud) | matches | PASS | unit |
| Routing | cloud_allowed + configured cloud | → cloud primary | matches | PASS | unit |
| Routing | local_preferred + configured_provider fallback | local up→local, down→cloud | matches | PASS | unit |
| Routing | local_preferred + local_only fallback, local down | PROVIDER_OFFLINE | matches | PASS | unit |
| Routing | unconfigured cloud primary | PROVIDER_NOT_CONFIGURED | matches | PASS | unit |
| Routing | capability mismatch (vision on text model) | CAPABILITY_UNAVAILABLE | matches | PASS | unit |
| Routing | embeddings → embedding-capable model | nomic-embed-text | matches | PASS | unit |
| Errors | HTTP status → safe code | 401→AUTH, 429→RATE, 5xx→OFFLINE | matches | PASS | unit |
| Errors | messages leak no secrets/paths | clean | matches | PASS | unit |
| Context | token estimate deterministic | ~chars/4 | matches | PASS | unit |
| Context | high-priority preserved, rest truncated | truncatedAny + budget respected | matches | PASS | unit |
| Context | tighter user contextLimit honored | budget < limit | matches | PASS | unit |
| Cost | local = Free; cloud estimated only if known; never invented | as spec | matches | PASS | unit |
| OpenAI adapter | no key → NOT_CONFIGURED, no network | no fetch call | matches | PASS | unit |
| OpenAI adapter | health 200/401 → CONNECTED/AUTH_ERROR | matches | matches | PASS | unit |
| OpenAI adapter | SSE stream deltas; key only in Authorization header | "Hello"; no key in text | matches | PASS | unit |
| OpenAI adapter | embeddings via /v1/embeddings | vectors | matches | PASS | unit |
| Anthropic adapter | content_block_delta streaming; x-api-key header | "Hi there" | matches | PASS | unit |
| Error mapping | ollama/cloud → normalized code | OFFLINE/CANCELLED/NOT_FOUND | matches | PASS | unit |
| Secrets | cloud key stored in SecureStorage only | not in config JSON | matches | PASS | unit |
| Secrets | isConfigured: local true, cloud only w/ key | matches | matches | PASS | unit |
| Secrets | reject key for local provider | throws | matches | PASS | unit |
| Secrets | provider metadata to renderer has no key | no `sk-…`, no apiKey field | matches | PASS | unit |
| Registry | getConfig defaults; updateConfig normalizes | safe | matches | PASS | unit |
| Registry | route respects local-only (cloud primary blocked) | not ok | matches | PASS | unit |
| Streaming (existing) | start/delta/done/cancel via AIService | preserved | matches | PASS | unit |
| End-to-end | consumer→AIService→registry→router→Ollama adapter→client | 'done' with content | matches | PASS | unit (simulated loopback) |
| Source guards | core is pure (no electron/ipc/fetch/secrets) | none present | matches | PASS | unit |
| Source guards | cloud endpoints locked; no generic bridges | assertKnownHost used | matches | PASS | unit |
| Source guards | no ai.execute/provider.execute/http.request channels | none | matches | PASS | unit |
| Source guards | keys never in renderer/localStorage/config JSON | none | matches | PASS | unit |
| Source guards | untrusted-content contract preserved (wrapUntrusted/GUARD) | present | matches | PASS | unit |
| Source guards | routing done in service, not model | present | matches | PASS | unit |
| Live Ollama | reachable + qwen3:8b completion via new path | proven via new abstraction | NOT_CONFIGURED | ENV (runtime down) |
| Cloud (OpenAI/Anthropic) | without creds → NOT_CONFIGURED | valid state | matches | PASS | ENV |
| GUI | resolutions/light/dark/keyboard/panels | — | NOT_CONFIGURED | ENV (headless) |

## Commands

```bash
npm test        # 682 passed
npm run typecheck  # passed
npm run build      # passed
npm run lint       # NOT_CONFIGURED (placeholder)
```
