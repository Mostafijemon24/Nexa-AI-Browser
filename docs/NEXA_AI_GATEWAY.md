# NEXA AI Gateway

```
Electron main ──HTTPS──▶ NEXA AI Gateway ──▶ device auth ──▶ rate limits / daily quota
                                         ──▶ model router ──▶ OpenRouter adapter ──▶ free / premium models
```

The renderer never talks to the gateway; it calls `window.nexa.ai.*` (IPC) and
the Electron main process (`src/main/services/ai-gateway-client.ts`) talks to
the gateway. No OpenRouter credential exists anywhere in the app.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/ai/health` | – | Liveness / configured (no secrets) |
| POST / DELETE | `/api/auth/device` | – / Bearer | Register an installation / revoke its token |
| POST | `/api/ai/chat` | Bearer | Non-streaming completion |
| POST | `/api/ai/stream` | Bearer | SSE: `start`, `delta`, `done`, `error` |
| GET | `/api/ai/models` | Bearer | Server-controlled FREE / PREMIUM lists |
| GET | `/api/ai/usage` | Bearer | Today's usage and limits |
| GET | `/api/ai/providers` | Bearer | Connection metadata only |
| PUT / DELETE | `/api/ai/providers/openrouter` | Bearer | Connect (validate + encrypt) / disconnect BYOK |

Errors are `{"error":{"code","message","retryAfterSeconds?"}}` with codes from
`src/shared/ai-gateway.ts` (`AUTH_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`,
`QUOTA_EXCEEDED`, `INVALID_REQUEST`, `MODEL_UNAVAILABLE`, `PROVIDER_ERROR`,
`PROVIDER_TIMEOUT`, `AI_SERVICE_UNAVAILABLE`, …).

## Run locally

```sh
cp server/.env.example server/.env   # fill OPENROUTER_API_KEY and AI_ENCRYPTION_KEY
npm run server:dev                   # http://127.0.0.1:8787 (dev builds of the app use this)
npm run dev
```

## Deploy

```sh
mkdir -p deploy/secrets && chmod 700 deploy/secrets
printf '%s' '<OpenRouter key>' > deploy/secrets/openrouter_api_key
openssl rand -hex 32 | tr -d '\n' > deploy/secrets/ai_encryption_key
NEXA_AI_DOMAIN=ai.example.com docker compose -f deploy/docker-compose.yml up -d --build
curl https://ai.example.com/api/ai/health
```

Then build the desktop app against it:

```sh
MAIN_VITE_NEXA_AI_GATEWAY_URL=https://ai.example.com npm run package:mac
```

Without Docker: `npm run server:build`, then `deploy/nexa-ai-gateway.service`
(systemd) behind `deploy/Caddyfile` or any TLS proxy that sets
`X-Forwarded-For` / `X-Forwarded-Proto`.

## Operational notes

- Back up `AI_ENCRYPTION_KEY` separately from the database. Losing it makes stored BYOK keys unrecoverable (users reconnect); rotating it requires users to reconnect.
- Free AI is bounded per device (`AI_FREE_REQUESTS_PER_DAY`), per client IP across all devices (`AI_FREE_REQUESTS_PER_IP_PER_DAY`) and globally (`AI_FREE_REQUESTS_GLOBAL_PER_DAY`, default 1000 — match it to your OpenRouter account's free-model allowance). Free mode only reaches models whose every price component is zero.
- Per-minute limits and the concurrency cap are in-memory **per instance**; daily quotas are persistent. Run one instance per database, or put a shared limiter in front for horizontal scaling.
- The audit log stores event metadata only (no prompts, responses or keys) and is pruned after `AI_AUDIT_RETENTION_DAYS`. Client IPs are stored only as keyed hashes.
