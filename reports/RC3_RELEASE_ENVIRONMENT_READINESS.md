# RC-3 release environment readiness

RC-3 status: **RC3_READINESS_PLAN_COMPLETE**

This phase is a read-only plan. Nothing was installed, signed, notarized, packaged, or deployed. No security source was changed. No product feature was changed. No credentials were written. No fake PASS was created.

Current release evidence status remains **AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS**. This document does not say the release is ready, certified, or fully verified.

# Release toolchain

| Item | Observed |
| --- | --- |
| macOS | 27.0 (26A428), arm64 |
| xcode-select | `/Library/Developer/CommandLineTools` |
| Full Xcode | Not active. `xcodebuild` and `stapler` fail because the developer directory is Command Line Tools |
| codesign | `/usr/bin/codesign` |
| spctl | `/usr/sbin/spctl` |
| notarytool | `/Library/Developer/CommandLineTools/usr/bin/notarytool` |
| stapler | On PATH, unusable until full Xcode is selected |
| Packager | electron-builder via `electron-builder.yml`. No electron-forge |
| Scripts | `package`, `package:mac`, `package:win`, `package:linux` |
| CI | `.github/workflows/ci.yml` on `ubuntu-latest`: checkout, `npm ci`, typecheck, test, gitleaks. No macOS runner, no signing, no notarization |

Credential environment variables checked by name only. All unset: `CSC_LINK`, `CSC_NAME`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`, `NEXA_GOOGLE_CLIENT_ID`, `NEXA_GOOGLE_CLIENT_SECRET`. Contents were not printed.

# Signing

**CONFIGURED** is not **ACTUALLY SIGNED**.

Configured in `electron-builder.yml`:

- `hardenedRuntime: true`
- `entitlements` and `entitlementsInherit`: `build/entitlements.mac.plist`
- mac targets: DMG and ZIP
- signing identity not pinned in the file; electron-builder searches the keychain and skips signing when no identity is found
- `gatekeeperAssess: false` only skips electron-builder's own assessment during packaging. It is not an OS Gatekeeper disable, and it is not a Gatekeeper PASS

Entitlements present, and inert without a Developer ID signature:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.allow-dyld-environment-variables`
- `com.apple.security.cs.disable-library-validation`

These are the existing Electron hardened-runtime set. This plan does not add entitlements.

Keychain identities: one valid codesigning identity, `Apple Development: mostafijemon24@gmail.com (ZP2GWVSQB9)`. The parenthesized value is the team label on that development identity. It is not a Developer ID Application certificate. The Developer ID Certification Authority certificates in the keychain are Apple's CA, not a distribution identity.

Required for distribution:

- Developer ID Application certificate
- same team on the app and any privileged helper
- hardened runtime left on
- existing entitlements inherited by nested Electron helper apps
- electron-builder signing of the main executable, `NEXA Helper`, renderer/GPU/plugin helpers, and frameworks
- a sealed bundle that passes `codesign --verify --deep --strict`

The last observed app was adhoc, TeamIdentifier not set, Info.plist not bound, sealed resources none, and `codesign --verify` failed. That artifact is not on disk in this phase. RC-3 did not rebuild it. The Mach-O SHA-256 `c803dc22bbd4fa3e90c395b43296bda3442c0d1df9d2747985029fa5b1452df2` is historical RC-2 evidence only.

# Gatekeeper

Do not call Gatekeeper PASS on the adhoc artifact.

Chain required before `spctl` can mean anything:

1. Developer ID Application signature
2. sealed `.app`, including nested Electron helpers and frameworks
3. notarization accepted for the distributed archive
4. staple, or an online notarization ticket
5. `spctl -a -vvv -t install` on that artifact

RC-2 `spctl` failed because the bundle signature had no sealed resources. That is a missing-prerequisite result, not a Gatekeeper PASS. Gatekeeper was not disabled and quarantine was not removed.

# Notarization

Nothing was submitted.

