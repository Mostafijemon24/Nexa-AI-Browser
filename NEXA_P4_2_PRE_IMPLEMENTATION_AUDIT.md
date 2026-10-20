# NEXA P4.2 — Pre-Implementation Audit

**Date:** 2026-09-16. Goal: wire a **real production helper transport** + installation/identity/signing lifecycle onto the P4.1 architecture, then validate natively. Native execution is gated by the environment (no WireGuard/root/signing certs) and is reported honestly.

## Current architecture (verified from source)
- `src/shared/vpn.ts` — state machine, config model/validators, `VpnStatus` (now incl. `helper: VpnHelperStatus`), errors, zod.
- `src/shared/vpn-helper.ts` — op allowlist (6 ops), request/response envelopes, per-op zod schemas, interface-name allowlist, error codes, redaction, `HelperInfo`.
- `src/main/services/vpn-helper/protocol.ts` — newline-JSON framing + correlation (transport-agnostic).
- `.../client.ts` — `VpnHelperClient` iface; `StdioHelperClient` (correlated/timeout/versioned, transport-injected); `UninstalledHelperClient`.
- `.../handler.ts` — `handleHelperRequest(req, deps)`: validate→authorize→single `execFile`→verify; runner/tempConfig injected.
- `.../adapter.ts` — `HelperVpnAdapter` (transactional up/down + rollback) implements `VpnPlatformAdapter`.
- `src/helper/main.ts` — standalone helper entry (currently stdio ↔ handler ↔ real execFile).
- `src/main/services/vpn.ts` — `VpnService` (policy/state/secrets/health), accepts injected `adapter` + `helper` client.
- `src/main/index.ts` — currently wires `HelperVpnAdapter(new UninstalledHelperClient())` (honest NOT_CONFIGURED).
- Persistence/secure-storage/IPC/preload — unchanged from P4/P4.1.

## Gaps P4.2 closes (code) vs. defers (environment)
| # | Gap | P4.2 action |
| --- | --- | --- |
| 1 | Production transport not wired | **IMPLEMENT** `SocketHelperTransport` (`node:net` unix socket + Windows named pipe) + `createProductionHelperClient`; wire into main with honest fallback (never fake capability). |
| 2 | Helper socket server | **IMPLEMENT** socket-listen mode in `src/helper/main.ts`. |
| 3 | Helper identity/version verification | **IMPLEMENT** version negotiation via envelope `protocol` + reachability probe; reject unknown/old/future/malformed. |
| 4 | Install/upgrade/uninstall lifecycle | **SCAFFOLD** `install.ts` (detect endpoint/status) + **DOCUMENT** privileged install (needs root/certs) → NOT EXECUTED. |
| 5 | Signing/notarization | **DOCUMENT** per-OS (no certs available) → NOT EXECUTED. |
| 6–9 | Real tunnel/routes/DNS/kill switch/sleep-wake/network-change | code paths exist (P4.1); **native validation NOT EXECUTED — ENVIRONMENT LIMITATION**. |
| 10 | Packaged release integration | **DOCUMENT**; build passes; packaging not executed here. |

## Files that MUST change
`src/main/index.ts` (wire production client), `src/helper/main.ts` (socket mode), `src/renderer/src/views/Settings.tsx` (diagnostics), `tsconfig.node.json` (already includes helper). **Add:** `vpn-helper/endpoint.ts`, `vpn-helper/transport.ts`, `vpn-helper/install.ts`, `tests/unit/vpn-helper-transport.test.ts`, `NEXA_P4_2_*.md`.

## Files that MUST NOT change (no redesign)
`vpn.ts` state machine, `vpn-helper.ts` allowlist (no new privileged ops), `protocol.ts`, `client.ts` contract, `adapter.ts`, `handler.ts` logic, secure-storage, typed IPC, fake-helper contract. No `VpnServiceV2`.

## Platform constraints
- macOS: unix domain socket root:wheel `0600` (or XPC in a later step); SMAppService/SMJobBless install needs signing + notarization.
- Windows: named pipe `\\.\pipe\nexa-vpn-helper` with restrictive ACL; service + Authenticode.
- Linux: unix socket `/run/nexa-vpn-helper.sock`; polkit/systemd + `CAP_NET_ADMIN`.
- Unix socket path length limit (~104 chars macOS) — keep endpoint paths short.

## Native validation plan
Execute the `NEXA_P4_2_NATIVE_SMOKE_TEST.md` matrix on a privileged machine with WireGuard + a signed installed helper. In this environment every native cell = **NOT EXECUTED — ENVIRONMENT LIMITATION**; the production transport is instead proven via a real in-process `net` socket round-trip test.
