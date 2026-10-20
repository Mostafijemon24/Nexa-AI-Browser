# Executive Summary

RC-2 environment verification result: **AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS**.

Two environment-dependent checks were actually executed and passed: OS clipboard clearing, and live Electron Chromium cookie isolation. No executed test failed. Every other required environment check is **BLOCKED**. None of those blocked checks were counted as PASS.

Release evidence status: incomplete. This is not a release attestation.

# RC-1 Baseline

RC-1 decision was AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS: 11 PASS, 0 FAIL, 9 BLOCKED — ENVIRONMENT. Quality gate was 17 passed, 0 failed. Unit tests were 746/746. No product feature and no security source change were part of RC-1. The harness remains under `tests/rc1`. RC-1 did not prove live GUI, Gatekeeper, signing, notarization, WireGuard, OAuth, external services, OS clipboard, Chromium cookies, or permission prompts. RC-2 does not reuse those RC-1 results as live PASS.

# Tested Release Artifact

| Field | Value |
| --- | --- |
| Package version | 0.1.0 (`CFBundleShortVersionString`) |
| Electron | 44.4.1 |
| Git commit | Unavailable. This directory is not a git repository. |
| Packaged state | `dist/mac-arm64/NEXA.app` exists and a process was already running from it. No `.dmg` or `.zip` exists. |
| Bundle id in Info.plist | `org.nexa.browser` |
| Mach-O SHA-256 | `c803dc22bbd4fa3e90c395b43296bda3442c0d1df9d2747985029fa5b1452df2` |
| app.asar SHA-256 | `abeb3f972988056c9ae0d4126647c634d8388b69aedf0ca03894715fc1f2ffd2` |
| Signing identity | Not a Developer ID signature. `codesign` reports adhoc, `TeamIdentifier=not set`, `Info.plist=not bound`, `Sealed Resources=none`. |
| Notarization identifier | None. Stapler could not run. |

The Mach-O hash matches the local Electron binary. `codesign --verify --deep --strict --verbose=2` failed. This app is not a sealed signed release artifact.

# Environment