Supported workflow already wired by electron-builder's notarize integration, once a Developer ID signature exists. Activation requires one of:

1. `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (preferred)
2. `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
3. `APPLE_KEYCHAIN` and `APPLE_KEYCHAIN_PROFILE`

`notarytool` is available through Command Line Tools. Stapling is not, until `xcode-select` points at full Xcode. Record the notarytool submission id and the staple result. Do not put Apple credentials in source.

Required package formats for that step: the DMG and/or ZIP produced by `npm run package:mac`, containing the signed `.app`. Entitlements and hardened runtime already configured as above.

# Distributable artifact

Intended macOS outputs, from configuration: both DMG and ZIP, plus the `.app` inside them. RC-2 saw only `dist/mac-arm64/NEXA.app`, no DMG and no ZIP. That directory is not present now. This phase did not generate a replacement.

# Source identity

**SOURCE_COMMIT_UNAVAILABLE**

No `.git` directory. No `SOURCE_COMMIT` file. Package version is `0.1.0`. RC-3 did not initialize a repository and did not invent a commit hash.

# WireGuard

Classification: **READY_FOR_ENVIRONMENT_SETUP**

The client and helper protocol exist in source. The helper is intentionally not in the electron-vite build or electron-builder `files`. No compiled arm64 helper binary is in the tree. `package.json` has no helper build script.

| Contract | Expected |
| --- | --- |
| Socket | `/var/run/nexa-vpn-helper.sock`, mode 0600, created by the helper |
| Binaries | system `wg` and `wg-quick` at `/usr/bin`, `/usr/local/bin`, or `/opt/homebrew/bin`. None are bundled |
| Install | SMAppService privileged helper, documented, not executed |
| Signing | Developer ID Application on app and helper, hardened runtime, notarization, code-signing requirements binding the pair |
| Privilege | helper only; main process is a client |

Do not install an untrusted helper. Do not simulate `PROTECTED`.

# OAuth

Implemented provider: Google Drive desktop flow only. No other OAuth provider was found.

- Redirect: `http://127.0.0.1:<ephemeral-port>/oauth2/callback`
- Only loopback HTTP redirects are accepted
- state is required and compared
- PKCE S256 is used
- a separate OIDC nonce is not implemented
- tokens go to Electron `safeStorage` under `drive:tokens:<profileId>`
- required environment: `NEXA_GOOGLE_CLIENT_ID`; `NEXA_GOOGLE_CLIENT_SECRET` is optional in code
- both are unset

Synthetic environment required later: a Google OAuth client limited to the loopback redirect, plus a synthetic Google account. Credentials stay in the process environment. They do not go into source.

# External services

None of these being down is a core browser failure. Each is optional. Their absence still leaves the matching RC-2 item BLOCKED. RC-3 does not reclassify them as PASS or NOT_APPLICABLE.

| Service | Implemented | Core browser | Gate | Minimum later test |
| --- | --- | --- | --- | --- |
| Ollama | Yes. Fixed `http://127.0.0.1:11434` | No. Offline is an honest state | Default local AI | Service actually responds |
| Google Drive | Yes | No | `NEXA_GOOGLE_CLIENT_ID` | Live loopback OAuth and one metadata call; cancel must not authenticate |
| OpenAI | Yes. `https://api.openai.com` | No | key in safeStorage, or `NOT_CONFIGURED` | Synthetic key, real `GET /v1/models` |
| Anthropic | Yes. `https://api.anthropic.com` | No | key in safeStorage, or `NOT_CONFIGURED` | Synthetic key, real `GET /v1/models` |

Do not fake service responses.

# Permission prompts

NEXA does not implement an OS consent prompt. `applyPermissionPolicy` calls `isPermissionAllowed` and ignores origin.

