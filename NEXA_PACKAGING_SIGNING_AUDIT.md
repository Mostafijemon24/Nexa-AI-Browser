# NEXA — Packaging & Signing Readiness Audit

## Packaging configuration (`electron-builder.yml`)

| Field | Value | Status |
|-------|-------|--------|
| appId | `org.nexa.browser` | OK |
| productName | `NEXA` | OK |
| output dir | `dist` | OK |
| files | `out/**/*`, `assets/**/*` | OK — dev fixtures excluded |
| asar | `true` | OK |
| mac target | dmg, zip | OK |
| win target | nsis | OK |
| linux target | AppImage, deb | OK |
| icon | `assets/nexa-icon.png` (all platforms) | PARTIAL — see notes |

### Fixtures / dev-only content
- `test-extension/**` is **not** in `files` → not packaged. Also excluded from lint.
- Build output is the only shipped code (`out/**`). Source, tests, scripts,
  and `build/` are not packaged.
- **REL fix applied:** `package*` scripts now run `npm run clean` first, so a
  stale `out/renderer 2` (observed leftover) or other stale artifacts can never
  be shipped: `clean && build && electron-builder`.
- **REL fix applied:** `app.getInfo().channel` now reports `'stable'` for packaged
  builds (`app.isPackaged`) instead of a hardcoded `'dev'`.

### Icon note (verified OK)
A single PNG is used for all platforms. During an RC-1 `--dir` package attempt,
electron-builder **successfully auto-converted** it to `dist/.icon-icns/icon.icns`
(1.2 MB), so macOS icon generation works. Shipping a native multi-resolution
`.icns`/`.ico` is a nice-to-have for crispness but is **not** required. Non-blocking.

## Privileged VPN helper (separate lifecycle)
`src/helper` (the WireGuard privileged helper) is intentionally **not** part of
the electron-vite build or `electron-builder` `files`. It has its own
build/sign/install lifecycle documented in `NEXA_P4_2_SIGNING_AND_INSTALLER.md`
(unix domain socket / Windows named pipe transport; the client honestly reports
`NOT_CONFIGURED` when no signed helper is installed). Helper signing +
installation is an ENVIRONMENT step, not part of the app bundle.

## macOS signing readiness

| Item | Status |
|------|--------|
| Hardened Runtime | **Ready** — `hardenedRuntime: true` added |
| Entitlements | **Ready** — `build/entitlements.mac.plist` (allow-jit, unsigned-exec-memory, dyld-env, disable-library-validation) |
| `gatekeeperAssess` | set to `false` (standard for CI signing) |
| Developer ID Application cert | **BLOCKED — ENVIRONMENT** (no identity present) |
| Notarization (APPLE_ID / APP-SPECIFIC-PASSWORD / TEAM_ID) | **BLOCKED — ENVIRONMENT** |
| Helper/service signing | **BLOCKED — ENVIRONMENT** (see P4.2 doc) |

The added signing config is **inert without a signing identity**: electron-builder
skips signing when no identity is discovered, so unsigned local packaging still
works. No certificates were invented.

## Windows signing readiness

| Item | Status |
|------|--------|
| NSIS installer target | Configured |
| Authenticode certificate | **BLOCKED — ENVIRONMENT** (no `CSC_LINK`/cert) |
| Installer + helper signing | **BLOCKED — ENVIRONMENT** |

Recommendation: supply `CSC_LINK`/`CSC_KEY_PASSWORD` (or Azure Trusted Signing)
via CI secrets at release time. No config change ships secrets.

## Linux

| Item | Status |
|------|--------|
| AppImage + deb targets | Configured |
| Desktop entry / category | `Network` category set |
| Package integrity (checksums/GPG) | Recommended at publish time (repo/CI) |
| Sandbox | Chromium sandbox relies on the standard SUID/user-namespace setup |

## Verdict
- Packaging config: **PASS WITH LIMITATIONS** (icons PARTIAL; clean-before-package
  and honest channel fixed).
- Signing: **BLOCKED — ENVIRONMENT** on all platforms (no certificates/credentials);
  configuration is release-ready and inert without them.
- A real packaged build could not be produced here (no Electron binary / no
  signing toolchain) → **BLOCKED — ENVIRONMENT**.
