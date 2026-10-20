# NEXA — P4 VPN UX & Functional Completion

This document records the VPN **user-experience completion** work layered on top of
the existing P4 / P4.1 / P4.2 architecture. **No VPN architecture was redesigned,
duplicated, or faked.** The backend remains the single authority for VPN state.

---

## 1. Architecture (unchanged, preserved)

```
Renderer (App.tsx / NewTab / Palette)
   ↓ window.nexa.vpn.*  (typed capability API)
Preload capability API
   ↓ typed vpn.* IPC (validated, profile-scoped)
VpnService  ── single source of truth for state
   ↓
HelperVpnAdapter
   ↓
VpnHelperClient (StdioHelperClient)
   ↓
SocketHelperTransport (Unix socket / Named pipe)
   ↓
Privileged VPN Helper
   ↓
WireGuard → OS Network Stack
```

No `VpnServiceV2`, no second engine, no second helper protocol, no renderer-only
state, no hardcoded `PROTECTED`. The renderer only **projects** authoritative
`VpnStatus` events pushed from the main process.

---

## 2. What was added

### 2.1 Single source of UI truth — `src/shared/vpn-ui.ts`
A pure, fully-tested projection function `vpnUiProjection({ state, capability,
hasServers })` that maps the authoritative backend status to:
- a display label (`OFF`, `CONNECTING…`, `PROTECTED`, `DISCONNECTING…`, `ERROR`,
  `NOT CONFIGURED`),
- a tone → design token (`vpnToneColor`),
- the allowed primary action and command-palette actions.

Every VPN surface (toolbar button, status bar, dashboard widget, command palette)
derives from this one function, so they **cannot disagree**. It never manufactures
`PROTECTED`: that label is produced **only** when the backend state is already
`protected`.

### 2.2 Primary VPN toggle (toolbar) — `VpnButton` in `App.tsx`
- Now glanceable: shows a shield icon, a tone-colored status dot, `VPN`, and the
  **current state label** (`PROTECTED`, `CONNECTING`, `OFF`, `ERROR`, `SET UP`…).
- Uses existing NEXA toolbar tokens (height 34, `--surface-2`, `--border`, radius).
- Accessible: `aria-label` announces the state (`VPN protected`, `VPN connecting`,
  `VPN not configured`, …); focus-visible inherited from shell button styles.
- Opens the VPN popover (connect/disconnect without opening Settings).

### 2.3 VPN popover — `VpnPanel` in `App.tsx` (already existed, retained)
Compact popover with per-state content: protected (server, duration, rx/tx,
handshake age, endpoint), error (safe message + Retry), unavailable (WireGuard not
detected), no-server (import config), and connect. No secrets, no raw config, no
socket paths, no stack traces are shown.

### 2.4 Status bar — fixed a real bug
The status bar previously **hardcoded** `VPN · not configured`. It now reflects the
authoritative state via the shared projection (with a tone dot).

### 2.5 Command palette — state-gated
VPN commands are now generated from `projection.commands`:
- `OFF` → **Connect VPN**
- `PROTECTED` → **Disconnect VPN**, **Reconnect VPN**
- `CONNECTING` → **Disconnect VPN** (cancel)
- `ERROR` → **Reconnect VPN**
- `NOT_CONFIGURED` → **Configure VPN**
- Always: **Open VPN Settings**

Actions that cannot execute in the current state are no longer offered.

### 2.6 Dashboard widget — `NewTab.tsx`
The home widget blurb now derives from the same projection and clicking opens the
same popover — one authoritative state source.

### 2.7 Settings → VPN diagnostics (from P4.2, retained)
Native diagnostics rows (WireGuard, Helper, Helper version, Transport, Tunnel,
Handshake, Routing, DNS, IPv6, Kill switch, Native test) surface honest values for
later native validation. No secrets exposed.

---

## 3. State machine & handshake gating (unchanged)

The projection can never move the UI to `PROTECTED`; only the backend
`VpnService`/`HelperVpnAdapter` transition to `protected`, and only after a verified
WireGuard handshake. The UI is strictly a reflection of pushed state events.

Guards proven in `tests/unit/vpn-ui.test.ts`:
- No projected state other than backend `protected` yields the `PROTECTED` label.
- `canConnect` and `canDisconnect` are never simultaneously true.
- `CONNECTING`/`DISCONNECTING` are busy and guard duplicate actions.

Backend guards remain proven in `vpn-service.test.ts` and
`vpn-helper-integration.test.ts` (handshake-timeout → `ERROR`, no fake `PROTECTED`,
transactional rollback, profile isolation, secret redaction).

---

## 4. Security model
- Toggle uses only the existing typed `window.nexa.vpn.*` capability → main process.
- No renderer-only state; no fake fallback; no `isDev`/`localhost` production path.
- No private keys, raw config, or socket paths in renderer/logs.
- Profile-scoped calls; main process revalidates profile IDs (unchanged).

Security grep of the new UI path (`vpn-ui.ts`) for `isDev|localhost|fake|mock|
hardcoded|exec(|sudo|osascript|powershell|child_process`: **no matches**. The word
`PROTECTED` appears only as a display label gated on backend state.

---

## 5. Native validation status

**Unchanged and honest.** The environment still lacks WireGuard, root/Admin, a
signed helper, a signing identity, and a real endpoint. Native validation remains:

```
P4.2 Native Validation Gate = BLOCKED — ENVIRONMENT
```

No native result was converted to `PASS`. See `NEXA_P4_2_NATIVE_VALIDATION_FINAL.md`.

---

## 6. Known limitations
- Server selector shows only real configured profiles; no fabricated
  countries/latency/quality.
- Kill switch / DNS / IPv6 statuses shown with honest labels (EXPERIMENTAL /
  UNVERIFIED) reflecting real backend capability.
- Native tunnel remains **NOT EXECUTED** in this environment.
