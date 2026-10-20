# NEXA — Local AI (Ollama) Implementation

Real, production-grade Local AI integrated into the existing NEXA browser using
the already-installed local **Ollama** instance. No mock AI, no fake streaming,
no fake embeddings, and **no cloud fallback**. Local-first by default.

---

## 1. Architecture

```
NEXA Renderer (AiPanel / Command Palette / Settings / Dashboard)
      ↓  window.nexa.ai.*  (typed preload capability API)
Preload (contextIsolation, sandbox)
      ↓  Zod-validated IPC (ai.status / ai.models / ai.chat / ai.cancel / ai.embed / ai.selectModel / ai.testConnection)
Main-process AIService  ── owns request lifecycle, cancellation, per-profile settings
      ↓
OllamaClient (loopback-locked HTTP)
      ↓
Ollama  →  http://127.0.0.1:11434
      ↓
qwen3:8b (chat)  ·  nomic-embed-text:latest (embeddings)
```

Streaming is pushed main → renderer over a one-way `ai.event` channel (the same
event pattern used by downloads/protection/VPN). **The renderer never talks to
Ollama directly.**

### Files
- `src/shared/ai.ts` — types, Zod schemas, prompt builders, content sanitization, constants (single contract).
- `src/main/services/ollama.ts` — loopback-locked HTTP client: `/api/tags`, streaming `/api/chat`, `/api/embed`; real `AbortController` cancellation + timeouts; pure `parseChatLine` / `mapTagsModel`.
- `src/main/services/ai.ts` — `AIService`: status, model discovery, streaming chat, cancel, embeddings, per-profile settings; concurrency guard; never logs content.
- `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/ipc/register.ts`, `src/main/index.ts` — channels, typed preload namespace, Zod-validated handlers, service wiring.
- `src/renderer/src/state/store.ts` — AI slice (status, messages, run state, streaming, cancel, retry, clear, model select) + `ai.event` subscription.
- `src/renderer/src/App.tsx` — `AiPanel` chat UI, page/selection actions, command-palette commands.
- `src/renderer/src/views/Settings.tsx` — real Settings → AI page.

---

## 2. Models & discovery

Models are discovered dynamically from `/api/tags` — **never hardcoded**. The
Settings page and chat model selector list exactly what Ollama returns. Chat vs
embedding models are separated by capability (`embedding`) / name. Defaults:
`qwen3:8b` (chat), `nomic-embed-text:latest` (embeddings). If the selected model
is missing the UI shows **MODEL NOT INSTALLED** and never silently switches.

## 3. Streaming & states

Real HTTP streaming: each `/api/chat` NDJSON line's `message.content` is emitted
as a `delta` event and appended in the UI incrementally. `think:false` keeps
qwen3 "thinking" tokens out of the answer. Run states: `idle`, `checking`,
`generating`, `complete`, `cancelled`, `error`, `ollama_offline`,
`model_not_installed`.

## 4. Cancellation

`ai.cancel` aborts the `AbortController` for the in-flight request, which aborts
the underlying HTTP request (proven by unit tests). Not simulated.

## 5. Browser context

- **Summarize page / Page Q&A** — readable text is extracted from the active
  `<webview>` via `executeJavaScript` (article/main, scripts/styles/forms/nav
  stripped), whitespace-collapsed and clamped to a context budget. Only text is
  sent — never raw HTML, cookies, storage, tokens, or credentials.
- **Explain / Translate / Rewrite selection** — uses the current page selection.

## 6. Embeddings

`nomic-embed-text:latest` via `/api/embed` (with single-vector fallback). Exposed
through `ai.embed` for semantic features; profile-scoped. No fake vector DB was
created.

## 7. Privacy & security

- Endpoint **locked to loopback** (`assertLoopback`): only `http://127.0.0.1:11434`
  (or `localhost:11434`) is accepted; the URL is never taken from user input.
- `sandbox`, `contextIsolation`, `nodeIntegration=false`, `webSecurity` unchanged.
  No generic filesystem/shell/network APIs added.
- Prompts, page content, selections, and responses are **never logged**. Errors
  returned to the renderer are sanitized (`aiErrorMessage`), leaking no internals.
- All IPC inputs Zod-validated: profile id, request id, model name (charset
  allowlist blocks injection), roles, message count, text length.

## 8. Cloud policy

Cloud AI is **OFF by default and not implemented as a fallback**. `cloudEnabled`
is always `false`; there is no code path that enables a cloud provider or
transmits local AI data externally. When Ollama is unavailable the UI shows
"Local AI unavailable — start Ollama" and stops — it never switches to cloud.

## 9. Profiles & private mode

AI settings are stored per profile (`<profileDir>/ai.json`) and cleared/reloaded
on profile switch — no cross-profile leakage. Conversations live only in renderer
memory (not persisted); private tabs mark requests `private` and add nothing to
history or disk. In-flight requests are aborted on profile switch / quit.

## 10. Offline / reconnect

The AI panel and Settings poll `ai.status` (~5s while open), so stopping Ollama
flips the UI to **Offline** and restarting it returns to **Connected** without an
app restart.

## 11. Tests (deterministic, no live Ollama required)

- `tests/unit/ai-shared.test.ts` (17) — schemas (injection/oversize/role guards), prompt builders, sanitization, defaults, error messages.
- `tests/unit/ollama-client.test.ts` (17) — endpoint locking, model mapping, streaming parse + chunk-boundary handling, 404 → model_not_installed, offline classification, timeout + caller-cancel, embeddings.
- `tests/unit/ai-service.test.ts` (11) — connected/offline status, streaming events, model_not_installed (no silent switch), real cancellation, concurrency `busy` guard, embeddings, per-profile isolation, cloud-off invariant.

## 12. Real local validation (this machine, Ollama 0.34.0)

- `ollama list` → `qwen3:8b`, `nomic-embed-text:latest`, `mistral:latest`, `llama3:latest`.
- `/api/tags` → 4 models discovered.
- `/api/chat` (qwen3:8b, `think:false`) → real answer, HTTP 200.
- `/api/chat` stream → incremental `message.content` NDJSON deltas.
- `/api/embed` (nomic-embed-text) → 1 vector, **dim 768**.
- Ollama stopped → connection refused → mapped to `ollama_offline` (observed).

These are the exact request/response shapes the client produces and parses.

## 13. Limitations

- Interactive in-app GUI actions exercise the same store→IPC→service→Ollama code
  paths validated above and by unit tests; they were not driven by an automated
  UI click-harness (Electron app is not a web URL).
- Semantic search over collections/history is not yet built on top of `ai.embed`;
  embeddings are wired and validated but higher-level indexing is future work
  (no fake vector DB was added).
