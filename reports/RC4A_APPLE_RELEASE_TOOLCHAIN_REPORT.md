# Executive Summary

**RC4A_STATUS: `RC4A_BLOCKED_MULTIPLE_PREREQUISITES`**

RC-4A verified the release environment and did **not** build, sign, notarize, or staple anything. Full Xcode is missing. A Developer ID Application identity is missing. Notarization credentials are unset. Packaging configuration remains ready. Quality baseline remains green. No security source and no product feature were changed.

This is not RELEASE_READY, NOTARIZED, or GATEKEEPER_VERIFIED.

# macOS Environment

| Item | Value |
| --- | --- |
| macOS | 27.0 (26A428) |
| Architecture | arm64 |
| Product | NEXA 0.1.0 |
| Electron | 44.4.1 |

# Xcode

**Status: `RC4A_BLOCKED_XCODE`**

| Check | Result |
| --- | --- |
| `/Applications/Xcode.app` | Absent |
| xcode-select | `/Library/Developer/CommandLineTools` |
| xcodebuild | Unusable — requires full Xcode |
| License / first-launch check | Not usable without full Xcode |
| Xcode version | Not available |
| Installed by this phase | No — official interactive install is required |

Release signing must not continue until `xcode-select` points at the installed full Xcode developer directory (typically `/Applications/Xcode.app/Contents/Developer`, only after that path actually exists).

Operator action: install official full Xcode, then:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -checkFirstLaunchStatus
```

Do not bypass licensing.

# Code Signing Identity

**Status: `RC4A_BLOCKED_DEVELOPER_ID` / `DEVELOPER_ID_APPLICATION_REQUIRED`**

| Check | Result |
| --- | --- |
| Developer ID Application | Absent |
| Available identity | Apple Development only |
| Used as release identity | No |
| Adhoc used | No |
| Fake certificate created | No |
| CSC_LINK / CSC_NAME | unset |
| Private key printed/exported | No |

Operator action: obtain a legitimate **Developer ID Application** certificate through the authorized Apple Developer account, install it into the signing keychain, then verify the public identity only:

```bash
security find-identity -v -p codesigning
```

# Keychain State

- One valid codesigning identity exists (Apple Development).
- No Developer ID Application identity is present.
- Private-key material was not inspected, printed, or exported.
- CI signing secrets were not implemented in this phase.

# Notarization Credential Readiness

**Status: `NOTARIZATION_CREDENTIALS_PENDING` / `RC4A_BLOCKED_NOTARIZATION_CREDENTIALS`**

Checked by name only. Values were not printed. All unset:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (preferred)
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`

Credentials were not requested through chat, not written to source, reports, or logs, and not submitted to Apple.

Documented strategy for a later phase: use whichever approved mechanism the operator already uses for this project; prefer App Store Connect API key outside the repository.

# Stapler

| Check | Result |
| --- | --- |
| `stapler` on PATH | Yes (`/usr/bin/stapler`) |
| Usable through full Xcode | No — requires Xcode developer directory |
| Stapled anything | No |
| Fake ticket created | No |

Expected later state after full Xcode: `STAPLER_TOOL_AVAILABLE`. Current state: present but unusable.

# Gatekeeper Tooling

| Check | Result |
| --- | --- |
| `spctl` | Available (`/usr/sbin/spctl`) |
| Gatekeeper disabled | No |
| Quarantine removed | No |
| Release artifact assessed | No |

Tool availability only. No adhoc/development artifact was treated as release-ready.

# Electron Builder Configuration

**Status: `CONFIGURATION_READY`**

Read-only inspection of `electron-builder.yml`. Not modified.

| Setting | Value |
| --- | --- |
| Targets | `dmg`, `zip` |
| hardenedRuntime | `true` |
| entitlements | `build/entitlements.mac.plist` |
| entitlementsInherit | `build/entitlements.mac.plist` |
| Identity pinned in file | No — expects keychain / `CSC_*` when available |
| gatekeeperAssess | `false` (packaging-time only; not an OS Gatekeeper disable) |
| Architecture | arm64 host via existing `package:mac` |

Entitlements unchanged (JIT / unsigned executable memory / DYLD env / disable-library-validation). No new privileged entitlements.

# Quality Baseline

`package:mac` was **not** run. No DMG/ZIP/release `.app` was generated.

| Command | Result |
| --- | --- |
| `bash scripts/rc1-validate.sh` | 17 passed, 0 failed |
| `npm test` | 746/746 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |

# Source Identity

**SOURCE_COMMIT_UNAVAILABLE**

No `.git` directory. Git was not initialized. No fake commit was created.

# Security Preservation

| Control | Status |
| --- | --- |
| SEC-1 deny-by-default | UNCHANGED |
| Profile isolation | UNCHANGED |
| Private persistence | UNCHANGED |
| Extension restrictions | UNCHANGED |
| Debugger denial | UNCHANGED |
| Scheme restrictions | UNCHANGED |
| Traversal protection | UNCHANGED |
| Clipboard behavior | UNCHANGED |
| Cookie isolation | UNCHANGED |
| Hardened runtime configuration | UNCHANGED |

Application source was not modified. Security source was not modified. UI/architecture were not changed.

# Remaining Blockers

1. Install and select full Xcode (`RC4A_BLOCKED_XCODE`).
2. Obtain Developer ID Application certificate (`RC4A_BLOCKED_DEVELOPER_ID`).
3. Provision notarization credentials outside source (`RC4A_BLOCKED_NOTARIZATION_CREDENTIALS`).

Until all three are resolved, RC-4 must not execute `package:mac`, signing, notarization, stapling, or Gatekeeper release assessment.

# Next Phase

After the operator completes the three blockers above, resume RC-4 release packaging on the existing `package:mac` path only:

clean build → Developer ID signing → nested signature verification → DMG/ZIP → notarization → stapling → Gatekeeper verification.

Do not treat this RC-4A report as release attestation.
