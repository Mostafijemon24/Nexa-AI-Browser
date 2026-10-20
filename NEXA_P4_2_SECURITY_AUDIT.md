# NEXA P4.2 — Security Audit (Threat → Mitigation → Verification → Remaining limitation)

| Threat | Mitigation | Verification | Remaining limitation |
| --- | --- | --- | --- |
| Malicious renderer executes privileged ops | Renderer only has preload capability API; helper client lives in main; no renderer→helper/socket/pipe path | Architecture; `preload/` has no helper handle; `no key in renderer status` test | — |
| Compromised webpage / extension | Sandbox, `contextIsolation`, `nodeIntegration:false`; VPN only via typed `vpn.*` IPC | Existing IPC + Zod validation | — |
| IPC / command injection | Op allowlist (6 ops); helper re-validates; `execFile` + arg arrays + `shell:false`; interface-name allowlist; strict schemas | `vpn-helper-pure` + `vpn-helper-handler` (injection/traversal/unknown-op rejected before runner) | — |
| Privilege escalation via helper | No generic exec; helper does one allowlisted op per request; least-privilege install (CAP_NET_ADMIN / service account) | Handler tests; allowlist test | Native least-privilege config NOT EXECUTED |
| Helper impersonation / rogue listener | Root-owned `0600` unix socket / named pipe with restrictive ACL; protocol+version identity check on connect | `version mismatch → error` transport test; endpoint ownership documented | ACL/ownership enforced by installer — NOT EXECUTED |
| Unauthorized local process connects | Endpoint permissions restrict to app/service identity; version handshake | Transport tests | OS-level ACL NOT EXECUTED |
| Secret leakage (keys/PSK) | Keys only in `safeStorage`→main→helper payload; never in JSON/renderer/logs; `redactHelperRequest`; temp config `0600`, removed in `finally` | `never writes secrets to the logger`, `no key in renderer status` | — |
| Stale routes / DNS after failure | Transactional connect: any failure → `bringTunnelDown` rollback; disconnect restores | integration rollback tests | Native route/DNS restoration NOT EXECUTED |
| DNS / IPv6 leaks | IPv6 BLOCK default drops `::/0`; DNS applied via wg-quick; both shown honestly (`Not verified` until validated) | IPv6-filtering test; UI diagnostics | DNS/IPv6 native verification NOT EXECUTED |
| Stale kill-switch firewall rules | Kill switch remains EXPERIMENTAL (`enforced:false`); never claimed ACTIVE | handler kill-switch honesty test | Native pf/WFP/nftables NOT EXECUTED |
| Helper crash / app crash | Idempotent disconnect; re-probe on reconnect; `disconnectOnExit` teardown; no fake PROTECTED on drop | integration disconnect/reconnect; transport reconnect | Native crash recovery NOT EXECUTED |
| Update / installer compromise | Signed helper + version pinning; app rejects mismatched version | version-mismatch test | Signing/notarization NOT EXECUTED (no certs) |
| Silent fallback to fake VPN | Production path uses real transport; absence ⇒ NOT_CONFIGURED; `UninstalledHelperClient` not wired into main | Implementation audit; grep shows no fake capability in VPN path | — |

## Secret-flow assertion
`SecureStorage → main → authenticated transport → helper → 0600 temp config → WireGuard`. Automated tests confirm the private key never appears in renderer-facing status or logs.

## Result
**Security Audit: PASS** for the implemented architecture (privilege boundary, allowlist, validation, secret handling, no arbitrary execution, no silent fake fallback). Native-enforcement items (ACL ownership, kill switch, route/DNS restoration, signing) are honestly **NOT EXECUTED** pending a privileged, signed environment.
