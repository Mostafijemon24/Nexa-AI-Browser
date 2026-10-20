# NEXA Cross-Platform, Build & Release

## One codebase → three coherent apps
Same architecture + design system; platform differences isolated in `PlatformAdapter`
implementations. No platform-specific UI redesign; document acceptable native differences
(window chrome, native menus, scrollbars, font rendering, DPI).

## Build matrix
| Platform | Arch | Build | Package | Sign |
|---|---|---|---|---|
| macOS | arm64 | yes | .app / .dmg | yes + notarize |
| macOS | x64 | yes (Chromium baseline permitting) | .app / .dmg | yes + notarize |
| Windows | x64 | yes | .exe / .msi | yes |
| Windows | arm64 | target (baseline permitting) | .exe / .msi | yes |
| Linux | x64 | yes | AppImage + .deb (opt .rpm/Flatpak) | as appropriate |
| Linux | arm64 | target | appropriate | as appropriate |
Do not mark unsupported combos as supported; document Chromium-baseline limits.

## Conceptual commands (use the real toolchain)
`dev` · `test` · `lint` · `typecheck` · `build` · `package:mac|win|linux` · `sign` · `release` · `clean`.

## Installers
- **macOS:** signed .app, .dmg, bundle id, notarization-ready, update-ready.
- **Windows:** signed installer, app identity, Start-Menu entry, optional desktop shortcut, uninstall, upgrade/rollback-safe.
- **Linux:** primary package + desktop entry + icon + MIME/protocol handlers + uninstall + update strategy.

## Default browser & protocols
Optional, explicit user action only — never silent. Register HTTP/HTTPS/HTML/URL per platform.

## Auto-update
Real signed channel with integrity + version verification, rollback, failure recovery,
user preferences. Show actual state; no fake results.

## Window / desktop behavior
Resize, min/max/restore/close, multi-window, native controls, window-state persistence,
last-session restore, crash recovery, HiDPI/Retina, multi-monitor. Test scaling 100/125/150/175/200%.

## CI/CD
Matrix builds (mac/win/linux). Each release runs: lint → typecheck → unit → integration →
security checks → UI/e2e → packaging → installer validation → artifact verification.
Artifacts: `NEXA-macOS-arm64`, `NEXA-macOS-x64`, `NEXA-Windows-x64`, `NEXA-Windows-arm64`,
`NEXA-Linux-x64`, each stamped version/build/commit/platform/arch/channel.

## Versioning & About
SemVer + build metadata. About page shows real NEXA version, build, Chromium version,
platform, arch — never fake numbers.

## App-data isolation
Separate per OS: profile data, cache, downloads metadata, bookmarks, history, settings,
extensions, **vault + encryption metadata**, logs, crash data, temp. Never mix sensitive
data with ordinary cache.
