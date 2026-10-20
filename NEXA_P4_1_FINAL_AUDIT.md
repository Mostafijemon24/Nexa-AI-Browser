# NEXA P4.1 — Final Audit

## Executive summary
P4.1 adds a **production-grade privileged-helper boundary** to the P4 VPN system. All privileged WireGuard operations now flow through a narrow, allowlisted, validated, versioned helper protocol. The helper is a VPN capability service — not a root/admin shell. `PROTECTED` is still only reachable after a real, verified handshake. Native execution remains **NOT EXECUTED — ENVIRONMENT LIMITATION** (no WireGuard/root/installed helper here); the entire path is proven deterministically via loopback + fake runner.

## Architecture
```
Renderer → Preload (capability API) → typed vpn.* IPC → VpnService (policy/state/secrets/authorization)
  → HelperVpnAdapter (transactional up/down + rollback)
    → VpnHelperClient (correlated · timeout · versioned)
      → [PRIVILEGE BOUNDARY] Privileged Helper (validate → authorize → single execFile → verify)
        → OS network stack → WireGuard
```

## Files changed
- **Added:** `src/shared/vpn-helper.ts`; `src/main/services/vpn-helper/{protocol,handler,client,adapter}.ts`; `src/helper/main.ts`; `tests/unit/{vpn-helper-pure,vpn-helper-handler,vpn-helper-integration}.test.ts`; docs `NEXA_P4_1_*.md`.
- **Modified:** `src/shared/vpn.ts` (added `VpnHelperStatus` + `VpnStatus.helper`); `src/main/services/vpn.ts` (helper client + helper status in `buildStatus`/`detectCapability`); `src/main/index.ts` (wire `HelperVpnAdapter` + `UninstalledHelperClient`); `src/renderer/src/views/Settings.tsx` (native/helper/DNS/kill-switch/IPv6 diagnostics); `tsconfig.node.json` (include `src/helper`).

## Distinctions
- **IMPLEMENTED:** helper architecture, protocol, validation, transactional connect/rollback, health verification, secret handling, redaction, error model, UI status, wiring.
- **VERIFIED (deterministic):** 40 P4.1 tests + 176 total green; typecheck + build clean.
- **NOT VERIFIED (native):** real OS tunnel/routes/DNS/kill switch — environment limitation.
- **NOT CONFIGURED:** installed/signed privileged helper (production step); public-IP verification (privacy).
- **EXPERIMENTAL:** kill switch (helper returns `enforced:false`).

## Acceptance matrix
| Area | Status |
| --- | --- |
| Helper architecture | PASS |
| Helper IPC | PASS |
| Request validation | PASS |
| Privilege minimization | PASS |
| Secret handling | PASS |
| macOS helper | LIMITATION (design/sign documented; not executed) |
| Windows helper | LIMITATION |
| Linux helper | LIMITATION |
| WireGuard tunnel | LIMITATION (implemented; not natively executed) |
| Routing | LIMITATION |
| DNS | EXPERIMENTAL (applied via wg-quick; verification not configured) |
| IPv6 | PASS (block default; AllowedIPs filtered; tested) |
| Kill switch | EXPERIMENTAL |
| Sleep/wake | PASS (powerMonitor revalidate) |
| Network change | PASS (revalidate/poll) |
| Crash recovery | LIMITATION (policy documented below) |
| Signing | LIMITATION (documented) |
| Packaging | LIMITATION (documented) |
| Security tests | PASS |
| P2 regression | PASS |
| P3 regression | PASS |
| P4 regression | PASS |
| Accessibility | PASS (no redesign; labeled controls/diagnostics) |
| Visual QA | PASS (existing design system; honest states) |
| `npm test` | PASS (176/176) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Native smoke test | NOT EXECUTED — ENVIRONMENT LIMITATION |
| Final recommendation | READY WITH LIMITATIONS |

## Crash / shutdown policy
- `disconnectOnExit=true`: `VpnService.shutdown()` tears down active tunnels best-effort. If teardown cannot complete, state is reported accurately (never silently PROTECTED).
- If NEXA crashes while a helper-owned tunnel is active: because no privileged helper is installed in this build, no orphaned system tunnel can be created. In production, the helper owns tunnel lifecycle; on next launch the app re-probes (`queryHandshakeState`) and reconciles (recover or tear down). Kill-switch remaining EXPERIMENTAL means no risk of locking the user out of networking. Policy documented; native behavior NOT EXECUTED here.

## Limitations
1. Native tunnel/routes/DNS/kill switch not executed (no WireGuard/root/helper).
2. Production transport + signed helper installer not wired (documented).
3. Kill switch EXPERIMENTAL; DNS/public-IP verification not configured.
4. Renderer bundle size warning (pre-existing, unrelated to P4.1).

## Final recommendation
**READY WITH LIMITATIONS** — the privilege boundary, protocol, validation, transactional lifecycle, and honest state model are implemented and fully tested; native OS verification awaits an environment with WireGuard + a signed, installed helper.
