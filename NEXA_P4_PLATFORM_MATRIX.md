# NEXA P4 — Platform Feasibility Matrix

Mechanism per platform, and what P4 actually does today. "Detection" = unprivileged, runs in-app now. "Tunnel ops" = require elevated privileges / a privileged helper.

| Capability | macOS | Windows | Linux |
|---|---|---|---|
| WireGuard tunnel | `wireguard-go` + `wg-quick` (Homebrew/WireGuard.app) | WireGuardNT via `wireguard.exe` tunnel service | kernel module + `wg-quick` |
| **Detection (implemented, runs now)** | `wg --version`, `wg-quick --version` | `wg.exe --version` | `wg --version`, `wg-quick --version` |
| Route management | `wg-quick` (needs root) | tunnel service (needs Admin) | `wg-quick` (needs root/CAP_NET_ADMIN) |
| DNS control | `wg-quick` DNS= (resolvectl/scutil) | tunnel service | `wg-quick` DNS= (resolvconf/systemd-resolved) |
| Kill switch | fw rules (pf) — **EXPERIMENTAL** | WFP — **EXPERIMENTAL** | nftables/iptables — **EXPERIMENTAL** |
| IPv6 handling | AllowedIPs filtering (block policy implemented in config builder) | same | same |
| Service lifecycle | user-invoked `wg-quick` | Windows service | `wg-quick`/systemd |
| Auto-connect | supported by engine (conservative default `never`) | same | same |
| Privilege requirements | root (sudo/helper) | Administrator | root/CAP_NET_ADMIN |
| Packaged app support | needs signed privileged helper (future) | needs elevation/service (future) | needs pkexec/helper (future) |

## What P4 implements per platform
- **All platforms:** real capability **detection** via `execFile` (no shell); real WireGuard **config parsing/validation**; real config-file rendering (`buildWgQuickConfig`, IPv6 block policy honored); real `up`/`down`/`probeHealth` code paths using `execFile` + arg arrays + `0600` temp config removed after `up`.
- **macOS/Linux:** shared `WgQuickAdapter` (`wg-quick up/down`, `wg show <iface> dump` health parsing).
- **Windows:** `WindowsVpnAdapter` (`wireguard.exe /installtunnelservice` + `wg.exe show dump`).

## Verified in this environment
- Detection executed on macOS: **WireGuard tooling NOT installed** → capability `unavailable` → engine reports `NOT_CONFIGURED` (correct, honest).
- Tunnel `up`/`down` require root and a WireGuard install → **NOT EXECUTED** here. The code paths exist and are unit-tested via a deterministic fake adapter that honors the real service contract.

## Kill switch / DNS / IPv6 / WebRTC honesty
- **Kill switch:** enforcement (pf/WFP/nftables) is **EXPERIMENTAL** and not verified → `status.killSwitch.enforced` is always `false`; UI shows `EXPERIMENTAL`.
- **DNS protection:** the tunnel DNS is applied by `wg-quick`, but NEXA performs **no resolver verification** → `dnsVerified: 'unknown'`, UI shows `UNVERIFIED`.
- **IPv6:** default policy `block` (IPv6 AllowedIPs stripped from the generated config to avoid leaks); `allow` opt-in.
- **WebRTC:** WireGuard does not by itself prevent WebRTC IP disclosure. No WebRTC mitigation is implemented → `NOT CONFIGURED` (documented, not faked).
- **Public IP verification:** requires an external check; not performed in P4 → `publicIpVerified: 'unknown'`.
