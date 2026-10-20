# Executive Summary

**Final decision: `RC4_BLOCKED_TOOLCHAIN`**

Release signing and notarization were **not executed**. Full Xcode is not installed. A Developer ID Application identity is not available. Notarization credentials are unset. No DMG or ZIP was produced. Gatekeeper was not assessed. No security source was changed. No product feature was changed. Release attestation is **not provided**.

Also recorded as independent prerequisites:

- `FULL_XCODE_REQUIRED`
- `DEVELOPER_ID_APPLICATION_REQUIRED`
- `NOTARIZATION_CREDENTIALS_REQUIRED`
- Stapling: `STAPLING_TOOLCHAIN_BLOCKED`

# Environment

| Item | Value |
| --- | --- |
| macOS | 27.0 (26A428) |
| Architecture | arm64 |
| Node | v24.17.0 |
| npm | 11.13.0 |
| electron-builder | 26.15.3 |
| Electron (package) | 44.4.1 |
| Product version | 0.1.0 |

# Toolchain

| Tool | Status |
| --- | --- |
| xcode-select | `/Library/Developer/CommandLineTools` |
| Full Xcode.app | Absent under `/Applications` |
| xcodebuild | Unusable without full Xcode |
| stapler | Present; unusable without full Xcode |
| notarytool | Available: 1.1.3 (42) via Command Line Tools |
| codesign | `/usr/bin/codesign` |
| security | `/usr/bin/security` |
| spctl | `/usr/sbin/spctl` |
| hdiutil | Present |
| ditto | Present |
| productbuild | Present |

Phase A rule applied: only Command Line Tools are selected → **do not continue to release signing**.

# Source Identity

**SOURCE_COMMIT_UNAVAILABLE**

No `.git` directory. No `SOURCE_COMMIT` file. No commit hash was invented. Package version `0.1.0` is the only legitimate version identity recorded. Build timestamp for this report generation is recorded in the companion JSON. No release artifact hash exists because no release artifact was produced.

# Signing Identity

| Requirement | Result |
| --- | --- |
| Developer ID Application | **Absent** → `DEVELOPER_ID_APPLICATION_REQUIRED` |
| Available identity | Apple Development only |
| Used for release | **No** |
| Adhoc used for release | **No** |
| CSC_LINK / CSC_NAME / CSC_KEY_PASSWORD | unset |

Phase B rule applied: stop before release signing. The Apple Development identity was not substituted.

# Entitlements

File: `build/entitlements.mac.plist` (also used as `entitlementsInherit`).

| Key | Purpose | Required for Electron HR | Already present | Added this phase |
| --- | --- | --- | --- | --- |
| `com.apple.security.cs.allow-jit` | V8/Chromium JIT under Hardened Runtime | Yes | Yes | No |
| `com.apple.security.cs.allow-unsigned-executable-memory` | JIT companion under Hardened Runtime | Yes | Yes | No |
| `com.apple.security.cs.allow-dyld-environment-variables` | Electron framework DYLD loading | Yes for Electron packaging | Yes | No |
| `com.apple.security.cs.disable-library-validation` | Load Electron-signed framework libraries | Yes for Electron packaging | Yes | No |

No new privileged entitlements were added. Hardened runtime was not disabled.

# Electron Nested Components

No release `.app` exists on disk. Inventory below is from the installed Electron 44.4.1 reference bundle under `node_modules/electron/dist/Electron.app` and documents what a later sealed NEXA.app must sign. It is **not** a signed release artifact.

| Component | Present in Electron dist |
| --- | --- |
| Electron Framework.framework | Yes |
| Electron Helper.app | Yes |
| Electron Helper (Renderer).app | Yes |
| Electron Helper (GPU).app | Yes |
| Electron Helper (Plugin).app | Yes |
| Mantle / ReactiveObjC / Squirrel frameworks | Yes |
| libffmpeg.dylib / libvk_swiftshader.dylib | Yes |

When a later RC produces a NEXA.app, electron-builder must sign the main executable and these nested helpers/frameworks. Nested signatures were **not** verified on a release artifact in this phase.

# Build Validation

Release packaging was not started. Quality gates were therefore not re-run in this phase.

Last known automated baseline from prior RC work (unchanged by this phase):

- `scripts/rc1-validate.sh`: 17 passed, 0 failed
- `npm test`: 746/746
- typecheck / lint / build: PASS

# Release Artifacts

| Artifact | Status |
| --- | --- |
| `dist/mac-arm64/NEXA.app` | Absent |
| DMG | Absent |
| ZIP | Absent |

`npm run package:mac` was **not** invoked.

# Code Signature Verification

**BLOCKED** — no release artifact to verify. Signing was not executed.

# Artifact Hashes

**BLOCKED** — no release DMG/ZIP/app produced. Historical RC-2 Mach-O hash is not reused as a new release hash.

# Notarization

**BLOCKED** — `NOTARIZATION_CREDENTIALS_REQUIRED`.

All of `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE` are unset. Values were not printed. No submission was made. No unsigned or adhoc artifact was submitted.

# Stapling

**STAPLING_TOOLCHAIN_BLOCKED** — stapler requires full Xcode; no notarized artifact exists.

# Gatekeeper

**BLOCKED** — no sealed, notarized release artifact. Gatekeeper was not disabled. Quarantine was not removed as a workaround. No PASS claimed.

# DMG Verification

**BLOCKED** — no DMG produced.

# ZIP Verification

**BLOCKED** — no ZIP produced.

# Security Preservation

| Control | Status |
| --- | --- |
| SEC-1 | UNCHANGED |
| Profile isolation | UNCHANGED |
| Private persistence | UNCHANGED |
| Extension host restrictions | UNCHANGED |
| Debugger denial | UNCHANGED |
| Scheme rejection | UNCHANGED |
| Traversal protection | UNCHANGED |
| Clipboard clearing | UNCHANGED |
| Cookie isolation | UNCHANGED |

No application security source was modified. No product feature was modified. WireGuard, OAuth, Drive, Ollama, OpenAI, Anthropic, UI, and permission architecture were not worked on.

# Signing configuration review (Phase C)

`electron-builder.yml` already supports the intended release path when a Developer ID identity and notarization credentials exist:

- targets: `dmg`, `zip`
- `hardenedRuntime: true`
- entitlements / entitlementsInherit: `build/entitlements.mac.plist`
- `gatekeeperAssess: false` (skips electron-builder’s packaging-time assessment only; does not disable OS Gatekeeper)
- identity not pinned in the file (keychain / `CSC_*` expected)
- appId: `org.nexa.browser`
- architecture: host arm64 via `package:mac`

No configuration patch was required for this stop. No blind modification was made.

# Remaining Blockers

1. Install full Xcode and point `xcode-select` at it (`FULL_XCODE_REQUIRED`).
2. Obtain a Developer ID Application certificate through Apple Developer (`DEVELOPER_ID_APPLICATION_REQUIRED`). Do not use Apple Development or adhoc.
3. Configure notarization credentials outside source (`NOTARIZATION_CREDENTIALS_REQUIRED`).
4. Only then, in a later authorized phase: run existing `npm run package:mac`, verify nested signatures, notarize, staple, then `codesign --verify --deep --strict` and `spctl`.

# Final Decision

**RC4_BLOCKED_TOOLCHAIN**

`RC4_RELEASE_ARTIFACT_READY_FOR_RC5` was not reached. Building alone, codesign alone, or a notary submission alone would not have been enough even if attempted; none of those steps were validly started.
