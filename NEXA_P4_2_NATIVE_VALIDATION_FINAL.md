# NEXA P4.2 Native Validation Final Report

## Environment

- OS: macOS (Darwin) 26.6.2 (build 25G83) · Architecture: arm64 (Apple Silicon)
- NEXA Version: 0.1.0 · Git Commit: n/a (not a git repository)
- Node: v24.17.0 · Electron: ^37.4.0 (declared)
- Privilege: **non-root (uid 501)** — no Admin/root
- WireGuard: **ABSENT** (`which wg` / `which wg-quick` → not found; `wg --version` → not found)
- Privileged helper: **NOT INSTALLED** (endpoint `/var/run/nexa-vpn-helper.sock` ABSENT)
- Helper protocol: 1 (implemented; not negotiated against a live helper)
- Signing identity / notarization / packaging environment: **NONE**
- Real test WireGuard endpoint/config: **NOT PROVIDED**
- Date: 2026-09-16 · Tester: native-platform validation engineer (automated evidence only)

## Production Path Audit

`grep -RniE "isDev|localhost|127.0.0.1|UninstalledHelperClient|Fake|DevelopmentVpnFallback|hardcoded|exec(|spawn(|sudo|osascript|powershell|shell" src` — every hit classified:

| Match | Location | Class |
|---|---|---|
| `shell.openExternal`/`openPath` | preload, platform/*, downloads, register, index | UNRELATED (Electron shell API, not command execution) |
| `execFile(…, shell:false)` | `vpn-platform/base.ts`, `helper/main.ts` | PRODUCTION — safe (arg arrays, no shell string) |
| `UninstalledHelperClient` (class def) | `vpn-helper/client.ts` | TEST/DEV — **not wired into `main`** |
| "fake/simulated capability", "fakeable in tests" | comments | DOCUMENTATION (asserting it does NOT fake) |
| "hardcoded" (accent), `tokenRe.exec(html)` | `Settings.tsx`, `library.ts` | UNRELATED |

No `isDev`/`localhost`/`127.0.0.1`/`sudo`/`osascript`/`powershell` in the production VPN path. **PASS.**

State machine (`src/shared/vpn.ts`): no `off→protected` edge; the only production transition to `protected` is `established` from `connecting`, emitted by `VpnService` solely after `verifyHealth` observes a real handshake. **PASS.**

## Native Prerequisites

| Requirement | Status | Action |
|---|---|---|
| Supported OS | PASS (macOS 26.6.2) | — |
| Correct architecture | PASS (arm64) | — |
| Node | PASS (v24.17.0) | — |
| Electron | PASS (^37.4.0) | — |
| WireGuard (`wg`) | **BLOCKED** | requires install; tunnel use requires root |
| `wg-quick` | **BLOCKED** | absent |
| Root/Admin | **BLOCKED** | uid 501; not available |
| Production helper | **BLOCKED** | requires admin + signing to install |
| Helper signature | **BLOCKED** | no signing identity |
| Helper installation | **BLOCKED** | requires admin (SMAppService) |
| Helper endpoint | **BLOCKED** | socket ABSENT |
| Signing identity | **BLOCKED** | none |
| Packaging environment | **BLOCKED** | notarization/cert unavailable |
| Real test VPN | **BLOCKED** | no legitimate endpoint/config provided |

Nothing was installed: installing partial pieces (e.g. `wg` alone) cannot unblock the gate without root + a signed installed helper + a real endpoint, and would be an unnecessary system side effect. Per the task rule, the required privileges are reported rather than worked around.

## Signing & Packaging
**BLOCKED — ENVIRONMENT.** No signing identity, notarization, or packaging environment. No signing evidence fabricated.

## Helper Installation
**BLOCKED — ENVIRONMENT.** Requires admin + signed helper. Absent helper → NEXA reports `NOT_CONFIGURED` (verified honest behavior), never `PROTECTED`.

## Production Transport
**PASS (logic).** `SocketHelperTransport` (unix socket / named pipe) exercised via a real in-process `node:net` round-trip: connect/detect, request/response, timeout, reconnect after drop, endpoint-absent → not_installed, version mismatch → identity error (`tests/unit/vpn-helper-transport.test.ts`, 6/6). Native connection to an installed privileged helper: **BLOCKED — ENVIRONMENT.**

## Real WireGuard Tunnel
**BLOCKED — ENVIRONMENT** (no WireGuard, no privilege).

## Real Handshake
**BLOCKED — ENVIRONMENT** (no tunnel). PROTECTED never displayed; handshake-gating logic verified deterministically.

## Routing
**BLOCKED — ENVIRONMENT** (no tunnel).

## IPv4 Leak
**BLOCKED — ENVIRONMENT** (no tunnel).

## IPv6
**BLOCKED (native)** / policy logic PASS — BLOCK default + `::/0` filtering unit-tested; native traffic not executed.

## DNS
**EXPERIMENTAL / BLOCKED.** UI shows `Not verified`; no native enforcement to validate. Not promoted.

## Kill Switch
**EXPERIMENTAL.** Helper returns `enforced:false`; never shown ACTIVE. Native enforcement not proven.

## Disconnect
**PASS (deterministic) / BLOCKED (native).** Idempotent disconnect + teardown tested; native cleanup not executed.

## Helper Restart
**PASS (transport) / BLOCKED (native process).** Socket-drop reconnect verified; native helper-process restart not executed.

## Application Restart
**PASS (state) / BLOCKED (native tunnel).** `integration-restart` recovery; no persisted `PROTECTED`; native tunnel not executed.

## Network Change
**BLOCKED (native).** Revalidation logic present; native transition not executed.

## Sleep/Wake
**BLOCKED (native).** `powerMonitor.resume`→`revalidate` wired; native not executed.

## Failure Injection
**PASS (deterministic) / BLOCKED (native).** Invalid config/endpoint, helper unavailable, protocol mismatch, WireGuard unavailable, handshake timeout → honest non-PROTECTED (unit/integration tests). Native injection not executed.

## Rollback
**PASS (deterministic) / BLOCKED (native).** up-failure & handshake-timeout → ERROR + `bringTunnelDown`; native not executed.

## Profile / Private Mode
**PASS.** Per-profile config/secret isolation + private-mode non-persistence verified (`vpn-service`, `vpn-helper-integration`). System-level tunnel semantics documented.

## Security Review
**PASS.** No secrets in renderer status/logs (`redactHelperRequest`; secret-free-status/log tests). Capability-specific typed IPC; no generic privileged channel. Helper allowlist remains exactly: `probeWireGuard, bringTunnelUp, bringTunnelDown, queryHandshakeState, enableKillSwitch, disableKillSwitch` (not expanded). No arbitrary shell/executable/path. No secrets in repo/persisted JSON.

## Uninstall / Cleanup
**BLOCKED — ENVIRONMENT** (nothing installed to uninstall).

## Regression
**PASS.** `npm test` 182/182 · `npm run typecheck` PASS · `npm run build` PASS. Test count unchanged.

## STEP 27 Evidence Matrix

| Area | Result | Evidence |
|---|---|---|
| Production path audit | PASS | classified grep; no dev/fake/localhost in VPN path |
| Fake fallback audit | PASS | `UninstalledHelperClient` not in `main`; real transport wired |
| WireGuard installed | BLOCKED | `wg`/`wg-quick` absent |
| Privileged helper installed | BLOCKED | endpoint absent; non-root; unsigned |
| Helper identity | BLOCKED | no live helper |
| Helper protocol | PASS (logic) / BLOCKED (native) | version handshake + mismatch→error tested |
| Production transport | PASS | real `node:net` round-trip (6/6) |
| Real tunnel | BLOCKED | no WireGuard/privilege |
| Real handshake | BLOCKED | no tunnel |
| Routing | BLOCKED | no tunnel |
| IPv4 leak test | BLOCKED | no tunnel |
| IPv6 leak test | BLOCKED (native) | policy logic tested |
| DNS | EXPERIMENTAL/BLOCKED | UI `Not verified` |
| Kill switch | EXPERIMENTAL | `enforced:false` |
| Disconnect cleanup | PASS (det.) / BLOCKED (native) | idempotent teardown tests |
| Helper restart | PASS (transport) / BLOCKED (native) | reconnect test |
| App restart | PASS (state) / BLOCKED (native) | integration-restart |
| Network change | BLOCKED (native) | logic present |
| Sleep/wake | BLOCKED (native) | powerMonitor wired |
| Failure injection | PASS (det.) / BLOCKED (native) | honest states tested |
| Rollback | PASS (det.) / BLOCKED (native) | rollback tests |
| Private profile | PASS | isolation tests |
| Security audit | PASS | secret/allowlist/shell audit |
| Uninstall cleanup | BLOCKED | nothing installed |
| Regression tests | PASS | 182/182 |
| Typecheck | PASS | tsc clean |
| Build | PASS | electron-vite clean |
| Signing | BLOCKED | no identity |
| Packaging | BLOCKED | no environment |

## Final Gate

**BLOCKED — ENVIRONMENT**

Native execution requires WireGuard, root/Admin, a signed installed privileged helper with a live endpoint, a signing/packaging environment, and a real test VPN endpoint — none available on this host. No `BLOCKED`/`NOT EXECUTED` result was converted to `PASS`; no `IMPLEMENTED` item was claimed as `NATIVE VERIFIED`.

## Release Recommendation

**READY WITH LIMITATIONS** — architecture, production transport, identity/version verification, transactional lifecycle, honest state model, secret handling, and the full regression suite are verified (182/182, typecheck, build) with zero production-path violations. Native VPN protection is not yet proven on a privileged/signed host.

**P4.2 Native Validation Gate = BLOCKED — ENVIRONMENT.** P5 must not begin until this gate = PASSED.

---

## Addendum — P4 VPN UX Completion (see NEXA_P4_VPN_UX_IMPLEMENTATION.md)

VPN UX/functional completion was layered on top of this architecture without
redesigning it: a single pure state-projection module (`src/shared/vpn-ui.ts`)
now feeds the toolbar toggle, status bar, dashboard widget, and command palette;
a hardcoded `VPN · not configured` status-bar string was fixed to reflect real
state. The renderer remains a strict projection of backend `VpnStatus`. Full
regression re-run after these changes: **194/194 tests pass, typecheck PASS,
build PASS**.

**This addendum does NOT change the native gate.** Native execution status is
unchanged: WireGuard/root/signed helper/endpoint remain unavailable. The gate
stays **BLOCKED — ENVIRONMENT**; no native result was converted to `PASS`.

---

## Native Validation Session — 2026-09-16 (final gate re-run)

Independent re-verification of prerequisites and baseline on this host.

### Environment
- OS: macOS 26.6.2 (build 25G83) · Arch: arm64 (Apple M-series) · uid 501 (non-root)
- Node v24.17.0 · npm 11.13.0 · NEXA 0.1.0 · Electron ^37.4.0 · Helper protocol v1
- WireGuard: **ABSENT** — `which wg`/`wg-quick`/`wireguard-go` → not found
- `sudo`: **requires a password (not available non-interactively)** — cannot create a `utun` interface or install a privileged helper
- Homebrew present (`/opt/homebrew/bin/brew`) but installing `wireguard-tools` cannot unblock the gate without root + a signed installed helper + a real peer
- Signing: only an **Apple Development** identity is present; **no Developer ID Application identity** and no notarization → a privileged helper cannot be signed/installed via `SMAppService` for production
- Real WireGuard test peer (private key / peer public key / endpoint / AllowedIPs): **NOT PROVIDED**

### Automated baseline (this session)
- Tests: **PASS — 239/239** · Typecheck: **PASS** · Build: **PASS**

### Production path audit (this session)
- `main/index.ts` wires `createProductionHelperClient` → `StdioHelperClient` + `SocketHelperTransport` → `HelperVpnAdapter`. `UninstalledHelperClient` is defined but **not** referenced in production wiring.
- No `isDev` / `localhost` / `127.0.0.1` / `sudo` / `osascript` / `powershell` / `hardcoded PROTECTED` in the production VPN path. **PASS.**

### Native acceptance matrix

| Test | Result | Evidence |
|---|---|---|
| WireGuard detection | **NOT INSTALLED** | `which wg`/`wg-quick` → not found |
| Helper installation | BLOCKED — ENVIRONMENT | needs root + Developer ID-signed helper (SMAppService) |
| Helper identity | BLOCKED — ENVIRONMENT | no helper installed; no Developer ID identity |
| Production transport (to real helper) | BLOCKED — ENVIRONMENT | socket transport proven in-process (6/6 tests); no installed helper to connect to |
| Connect | BLOCKED — ENVIRONMENT | no WireGuard, no root, no peer |
| Handshake | BLOCKED — ENVIRONMENT | no real peer/endpoint to handshake with |
| Routing | BLOCKED — ENVIRONMENT | no tunnel to route through |
| DNS | BLOCKED — ENVIRONMENT | no tunnel |
| IPv6 | BLOCKED — ENVIRONMENT | no tunnel |
| Kill switch | EXPERIMENTAL (not natively tested) | no OS-enforced tunnel present to test |
| Disconnect | BLOCKED — ENVIRONMENT | no active tunnel |
| Failure rollback | PASS (logic, non-native) | `vpn-helper-integration.test.ts`: handshake timeout → ERROR + rollback, no fake PROTECTED |
| Helper restart | PASS (logic, non-native) | `vpn-helper-transport.test.ts`: reconnect after drop |
| App restart | PASS (logic, non-native) | state recovery covered by unit suite |
| Network change | BLOCKED — ENVIRONMENT | no tunnel |
| Sleep/wake | BLOCKED — ENVIRONMENT | `powerMonitor` revalidation wired; no tunnel to revalidate |
| Profile isolation | PASS (logic, non-native) | `vpn-service.test.ts` profile-scoped state |
| Private mode | PASS (logic, non-native) | no persistence of private VPN secrets/state |
| Helper uninstall | BLOCKED — ENVIRONMENT | nothing installed to remove |

### Security audit (this session)
No VPN private key in renderer / logs / IPC event payloads / persisted JSON (verified by design + redaction tests). No arbitrary privileged execution; helper contract is the fixed six-op allowlist with Zod validation; temp configs `0600` + cleanup (handler tests). No unsigned production helper is accepted. **PASS.**

### Missing prerequisites (exact)
1. WireGuard tooling (`wg`/`wg-quick`) is not installed.
2. Root/Admin privileges (uid 501; no non-interactive `sudo`) required to create the tunnel interface and install the privileged helper.
3. A **Developer ID Application** signing identity + notarization to install the privileged helper via `SMAppService` (only an Apple Development cert exists).
4. A real WireGuard peer/server configuration (private key, peer public key, endpoint, AllowedIPs) to observe a genuine handshake.

### Gate
**P4.2 Native Validation Gate = BLOCKED — ENVIRONMENT.** No environmental limitation was converted to PASS; no native evidence was fabricated.
