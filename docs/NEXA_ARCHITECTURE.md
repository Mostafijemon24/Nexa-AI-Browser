# NEXA Architecture (target)

## Recommended stack
Chromium desktop shell — **Electron or Tauri** — + **React + TypeScript** renderer.
One codebase, one design system, three platform outputs. Preserve the prototype's
component structure and visual language; replace its in-page state with real services
behind a typed IPC boundary.

## Layered architecture
```
Web Content (untrusted)
  ↓ renderer sandbox
NEXA UI (React) ── design system / tokens
  ↓ typed, validated IPC (security boundary)
Browser Core + Native Services
  ├── Download Engine (segmented, resumable)
  ├── Cloud Transfer (provider SDKs, OAuth)
  ├── AI Service (provider abstraction; local default)
  ├── VPN / Network Layer (WireGuard/OpenVPN/proxy)
  ├── Content Protection Engine (filter lists)
  ├── Password Vault Service (AES-GCM + OS keychain)
  ├── Profile / Workspace Service (isolation)
  ├── Extension Host (Chromium APIs, sandboxed)
  ├── Settings / Theme Service (persistence)
  └── Update Service (signed)
  ↓
OS: keychain · filesystem · network · notifications · window
```

## Platform abstraction
`PlatformAdapter` interface → `WindowsPlatformAdapter` / `MacOSPlatformAdapter` /
`LinuxPlatformAdapter`. Covers: app-data dirs, secure credential storage, notifications,
window mgmt, native menus, keyboard-shortcut mapping, system proxy, downloads dir,
startup, auto-update, code signing, OS auth, clipboard, deep links, protocol/default-browser
registration. UI must contain **no** OS-specific business logic. Never hardcode paths
(`C:\Users`, `/Users`, `/home`) — use platform APIs; support Unicode/spaces/localized homes.

## State model (single source of truth)
```
AppState
├── ProfileState (active profile, isolation)
├── WorkspaceState
├── TabState / SessionState
├── BookmarkState · HistoryState
├── DownloadState
├── CloudState · AIState · VPNState
├── ExtensionState
├── SettingsState · ThemeState
└── SecurityState (vaultLocked, telemetry, dataSharing, dns, permissions)
```
Each slice: read / write / persist / restore / validate. Profile-scoped vs global data
must be separated (see prototype's `PERSIST_KEYS` + per-profile `nexa-vault-<id>`).
Home/Settings/Profile-menu/Command-palette must read & write the **same** state — the
prototype already enforces this; do not fork logic per entry point.

## IPC security
Narrow, typed, validated, permission-aware, auditable. Expose capabilities like
`passwordManager.saveCredential`, `download.setDirectory`, not generic `readFile(anyPath)`
/ `executeCommand`. Validate profile IDs server-side (never trust renderer). Return safe
errors (no keys/paths/stack traces to the renderer).

## Persistence
Per data category define owner, scope (profile vs global), format, encryption requirement,
migration, backup, deletion. Prototype maps cleanly: settings/theme/profiles/dashboard →
profile prefs; vault → encrypted per-profile blob; window/header state → global.

## Source organization (adapt to existing repo; don't mass-rewrite)
`/core /browser /ui /components /design-system /platform{win,mac,linux} /services{downloads,cloud,vpn,security,password-manager,ai,extensions} /profiles /workspaces /bookmarks /settings /themes /tests{unit,e2e} /build /packaging /docs`.
