# NEXA P4.1 — Platform Matrix

Status legend: **IMPLEMENTED** (code path present + unit/integration-tested via loopback+fake runner) · **NOT EXECUTED** (needs privilege/WireGuard/installed helper not available in this environment) · **EXPERIMENTAL** (deliberately not enforced) · **DOCUMENTED** (design/packaging only).

| Capability | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| Privileged mechanism | SMJobBless / SM `daemon` (DOCUMENTED) | Windows Service + Named Pipe ACL (DOCUMENTED) | polkit action / systemd unit (DOCUMENTED) | See SIGNING_AND_PACKAGING |
| Helper IPC (framing/correlation/timeout/versioning) | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | `protocol.ts` + `StdioHelperClient` |
| WireGuard executor | `wg`/`wg-quick` via `execFile` | `wg.exe`/`wireguard.exe` | `wg`/`wg-quick` via `execFile` | `handler.ts`; `shell:false`, arg arrays |
| Executable discovery | fixed candidate paths + PATH fallback | `%ProgramFiles%\WireGuard` | fixed candidate paths + PATH fallback | `helper/main.ts` `wgPaths()` |
| Interface create/config/up/down | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | verified via fake runner |
| Routes | via `wg-quick` (atomic) | via `wireguard.exe` service | via `wg-quick` (atomic) | granular ops intentionally omitted (privilege minimization) |
| DNS | `wg-quick` DNS=; verification NOT CONFIGURED | tunnel service DNS | `wg-quick` DNS=/resolvconf | UI shows Verified/Not verified/Not configured honestly |
| IPv6 | BLOCK default (AllowedIPs filtered) | BLOCK default | BLOCK default | `buildWgQuickConfig` drops `::/0` when block; test-verified |
| Kill switch | pf (EXPERIMENTAL) | WFP (EXPERIMENTAL) | nftables/iptables (EXPERIMENTAL) | helper returns `{enforced:false, experimental:true}` — never shown ACTIVE |
| Handshake health verify | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | IMPLEMENTED · NOT EXECUTED | `queryHandshakeState` → real handshake required for PROTECTED |
| Transactional connect + rollback | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | adapter rolls back on any failure; test-verified |
| Sleep/wake revalidation | IMPLEMENTED (`powerMonitor`) | IMPLEMENTED | IMPLEMENTED | inherited from P4 |
| Network-change revalidation | IMPLEMENTED (revalidate/poll) | IMPLEMENTED | IMPLEMENTED | flips to non-PROTECTED on broken tunnel |
| Public-IP verification | NOT CONFIGURED (privacy) | NOT CONFIGURED | NOT CONFIGURED | no third-party calls |

## Supported-target assumptions (to confirm before shipping)
- macOS: modern ServiceManagement privileged helper; Hardened Runtime + notarization required. Minimum deployment target must be confirmed against the app's `electron-builder` `mac.minimumSystemVersion` before choosing SMAppService vs. legacy SMJobBless.
- Windows: dedicated service (LocalSystem or a constrained service account) + Named Pipe with a restrictive ACL granting only the NEXA app identity.
- Linux: polkit action scoped to the helper, or a systemd unit with a minimal capability set (`CAP_NET_ADMIN`), packaged per-distro.

Private windows inherit the **system** tunnel (WireGuard is system-level). This is documented, not faked — NEXA does not claim an independent per-window VPN.
