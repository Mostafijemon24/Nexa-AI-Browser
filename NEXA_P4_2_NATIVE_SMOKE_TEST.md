# NEXA P4.2 — Native Smoke Test Matrix

**Overall native result: NOT EXECUTED — ENVIRONMENT LIMITATION** (no WireGuard tooling, no root/Admin, no signed/installed helper, no signing environment). Per the non-negotiable rule, no native cell is reported as PASS. The production transport is instead proven by a real in-process `node:net` socket round-trip (`tests/unit/vpn-helper-transport.test.ts`, 6/6 PASS).

Cell legend: `PASS` · `FAIL` · `NOT EXECUTED` · `N/A`.

| Test | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Helper install | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Signature verification | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Transport connection | NOT EXECUTED¹ | NOT EXECUTED¹ | NOT EXECUTED¹ |
| Helper health | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| WireGuard probe | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Config import | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Connect | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Handshake | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Routes | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| IPv4 | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| IPv6 | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| DNS | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Kill switch | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Disconnect | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Route cleanup | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| DNS cleanup | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Helper restart | NOT EXECUTED² | NOT EXECUTED² | NOT EXECUTED² |
| Network change | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Sleep/wake | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| App restart | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Failure rollback | NOT EXECUTED³ | NOT EXECUTED³ | NOT EXECUTED³ |
| Uninstall cleanup | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |

¹ Transport logic proven against a real local socket (non-privileged); native connection to the *installed privileged* helper not executed.
² Transport-level reconnect after socket drop proven in automated tests; native helper-process restart not executed.
³ Transactional rollback proven deterministically (fake runner) in `vpn-helper-integration`/`vpn-helper-handler`; native rollback not executed.

## Executed (deterministic, non-privileged)
- Real socket round-trip: detect (installed), request/response, version-mismatch → identity error, endpoint-absent → not_installed, no-response → timeout, socket drop → reconnect.
- All P4.1 unit/integration suites (validation, handler, transactional connect/rollback, handshake-gated PROTECTED, redaction, profile isolation).

## How to execute the native matrix
1. On a privileged host, build + sign + install the helper (see `NEXA_P4_2_SIGNING_AND_INSTALLER.md`); it creates the endpoint socket/pipe.
2. Launch the packaged app; `createProductionHelperClient` connects over the platform transport.
3. Install WireGuard; import a real `.conf`; Connect. Record each cell as PASS/FAIL. Confirm the UI holds `CONNECTING` until a real handshake, and leaves `PROTECTED` when the tunnel is torn down / network pulled.