- OS: Darwin / macOS 27.0 (build 26A428)
- Architecture: arm64
- Node: v24.17.0
- npm: 11.13.0
- Electron package: 44.4.1
- Application build identifier: Info.plist version 0.1.0; no git commit
- Display: WindowServer running, 1920x1080
- Code signing identities: one Apple Development identity only; no Developer ID Application identity
- `CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: unset
- Assistive access: denied to `osascript`
- Window capture: `screencapture` could not create an image from the NEXA window
- No secrets, OAuth credentials, private keys, or personal tokens are recorded in this report

# Live GUI Verification

Status: **BLOCKED**.

A process was already running from `dist/mac-arm64/NEXA.app` (pid 73337). CoreGraphics listed an on-screen window, owner `NEXA`, 1440x900, window id 369, empty title. This phase did not launch that process, did not click it, and did not restart it.

`screencapture -x -l 369` failed with `could not create image from window`. System Events access failed with `osascript is not allowed assistive access`.

Not executed, therefore not PASS: normal controlled launch, rendered UI, interactivity, new tab, navigation, private mode enter/exit, private state after restart, and profile switching.

# Gatekeeper Verification

Status: **BLOCKED**.

`spctl -a -vvv -t install dist/mac-arm64/NEXA.app` returned `code has no resources but signature indicates they must be present`. Gatekeeper acceptance was not demonstrated. Quarantine was not removed and Gatekeeper was not disabled. No `.dmg` or `.zip` exists to assess.

# Code Signing Verification

Status: **BLOCKED**.

Verification was executed on the on-disk app and did not produce a valid release signature:

- `Signature=adhoc`
- `TeamIdentifier=not set`
- `Info.plist=not bound`
- `Sealed Resources=none`
- `codesign --verify --deep --strict --verbose=2` failed
- Only an Apple Development identity is present
- Unsigned distribution is not an accepted release requirement

Configured signing settings in `electron-builder.yml` were not treated as evidence. Release infrastructure was not modified.

# Notarization Verification

Status: **BLOCKED**.

`stapler validate` failed because the active developer directory is Command Line Tools, not Xcode. Notarization credentials are unset. No ticket identifier exists. Absence of a CI mention is not notarization.

# Native WireGuard Verification

Status: **BLOCKED**.

`wg` and `wireguard-go` are not installed. `/var/run/nexa-vpn-helper.sock` is absent. No privileged helper is installed. No connection was requested, and no connected state was simulated.

# Live OAuth Verification

Status: **BLOCKED**.

No OAuth client credentials or synthetic test account were available. No redirect, callback, logout, or cancelled-login flow was executed. No fake token or cookie was injected.

# External Service Verification

| Service | Purpose | Status |
| --- | --- | --- |
| Ollama `127.0.0.1:11434` | Local AI provider | BLOCKED. Endpoint did not connect. |
| Google Drive | Cloud file download via Google OAuth | BLOCKED. No OAuth credentials. No API call. |
| OpenAI | Optional cloud AI provider | BLOCKED. No API key. No API call. |
| Anthropic | Optional cloud AI provider | BLOCKED. No API key. No API call. |

No service was marked PASS because its SDK or source adapter exists. No additional services were invented.

# OS Clipboard Verification

Status: **PASS**.

The production `VaultService.copySecret` path ran inside a real Electron process. Reads used both Electron `clipboard.readText` and `/usr/bin/pbpaste`. The marker was `NEXA_RC2_CLIPBOARD_TEST`. Previous clipboard contents were restored and were not recorded.

| Step | Result |
| --- | --- |
| Write, then read back | Both Electron and `pbpaste` matched, length 23. 2026-09-17T11:39:16Z. |
| Wait 31s with content unchanged | Both reads were empty. |
| Replace clipboard with `NEXA_RC2_CLIPBOARD_EXTERNAL` before the interval | After 31s both reads were still that marker, length 27. 2026-09-17T11:43:01Z. |

A 11:41Z attempt was discarded because another clipboard owner changed the pasteboard during the wait. It was not used as PASS or FAIL. This was not a GUI button click; assistive access was denied.

# Live Chromium Cookie Verification

Status: **PASS**.

Real `session.fromPartition` partitions, isolated `userData`, synthetic `example.com` cookies only:

- `persist:nexa-rc2a` and `persist:nexa-rc2b` did not see each other's cookie in-process or after restart
- After `cookies.flushStore` and a new Electron process, both persistent cookies remained
- `nexa-private-rc2a` cookie was absent after restart even though it had an expiration and `flushStore` was called

The user Application Support directory was not read.

# Permission Prompt Verification

Status: **BLOCKED**.

No OS or browser prompt was shown, allowed, or denied in this phase. Permission databases were not edited. RC-1 deny-by-default results were not reused as a live prompt PASS.

# Private Mode Verification

Status: **BLOCKED**.

The packaged window could not be driven or restarted. The Chromium private-partition cookie result does not complete the GUI private-mode procedure and is not counted here.

# Profile Isolation Verification

Status: **BLOCKED**.

Two synthetic profiles were not switched in the running packaged app. History and bookmarks were not created through the GUI. User profile files were not inspected. Cookie partition isolation is counted only under Chromium cookies.

# Security Negative Tests

Status: **BLOCKED**.

`file:`, `chrome:`, `javascript:`, debugger, packaged-app profile traversal, and live origin widening were not attempted against the running packaged application. No exploit development was performed. No security source was changed.

# Quality Gate

Executed after RC-2 evidence collection. No product or security source was modified to obtain these results.

| Command | Result |
| --- | --- |
| `bash scripts/rc1-validate.sh` | 17 passed, 0 failed, exit 0 |
| `npm test` | 746 passed, 746 total, exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 warnings |
| `npm run build` | exit 0 |

# Evidence Matrix

Machine-readable matrix: `reports/rc2-environment-matrix.json`.

# PASS / FAIL / BLOCKED Counts

Counted from the matrix, independently of RC-1:

| Status | Count |
| --- | ---: |
| PASS | 2 |
| FAIL | 0 |
| BLOCKED | 14 |
| NOT_APPLICABLE | 2 |

BLOCKED is not included in PASS. Unexecuted tests are not included in PASS. No FAIL was relabeled as BLOCKED.

# Remaining Environment Blockers

Each blocked item prevents environment verification completion.

- RC2-GUI: screen recording and assistive access unavailable. Needs a controlled launch and permission to capture and drive the packaged window.
- RC2-GATEKEEPER: no valid signed distributable for `spctl` to assess. Needs a Developer ID-signed, notarized artifact. Release infrastructure.
- RC2-SIGNING: Developer ID identity absent; on-disk app is adhoc and failed verify. Release infrastructure.
- RC2-NOTARIZATION: stapler requires Xcode; notarization credentials unset. Release infrastructure.
- RC2-WIREGUARD: helper socket and WireGuard binaries absent. Environment and release infrastructure.
- RC2-OAUTH: no provider credentials or synthetic account. Access.
- RC2-EXTERNAL-OLLAMA: local service not listening. Environment.
- RC2-EXTERNAL-GOOGLE-DRIVE: no OAuth credentials. Access.
- RC2-EXTERNAL-OPENAI: no API key. Access.
- RC2-EXTERNAL-ANTHROPIC: no API key. Access.
- RC2-PERMISSION-PROMPTS: real prompt could not be produced or observed. Access.
- RC2-PRIVATE-MODE: packaged GUI could not be driven. Access.
- RC2-PROFILE-ISOLATION: packaged profile switching was not executed. Access.
- RC2-NEGATIVE-SECURITY: packaged negative checks were not executed. Access.

NOT_APPLICABLE items (Windows Authenticode, Linux package signing) do not prevent completion of this macOS target, and they do not make the macOS gate complete.

# Security Findings

No executed security invariant failed. No defect was recorded for remediation. No source patch was applied. The unsigned, unsealed app is a release-infrastructure blocker, not a code change from this phase.

# Release Evidence Status

Incomplete. Live clipboard and Chromium cookie evidence exists. Packaged GUI, Gatekeeper, signing, notarization, WireGuard, OAuth, external services, permission prompts, private-mode GUI, profile GUI isolation, and packaged negative tests do not.

# Final Decision

**AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS**

ENVIRONMENT_VERIFICATION_PASS was not reached because applicable environment-dependent tests remain BLOCKED. ENVIRONMENT_VERIFICATION_FAIL was not used because no executed test failed. RC-1 passing does not make the release ready. No release attestation is provided.
