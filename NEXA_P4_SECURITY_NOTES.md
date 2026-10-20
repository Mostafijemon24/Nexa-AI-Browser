# NEXA P4 — VPN Security & Privacy Notes

## Process model (unchanged)
`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` — preserved. No renderer gains `fs`, `child_process`, `net`, `dgram`, `exec`, `spawn`, `shell`, or private-key access. All VPN logic is main-process only.

## No arbitrary command execution
- Native calls use `child_process.execFile` with a fixed command and an **argument array** and `shell: false`. There is **no** generic `execute/runCommand/vpnRawCommand` bridge.
- Imported WireGuard config values are **never** passed to a shell. They are validated (`parseWireGuardConfig`) and rendered into a config **file** (`0600`) that `wg-quick`/`wireguard.exe` reads by path. The temp file is deleted immediately after `up`.

## Secret handling
- Private keys and preshared keys go **only** into OS-backed `SecureStorage` (Keychain / DPAPI / secret-service) under `vpn:<profileId>:<serverId>:priv|psk`.
- Secrets are **never**: persisted in `vpn.json`, returned from any IPC (`VpnServer`/`VpnStatus` carry only public data), placed in Zustand/renderer state, logged, or included in error messages.
- If secure storage is unavailable, import is **refused** (`secure_storage_unavailable`) rather than writing plaintext.
- `redactWgConfig` / `redactSecret` exist for any diagnostic path; `PrivateKey`/`PresharedKey` are replaced with `[redacted]`.

## IPC security
- Capability-specific channels only: `vpn.getStatus/connect/disconnect/reconnect/importConfig/removeConfig/getServers/selectServer/getSettings/updateSettings/getStatistics` + one-way `vpn.event`.
- Every handler validates input with Zod (`vpnImportSchema`, `vpnServerIdSchema`, `vpnProfileSchema`, `vpnSettingsSchema`). Profile IDs are re-validated in main via `assertSafeProfileId` on every service entry point (rejects `../../etc`).
- Errors are mapped to sanitized, user-facing strings (`friendlyVpnError`). Raw `ENOENT`/paths/stderr/stack traces are never returned to the renderer.

## Authoritative engine + one-way events
- The main-process `VpnService` owns all state. The renderer is a pure projection updated via throttle-free `vpn.event` status snapshots. The renderer can request transitions but never decides `PROTECTED`.
- `PROTECTED` is only reachable through the state machine's `connecting -> established` edge, and `established` is only emitted after `verifyHealth` sees real handshake evidence from the interface. There is no `off -> protected` edge.

## Profile isolation
- Servers + settings persist per profile (`<profileDir>/vpn.json`, atomic). Secrets are namespaced per profile+server. Runtime state and stats are keyed per profile. Tests assert no cross-profile secret or config leakage.

## Private mode
- A WireGuard tunnel is **system-level** (below Chromium), so private windows inherit the system route when a tunnel is active. NEXA does **not** create separate private VPN secrets or persist any private VPN state. Health stats are in-memory and not persisted per browsing session.

## No silent data transmission
- P4 makes **no outbound network requests** of its own. No browsing URLs, no public-IP lookups, no telemetry. (Public-IP verification is intentionally not performed → `unknown`.) The only network activity is the WireGuard tunnel itself, initiated by the user.

## Failure safety
- Every native op is wrapped; failures produce an explicit `error` state with a sanitized message, and `connect` always attempts `down` teardown so no orphan interface is left.
- Operations are serialized (`busy` guard + state-machine transition guards) to prevent concurrent connect/disconnect races, reconnect loops, or duplicate tunnels.
- Sleep/wake (`powerMonitor 'resume'`) and network changes trigger `revalidate`, which re-probes health and downgrades to `error` instead of trusting a stale `PROTECTED`.
- On app exit, `shutdown()` tears down tunnels for profiles with `disconnectOnExit` (default on) so no unmanaged tunnel is left running.

## Honest capability reporting
`killSwitch.enforced=false` (EXPERIMENTAL), `dnsVerified='unknown'` (UNVERIFIED), `publicIpVerified='unknown'`, WebRTC mitigation NOT CONFIGURED, malicious/provider integrations NOT CONFIGURED. These are surfaced in the UI and never collapsed into a single "VPN Protected: YES".
