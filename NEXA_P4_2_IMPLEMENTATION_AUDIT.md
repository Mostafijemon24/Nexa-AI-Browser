# NEXA P4.2 — Implementation Audit

## What P4.2 added (code)
- **Production transport** — `src/main/services/vpn-helper/transport.ts` (`SocketHelperTransport`, `node:net` unix socket / Windows named pipe; lazy connect, connect-timeout guard, error/close → reconnect).
- **Endpoint map** — `src/main/services/vpn-helper/endpoint.ts` (root-owned unix socket on macOS/Linux, `\\.\pipe\nexa-vpn-helper` on Windows).
- **Install/identity detection + production client factory** — `src/main/services/vpn-helper/install.ts` (`detectHelperInstall`, `createProductionHelperClient`).
- **Helper socket-server mode** — `src/helper/main.ts` now listens on the platform endpoint (0600 unix socket, unlink-on-exit) in addition to `--stdio`.
- **Main wiring** — `src/main/index.ts` now builds the client via `createProductionHelperClient` (real transport). No `UninstalledHelperClient` in the production path; honest NOT_CONFIGURED when no helper is installed.
- **UI diagnostics** — `Settings.tsx` "Native VPN diagnostics": WireGuard / Helper / Helper version / Transport / Tunnel / Handshake / Routing / DNS / Kill switch / IPv6 / Native test.
- **Tests** — `tests/unit/vpn-helper-transport.test.ts` (real in-process socket round-trip, detect/version-mismatch/unavailable/timeout/reconnect).

## What P4.2 deliberately did NOT change (preserved)
`vpn.ts` state machine · `vpn-helper.ts` allowlist (still exactly 6 ops, no new privileged op) · `protocol.ts` · `client.ts` contract · `adapter.ts` · `handler.ts` logic · secure storage · typed IPC · fake-helper contract. No `VpnServiceV2`/`VpnHelperV2`.

## Identity / version verification
`StdioHelperClient.detect()` performs a live `probeWireGuard` round-trip; every response is checked against `HELPER_PROTOCOL_VERSION`. A mismatch ⇒ `state: 'error'` (rejected, never used). No server ⇒ `not_installed`. Unauthorized ⇒ `needs_authorization`. Verified by transport tests.

## No fake fallback
The production path connects to the real endpoint. Absence of a signed, installed helper yields `NOT_CONFIGURED` (not fake `PROTECTED`). There is no `isDev`/`localhost`/simulated capability in the VPN path. `UninstalledHelperClient` remains only as an explicit test/dev implementation and is no longer wired into `main`.

## Verification in this environment
`npm test` 182/182 · `npm run typecheck` PASS · `npm run build` PASS. Native operations (install, real tunnel, routes, DNS, kill switch, sleep/wake, network change, packaging) are **NOT EXECUTED — ENVIRONMENT LIMITATION** (no WireGuard/root/signing). The production transport itself is proven via a real `node:net` socket round-trip.
