# NEXA P4.1 — Privileged Helper Security & Threat Model

## Design invariant
> The privileged helper is a **narrow VPN capability service**, never a generic root/admin execution mechanism. It exposes only the operations in `HELPER_OPS`; there is no `exec`, `shell`, `runAsRoot`, arbitrary path, arbitrary arg, or arbitrary env.

## Privilege boundary
| Component | Trust | Responsibilities | Must NOT |
| --- | --- | --- | --- |
| Renderer (sandbox, `contextIsolation`, `nodeIntegration=false`) | Untrusted | Show state, issue intents via `window.nexa.vpn.*` | Reach helper/socket/pipe/fs/privileged cmds |
| Preload | Bridge | Expose typed capability API only | Pass raw objects |
| Typed IPC (`vpn.*`) | Validated (Zod) | Carry validated intents to main | — |
| VPN Main Service | Trusted policy | State machine, secrets, authorization, lifecycle | Run privileged OS ops itself |
| `VpnHelperClient` | Trusted | Correlated/timeouted/versioned request/response | Accept renderer input directly |
| **Privileged Helper** | Elevated, minimal | Validate → authorize → single allowlisted `execFile` → verify | Touch browser data, general fs, arbitrary processes |

Renderer → helper is architecturally impossible: the renderer only has the preload capability API; the helper client lives in the main process and is never exposed. Verified by test `never leaks the private key into the renderer-facing status` and by the absence of any helper handle in `preload/`.

## Operation allowlist (only)
`probeWireGuard · bringTunnelUp · bringTunnelDown · queryHandshakeState · enableKillSwitch · disableKillSwitch`. Each has an explicit Zod payload schema, stable error mapping, timeout, and audit-safe logging. Unknown ops → `VPN_UNKNOWN_OPERATION` **before** any OS interaction (test-verified: runner untouched).

## Request validation (defense in depth)
Validated on the client **and re-validated inside the helper** (`validateHelperRequest` in `handleHelperRequest`):
- Interface name allowlist `^nexa[a-z0-9]{1,11}$` (rejects `eth0`, `wg0`, `nexa;rm`, `../nexa`, `nexa$(id)`, oversized).
- CIDR / IP / endpoint / WireGuard key / MTU (1280–1500) / keepalive bounds.
- Strict schemas (`.strict()`) reject unexpected fields.
- Oversize guard (64 KiB) → `VPN_INVALID_REQUEST`.
- Protocol version check → `VPN_HELPER_VERSION_MISMATCH`.

Because config values only ever reach the OS as `execFile` **argument-array** entries / a `0600` temp file consumed by `wg-quick` (never a shell string), shell metacharacters cannot be interpreted. Command/argument injection, path traversal, and TOCTOU on the config path are mitigated (fresh `mkdtemp` per run, immediate removal).

## Secret handling
Private/preshared keys live only in OS secure storage (`safeStorage`) and are loaded main-side at connect time. They cross the boundary **only** in the `bringTunnelUp` payload to the helper, and are:
- never persisted in `vpn.json`, never in renderer/Zustand/props, never in normal IPC to the renderer;
- redacted (`redactHelperRequest`) before any log line — verified by `never writes secrets to the logger`;
- written by the helper to a `0600` temp file with the **minimum** lifetime, in a private `0700` dir, removed immediately in a `finally` (success or failure), path never returned to the renderer.

Threat model: a compromised renderer cannot execute privileged commands, read keys, alter routes/firewall, or start processes — it has no channel to the helper and no secret material. A compromised main process is already game-over for the browser; the helper still constrains it to the six VPN operations (no generic exec), limiting blast radius on the OS network stack.

## Logging
Central redaction; stderr-only in the helper (stdout is the protocol channel). Allowed: lifecycle/failure events with interface name + stable code. Forbidden: keys, full config, temp path contents, raw stderr echoed to the renderer.

## Error model
Stable `VPN_*` codes (`src/shared/vpn-helper.ts`) mapped to safe user messages via `helperErrorMessage`; adapter maps them to the existing `VpnService` codes. Renderer never receives raw stack traces.
