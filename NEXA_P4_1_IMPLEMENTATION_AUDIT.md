# NEXA P4.1 — Privileged Helper · Implementation Audit

**Date:** 2026-09-16 · Builds on P4. Goal: a real, narrowly-scoped **privileged VPN helper** boundary so native WireGuard ops can run with least privilege — never a generic root shell, never fake `PROTECTED`.

## Audit of current state (source of truth = code)
- **VPN service** `src/main/services/vpn.ts`: state machine (no `off→protected`), serialized lifecycle, health-gated PROTECTED, secrets via `SecretStore`, per-profile `vpn.json`. Accepts an injected `VpnPlatformAdapter` (seam for P4.1).
- **Platform adapters** `src/main/services/vpn-platform/`: `WgQuickAdapter` (macOS/Linux `wg-quick`), `WindowsVpnAdapter`, all `execFile`+arg-arrays+`shell:false`; `buildWgQuickConfig`, `parseWgDump` reusable by the helper. `createVpnPlatformAdapter()` factory.
- **Shared** `src/shared/vpn.ts`: parser/validators (`isValidWgKey/Cidr/Endpoint`, `parseWireGuardConfig`), `friendlyVpnError`, redaction, `VpnStatus`. P4.1 extends `VpnStatus` with a `helper` block.
- **Secure storage** `src/main/services/secure-storage.ts`: OS `safeStorage`. Keys stay main-side; the helper receives them only over the authenticated helper channel (never renderer/JSON/logs).
- **IPC** channels/ipc/register + preload: capability-specific, Zod-validated. Renderer→preload→typed IPC→VpnService only. P4.1 adds **no** renderer→helper path.
- **P4 docs** present (`NEXA_P4_*`). This phase adds `NEXA_P4_1_*`.

## Environment reality (unchanged)
`wg`/`wg-quick` absent, no root/Admin, no installed privileged helper. Therefore native tunnel execution remains **NOT EXECUTED — ENVIRONMENT LIMITATION**. P4.1 delivers the *architecture + protocol + helper logic + client + transactional adapter*, all exercised deterministically via a loopback transport + fake command runner (the strongest possible proof without privilege).

## P4.1 architecture (extends, does not replace)
```
Renderer → Preload → typed vpn.* IPC → VpnService (policy/state/secrets)
   → HelperVpnAdapter (transactional up/down + rollback)
      → VpnHelperClient (authenticated, correlated, versioned, timeout)
         → [privilege boundary] Privileged Helper (allowlisted ops only)
            → execFile(wg/wg-quick, args[], shell:false) → OS → WireGuard
```
- **Operation allowlist (only):** `probeWireGuard`, `bringTunnelUp`, `bringTunnelDown`, `queryHandshakeState`, `enableKillSwitch`, `disableKillSwitch`. No generic exec, no arbitrary paths/args/env/shell.
- **Validation:** every request validated (Zod) at the client *and* re-validated inside the helper handler before any privileged action (interface name allowlist `^nexa[a-z0-9]{1,11}$`, CIDR/IP/endpoint/key/MTU/keepalive, oversize/unknown-op rejection).
- **Secrets:** private/preshared keys travel only main→helper over the helper channel; redacted (`redactHelperRequest`) in all logs; temp config written `0600`, removed immediately, path never exposed.
- **Transaction:** `wg-quick up` performs interface+config+routes+DNS atomically; adapter adds kill-switch (EXPERIMENTAL) + health verify, and rolls back (`bringTunnelDown`) on any failure — no partial success.

## Files added (P4.1)
- `src/shared/vpn-helper.ts` — protocol types, op allowlist, Zod schemas, validation, error codes, redaction.
- `src/main/services/vpn-helper/protocol.ts` — newline-JSON framing + client correlation.
- `src/main/services/vpn-helper/handler.ts` — helper-side `handleHelperRequest(req, deps)` (validate→authorize→execFile plan→verify).
- `src/main/services/vpn-helper/client.ts` — `VpnHelperClient` iface, `StdioHelperClient`, `UninstalledHelperClient`.
- `src/main/services/vpn-helper/adapter.ts` — `HelperVpnAdapter` (implements `VpnPlatformAdapter`, transactional).
- `src/helper/main.ts` — thin real-helper entry (stdio ↔ handler ↔ real execFile). Packaging/signing = documented production step.
- Tests: `vpn-helper-pure`, `vpn-helper-handler`, `vpn-helper-integration`.
- Docs: `NEXA_P4_1_{PRIVILEGED_HELPER_SECURITY,PLATFORM_MATRIX,SIGNING_AND_PACKAGING,NATIVE_SMOKE_TEST,FINAL_AUDIT}.md`.

## Preserved (no regression intended)
Browser shell, tabs/profiles/workspaces, bookmarks/history/collections, P2 downloads, P3 protection, P4 VPN UI/state, design system, IPC/secure-storage/persistence, sandbox flags.
