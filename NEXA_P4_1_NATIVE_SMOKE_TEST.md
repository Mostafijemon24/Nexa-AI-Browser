# NEXA P4.1 — Native Smoke Test Matrix

**Overall native result: NOT EXECUTED — ENVIRONMENT LIMITATION.**
The environment has no WireGuard (`wg`/`wg-quick`), no root/Admin, and no installed/signed privileged helper. Per the non-negotiable rule, no native step is reported as passing. The full code path is instead exercised deterministically via a loopback transport + fake command runner (see `tests/unit/vpn-helper-integration.test.ts`), which is as strong as possible without privilege.

## macOS
| Step | Result |
| --- | --- |
| Helper installation (SMAppService) | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Helper authorization | NOT EXECUTED — ENVIRONMENT LIMITATION |
| WireGuard availability probe | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Tunnel creation / handshake | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Routing / DNS | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Disconnect / cleanup | NOT EXECUTED — ENVIRONMENT LIMITATION |

## Windows
| Step | Result |
| --- | --- |
| Service installation | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Service authorization (pipe ACL) | NOT EXECUTED — ENVIRONMENT LIMITATION |
| WireGuard tunnel / routing / DNS | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Disconnect / cleanup | NOT EXECUTED — ENVIRONMENT LIMITATION |

## Linux
| Step | Result |
| --- | --- |
| Helper/polkit/systemd installation | NOT EXECUTED — ENVIRONMENT LIMITATION |
| WireGuard interface / routes / DNS | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Disconnect / cleanup | NOT EXECUTED — ENVIRONMENT LIMITATION |

## What WAS executed (deterministic, no privilege)
- Protocol framing round-trip, partial-fragment buffering, corrupt-frame skip.
- Full request validation + rejection (unknown op, version mismatch, oversize, bad interface, malformed CIDR/endpoint/key, strict extra fields).
- Helper handler with a fake runner: correct `execFile` binary + argument array, `shell:false`, IPv6 AllowedIPs filtering, secret-free logging, temp-config cleanup, permission/enoent mapping, idempotent down, kill-switch honesty.
- End-to-end `VpnService → HelperVpnAdapter → StdioHelperClient → protocol → handler → fake wg`: PROTECTED only after verified handshake, ERROR + rollback on up-failure and on handshake timeout, idempotent disconnect, reconnect, profile isolation, no key in renderer status.

## How to run native smoke tests when privilege is available
1. Build + sign + install the helper for the target OS (see SIGNING_AND_PACKAGING).
2. Wire the production transport in place of `UninstalledHelperClient` in `src/main/index.ts` (unix socket / named pipe / XPC to the installed helper).
3. Install WireGuard tools; import a real `.conf`; Connect. Expect PROTECTED only with a live handshake; pull the network and confirm the UI leaves PROTECTED.
