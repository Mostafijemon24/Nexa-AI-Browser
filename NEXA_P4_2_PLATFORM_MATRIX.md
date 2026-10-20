# NEXA P4.2 — Platform Matrix

Legend: **IMPLEMENTED** (code + automated tests) · **NOT EXECUTED** (needs privilege/WireGuard/signing) · **EXPERIMENTAL** · **DOCUMENTED**.

| Capability | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Transport | unix socket `/var/run/nexa-vpn-helper.sock` — IMPLEMENTED | named pipe `\\.\pipe\nexa-vpn-helper` — IMPLEMENTED | unix socket `/run/nexa-vpn-helper.sock` — IMPLEMENTED |
| Transport tested (local socket) | IMPLEMENTED | IMPLEMENTED (pipe path via `node:net`) | IMPLEMENTED |
| Endpoint ownership/ACL | root:wheel 0600 — DOCUMENTED, NOT EXECUTED | pipe ACL to app identity — DOCUMENTED, NOT EXECUTED | root 0600 — DOCUMENTED, NOT EXECUTED |
| Privileged install | SMAppService/SMJobBless — DOCUMENTED, NOT EXECUTED | Windows Service — DOCUMENTED, NOT EXECUTED | polkit/systemd `CAP_NET_ADMIN` — DOCUMENTED, NOT EXECUTED |
| Identity/version verification | IMPLEMENTED (protocol handshake) | IMPLEMENTED | IMPLEMENTED |
| Helper socket-server mode | IMPLEMENTED (`src/helper/main.ts`) | IMPLEMENTED | IMPLEMENTED |
| WireGuard executor | `wg`/`wg-quick` execFile — IMPLEMENTED, NATIVE NOT EXECUTED | `wg.exe`/`wireguard.exe` — IMPLEMENTED, NATIVE NOT EXECUTED | `wg`/`wg-quick` — IMPLEMENTED, NATIVE NOT EXECUTED |
| Tunnel / handshake / routes | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED |
| DNS | wg-quick DNS · NOT VERIFIED | tunnel service DNS · NOT VERIFIED | wg-quick/resolvconf · NOT VERIFIED |
| IPv6 | BLOCK default — IMPLEMENTED (tested) | BLOCK default — IMPLEMENTED | BLOCK default — IMPLEMENTED |
| Kill switch | pf — EXPERIMENTAL | WFP — EXPERIMENTAL | nftables/iptables — EXPERIMENTAL |
| Transactional rollback | IMPLEMENTED (tested) | IMPLEMENTED | IMPLEMENTED |
| Reconnect after drop | IMPLEMENTED (tested) | IMPLEMENTED | IMPLEMENTED |
| Sleep/wake + network-change revalidation | IMPLEMENTED (powerMonitor) · native NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED |
| Signing / notarization | DOCUMENTED, NOT EXECUTED | Authenticode DOCUMENTED, NOT EXECUTED | package signing DOCUMENTED, NOT EXECUTED |
| Packaging integration | build PASS; package NOT EXECUTED | build PASS; package NOT EXECUTED | build PASS; package NOT EXECUTED |

Private windows inherit the **system** tunnel (WireGuard is system-level); NEXA does not fake independent per-window/per-profile system routing. Profile isolation applies to stored config/secrets/state, verified by tests.