| Permission | Implemented | OS prompt expected | Allow | Deny | Persistence |
| --- | --- | --- | --- | --- | --- |
| clipboard-sanitized-write, notifications, fullscreen, pointerLock | Yes, auto-allow | No | Granted by policy | Not the configured path | Policy, not an OS database |
| geolocation, media, display-capture, clipboard-read, hid, serial, usb, and the rest of `NEXA_DENIED_SENSITIVE_PERMISSIONS` | Yes, deny-by-default | No prompt is produced by current code | Must not happen | Callback denied | Policy, not an OS database |

A later live test requests these from a real page in the sealed app and records the result. Do not edit the OS permission database. Do not treat the missing prompt as a live allow/deny PASS until that page request is executed.

# GUI, private mode, profile isolation, negative tests

These cannot be executed now. Screen recording did not capture the window in RC-2. Assistive access is denied. The sealed release artifact does not exist.

Operator procedure, later, on the notarized artifact only:

1. Launch `dist/mac-arm64/NEXA.app` from the signed archive. Record version and launch result. Capture the window.
2. Confirm the main window is interactive. Open a new tab. Navigate to an `https` page. Capture that result.
3. Enter private mode. Create a synthetic private marker. Exit private mode. Quit. Relaunch. Confirm the private marker is not restored and the persistent marker is.
4. Create Profile-A and Profile-B with distinct synthetic tab titles. Confirm A does not show B, and B does not show A. Do not use personal accounts.
5. Attempt `file:`, `chrome:`, and `javascript:` only as navigation inputs the product already rejects. Confirm they are not loaded. Do not develop an exploit.
6. Request a denied permission and an allowed permission in a real page. Record grant or deny. Do not bypass the policy.

# Dependency graph

```text
Developer ID Application identity
    -> sealed signed .app including nested Electron helpers
    -> DMG and ZIP
    -> notarization (notarytool)
    -> staple (full Xcode) or online ticket
    -> Gatekeeper spctl assessment

source git commit
    -> source identity for that artifact
    currently SOURCE_COMMIT_UNAVAILABLE

GUI access on that sealed app
    -> private-mode restart test
    -> profile isolation test
    -> negative navigation test
    -> live permission observation

signed helper + system wg/wg-quick
    -> native tunnel
    -> live VPN verification

loopback Google OAuth credentials
    -> live OAuth
    -> Google Drive metadata test

Ollama on 127.0.0.1:11434
    -> optional Ollama verification

synthetic safeStorage keys
    -> optional OpenAI verification
    -> optional Anthropic verification
```

# Security preservation

No remediation step in this plan requires changing SEC-1, profile isolation, private-tab persistence, extension host restrictions, debugger restrictions, `file`/`chrome`/`javascript` rejection, traversal protection, clipboard clearing, or cookie isolation.

**SECURITY_REGRESSION_RISK** was not triggered.

Do not disable Gatekeeper, bypass notarization, turn off hardened runtime, or add entitlements beyond the existing Electron set in order to obtain a PASS.

# Next operator actions

These are not performed in RC-3.

1. Keep source identity as SOURCE_COMMIT_UNAVAILABLE until a real commit exists. Do not invent a hash.
2. Install full Xcode and select it, so stapler works. notarytool is already present.
3. Obtain a Developer ID Application certificate. Do not ship with the Apple Development identity.
4. Supply notarization credentials outside source, preferably the App Store Connect API key set.
5. In a later phase, run the existing `package:mac` path. Expect `.app`, DMG, and ZIP. Verify nested helpers. Record new hashes. Discard the adhoc app as release evidence.
6. Notarize, record the submission id, staple, then run `codesign --verify --deep --strict` and `spctl`. Do not disable Gatekeeper.
7. Grant screen recording and assistive access, then run the GUI procedures above.
8. Build, sign, and install the helper separately, and install system `wg` and `wg-quick`, before any live VPN test.
9. Optional-feature credentials, if those RC-2 items are still in scope: loopback Google OAuth client, synthetic Google account, local Ollama, and synthetic OpenAI/Anthropic keys entered through secure storage.
