# NEXA P4 — WireGuard Dependency Audit

## Decision
Use **system WireGuard tooling** (`wireguard-tools`: `wg`, `wg-quick`, or `wireguard-go` on userspace platforms), detected at runtime. **No WireGuard binary is bundled and no npm native crypto module is added in P4.** NEXA never implements WireGuard cryptography itself.

## Candidate
| Field | Value |
|---|---|
| Component | `wireguard-tools` (`wg`, `wg-quick`) / kernel WireGuard / `wireguard-go` |
| Repository | https://git.zx2c4.com/wireguard-tools (upstream, Jason A. Donenfeld) |
| License | GPLv2 (tools) / MIT (wireguard-go) — used as an **external system program**, not linked/bundled → no redistribution obligation imposed on NEXA |
| Maintenance | Actively maintained upstream; widely packaged (Homebrew, apt, Windows installer) |
| Platform support | macOS (app/`wireguard-go`), Windows (WireGuardNT + service), Linux (kernel module + tools) |
| Security history | Mature, audited protocol (Noise framework, Curve25519, ChaCha20-Poly1305); no self-rolled crypto |
| Native components | System-provided; NEXA does not ship them |
| Binary distribution | **None bundled** — detected via `wg --version`; absence → `NOT_CONFIGURED` |
| Electron compatibility | Invoked from main process via `child_process.execFile` (arg arrays, no shell) |
| Update strategy | Managed by the OS package manager / WireGuard installer, not NEXA |
| Supply-chain risk | Minimal — no new npm dependency, no vendored binary; only detects a user-installed system tool |

## Why selected
- WireGuard-first, standards-compliant, no proprietary protocol, no hand-rolled crypto (mandated by spec §6).
- Zero added supply-chain surface: nothing bundled, nothing linked.
- Honest degradation: if the tool is absent or unprivileged, NEXA reports it rather than faking a tunnel.

## Rejected alternatives
- **Bundling a WireGuard binary / native npm addon:** large binary distribution + packaging/signing/notarization + update burden + supply-chain risk. Deferred; not needed to build the real architecture.
- **Reimplementing WireGuard in JS/TS:** forbidden (no self-rolled crypto).
- **Browser-only SOCKS/HTTP proxy labeled "VPN":** explicitly forbidden — a proxy is not a WireGuard tunnel and must never be labeled VPN.
- **Managed commercial provider SDK:** out of scope for P4; the provider abstraction leaves room for it later without engine changes.

## Privilege model
Tunnel `up`/`down`, route and DNS changes require elevated privileges (root/admin) or a privileged helper/service. P4 implements the real `execFile` code paths but **does not assume sudo/admin** (spec §66). In an unprivileged environment these operations fail safely → `ERROR`/`EXPERIMENTAL`, never `PROTECTED`. A signed privileged helper is future work (documented, not faked).
