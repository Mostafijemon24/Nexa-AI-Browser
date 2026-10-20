# NEXA P3 — Security & Privacy Notes

## Process model (unchanged from P0/P1/P2)
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` — preserved. P3 adds no `BrowserWindow`/webview options.
- All protection logic lives in the **main process**. The renderer never evaluates rules and never makes ALLOW/BLOCK decisions.

## IPC surface (capability-specific, validated)
Channels: `protection.getState / getStats / getSettings / saveSettings / setEnabled / getSiteState / setSiteEnabled / addAllow / removeAllow / addBlock / removeBlock / getRules / resetStats` + one-way `protection.event`.

- No generic `execute/eval/readFile/writeFile/shell`.
- Every handler validates its payload with Zod (`protProfileSchema`, `protStatsSchema`, `protSiteQuerySchema`, `protSetEnabledSchema`, `protDomainSchema`, `protSiteEnabledSchema`, `protectionSettingsSchema`).
- **Profile IDs are re-validated in the main process** via `assertSafeProfileId` on every entry point (rejects traversal like `../../etc`). Renderer-supplied IDs are never trusted.
- User-supplied domains pass through `cleanDomain` (strips scheme/path/port/`*.`, enforces a hostname pattern, 255-char cap). Invalid input → `invalid_domain` error, never a wildcard/global change.

## Privacy: what is and isn't stored
- **Statistics are in-memory only.** Counters (requests/blocked/allowed/by-category) and per-top-domain counts live in `ProtectionService` maps and are **never written to disk**. They reset on restart.
- **Recent activity** is a capped ring (≤100) of **blocked** events only, and each stored URL is redacted to `scheme://host/path` via `redactRequestUrl` — query strings (tokens, signed URLs, secrets) are dropped before storage.
- **Persisted per profile:** only `protection.json` = `{ allow[], block[], overrides{} }` (site rules). No URLs, no history, no counters.
- **Never logged/stored:** auth tokens, signed URLs, query params, cookies, `Authorization` headers, POST bodies, passwords, private browsing URLs. The engine inspects `details.url` transiently to decide, then keeps only redacted host/path for blocked normal-mode events.

## Private mode
- Protection runs on the `nexa-private-<id>` partition exactly like persistent browsing.
- Private stats are kept in a **separate in-memory map** (`priv`) — private requests never touch normal-profile counters (no leakage).
- **No recent-event history is recorded for private browsing** (`recent` stays empty for private snapshots).
- Nothing private is persisted; `clearPrivate(profileId)` can drop it, and a restart drops it regardless.

## Profile isolation
- One `onBeforeRequest` listener per partition; the `profileId` is bound by closure at attach time (not read from request details).
- Site rules, settings cache, and stats are keyed by profile. Profile A and B share only the immutable bundled ruleset.

## Fail-safe behavior
- The per-request handler is wrapped in try/catch and **fails open** (allow) so a bug can never break browsing; engine state is surfaced honestly (`error` if a session listener fails to attach, `not_configured` if no rules loaded).
- We never mark a state "Protected"/"Active" when the underlying capability is absent (malicious-DB, cosmetic, external updates → `NOT CONFIGURED`).

## No silent data transmission
- P3 makes **no outbound network requests**. Statistics are computed locally; no browsing URLs leave the device. External filter updates are not enabled (would only fetch the configured list resource if added later).

## Download compatibility (P2)
- `mainFrame` requests are never blocked, and only ad/tracker/annoyance domains match — legitimate file hosts, redirects, blob/data and authenticated downloads are unaffected. Downloads use `will-download` (a separate session event) and are independent of `onBeforeRequest`.

## VPN / extensions (future)
- Protection (ALLOW/BLOCK) is separated from transport (ROUTE/TUNNEL, P4) and from extension request filtering (P9). No design choice here blocks those layers.
