# NEXA P4 — WireGuard VPN Engine · Implementation Audit

**Date:** 2026-09-15 · **Phase:** P4 · **Rule:** never fake VPN. If a real, verified tunnel cannot be established, surface `NOT_CONFIGURED` / `EXPERIMENTAL` / `ERROR` — never `PROTECTED`.

## 1. Existing VPN/network-related architecture
- Pure placeholder today: `App.tsx` `VpnPanel` (toolbar popover) + `VpnPicker` (fake country list from `catalogs.ts VPN_COUNTRIES`), `Settings.tsx VpnSettings` (toggles `killSwitch/dns/webrtc/ipv6/systemVpn` bound to `prefs.vpnToggles`), status bar shows `VPN · not configured`. All honestly labeled "REQUIRES NATIVE MODULE / NEVER SHOWN AS PROTECTED".
- `types.ts`: `VpnStatus = 'not_configured'|'off'|'connecting'|'protected'|'error'`, `VpnToggles`, `prefs.vpnToggles`. Store: `vpnLoc`, `vpnQuery`, overlays `vpn`/`vpnPicker`.
- **No real networking, no WireGuard, no tunnel code exists.** Nothing to preserve except UI shell + honest labeling philosophy.

## 2. Existing PlatformAdapter architecture
- `src/platform/{index,types}.ts` + `macos/windows/linux`. `createPlatformAdapter(process.platform)` returns a `PlatformAdapter` (`kind`, `appDataDir`, `profileDir`, `downloadsDir`, `notify`, `openPath`). Clean seam — P4 adds a parallel **`VpnPlatformAdapter`** family (`createVpnPlatformAdapter`) so no `process.platform ===` checks leak into the service.

## 3. Existing secure-storage architecture
- `src/main/services/secure-storage.ts` — `SecureStorage` over Electron `safeStorage` (OS-backed: Keychain/DPAPI/secret-service), keyed string map at `userData/secure/secrets.bin.json` (0600). Main-process only. **Reused for WireGuard private/preshared keys** under keys `vpn:<profileId>:<serverId>:priv|psk`. No new secret store.

## 4. Existing IPC architecture
- `src/shared/channels.ts` (names), `src/shared/ipc.ts` (Zod schemas + `ok`/`safeError`), `register.ts` (`ipcMain.handle` + `wrap` mapping thrown codes → sanitized errors). Preload exposes capability-specific namespaces on `window.nexa`; renderer subscribes to one-way `*.event` channels. P4 follows this exactly (`vpn.*` + `vpn.event`).

## 5. Existing profile / private-mode architecture
- Per-profile dirs via `persist.profileDir(id)`, atomic JSON via `fs-atomic`. `assertSafeProfileId` re-validates every ID in main. Private browsing = `nexa-private-<id>` partitions (network only). VPN is **system-level** (below Chromium) so it is **profile-scoped configuration** but a single OS tunnel; private windows inherit the system route. VPN config/secrets stored per profile; private windows never create separate persistent VPN secrets/stats.

## 6. P2/P3 interactions
- P2 downloads (`will-download`) and P3 protection (`onBeforeRequest`) operate at the Chromium session layer. A system WireGuard tunnel is **below** Chromium, so it is orthogonal: P3 still decides ALLOW/BLOCK, P4 decides ROUTE/TUNNEL. No shared state; VPN service is separate (`vpn.ts`), never merged into protection.

## 7. Candidate WireGuard implementation
- **Kernel/native WireGuard + `wg`/`wg-quick` userspace tools** (or `wireguard-go`). NEXA shells out via `execFile` (argument arrays, never a shell string) for detection (`wg --version`) and, where privileged, tunnel up/down. See `NEXA_P4_WIREGUARD_DEPENDENCY_AUDIT.md`. No JS crypto reimplementation; no bundled binary in P4.

## 8. Platform feasibility (see `NEXA_P4_PLATFORM_MATRIX.md`)
- Detection of WireGuard tooling: real & unprivileged on all three OSes.
- Tunnel creation, routes, DNS, kill switch: require **elevated privileges / a privileged helper** not present in this sandbox → implemented but surfaced as `EXPERIMENTAL` and **not executed** here.

## 9. Required native dependencies
- External `wireguard-tools` (`wg`, `wg-quick`) or platform WireGuard. **Not bundled**; NEXA detects and reports availability. No npm native module added.

## 10. Risks
- Privilege escalation (must never run a shell; must never pass config via shell). Mitigated: `execFile` + arg arrays + temp config file `0600`, no interpolation.
- Faking protection. Mitigated: strict state machine + health verification gate before `PROTECTED`; capability detection gates the whole feature.
- Secret leakage. Mitigated: keys only in `SecureStorage`, never in renderer/IPC/logs; redaction helper.
- Orphan interfaces. Mitigated: serialized operations + explicit teardown + cleanup on dispose.

## 11. Proposed file changes
- New: `src/shared/vpn.ts` (types, WG parser/validator, state machine, redaction, backoff, error mapping, Zod).
- New: `src/main/services/vpn.ts` (VpnService), `src/main/services/vpn-platform/{index,base,macos,windows,linux}.ts`, `.../fake.ts` (test adapter).
- Edit: `channels.ts`, `ipc.ts`, `register.ts`, `preload/index.ts`, `main/index.ts`, `renderer nexa.d.ts`, `state/store.ts`, `App.tsx` (toolbar/popover/palette), `views/Settings.tsx` (VpnSettings), `views/NewTab.tsx` (widget).
- New tests: `tests/unit/vpn-pure.test.ts`, `tests/unit/vpn-service.test.ts`.

## 12. Implementation sequence
audit → shared types+parser+state machine → platform abstraction + real detection adapters + fake adapter → VpnService (lifecycle/serialization/health/secrets/persistence/events) → IPC/preload → store → UI (toolbar/popover/settings/palette/widget) → tests → regression → final audit. Typecheck/tests after each major stage.
