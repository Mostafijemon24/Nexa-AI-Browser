# RC-4 signed release artifact preparation

**RC4_STATUS:** `RC4_BLOCKED_FULL_XCODE_REQUIRED`

Signing was not executed. Notarization was not submitted. Gatekeeper was not assessed. No security source was changed. No product feature was changed. Credentials were not written to source. Adhoc signing was not used. The Apple Development identity was not used as a release signature.

A second independent hard stop was also confirmed: **Developer ID Application certificate is absent** (`RC4_BLOCKED_DEVELOPER_ID_CERTIFICATE`). Fixing only Xcode is not enough.

## Phase A — Environment verification

| Item | Result |
| --- | --- |
| macOS | 27.0 (26A428) |
| Architecture | arm64 |
| xcode-select | `/Library/Developer/CommandLineTools` |
| Full Xcode.app | Not found under `/Applications` |
| xcodebuild | Unusable: requires full Xcode |
| stapler | Present on PATH; unusable until full Xcode is selected |
| notarytool | Available: `/Library/Developer/CommandLineTools/usr/bin/notarytool` version `1.1.3 (42)` |
| codesign | `/usr/bin/codesign` |
| spctl | `/usr/sbin/spctl` |
| security | `/usr/bin/security` |
| Software installed by this phase | None |

Phase A rule: if full Xcode is not installed, **stop signing execution**. That stop was applied.

## Developer ID certificate

| Item | Result |
| --- | --- |
| Developer ID Application | **Absent** |
| Available codesigning identity | `Apple Development: mostafijemon24@gmail.com (ZP2GWVSQB9)` only |
| Usable for release distribution | No |
| CSC_LINK / CSC_NAME / CSC_KEY_PASSWORD | unset |
| Keychain modified | No |
| Certificate requested automatically | No |
| Fake / adhoc / Development identity used for release | No |

Operator action required: obtain a **Developer ID Application** certificate through the legitimate Apple Developer process. Do not use the Apple Development identity for distribution.

## Notarization credentials

Checked by name only. Values were not printed.

| Variable | State |
| --- | --- |
| APPLE_ID | unset |
| APPLE_APP_SPECIFIC_PASSWORD | unset |
| APPLE_TEAM_ID | unset |
| APPLE_API_KEY | unset |
| APPLE_API_KEY_ID | unset |
| APPLE_API_ISSUER | unset |
| APPLE_KEYCHAIN | unset |
| APPLE_KEYCHAIN_PROFILE | unset |

No notarization credential path is configured. Credentials must remain outside source. Notarization was not attempted.

## Artifact state

| Item | Result |
| --- | --- |
| `dist/mac-arm64/NEXA.app` | Absent on disk in this phase |
| DMG | Absent |
| ZIP | Absent |
| Signed release artifact | None |
| Notarized release artifact | None |
| Gatekeeper PASS claimed | No |

Historical RC-2 Mach-O hash remains historical evidence only. It is not a new signed release measurement.

## Claims not made

- Signing: **not PASS**
- Notarization: **not PASS**
- Gatekeeper: **not PASS**
- ENVIRONMENT_VERIFICATION_PASS: **not reached**

## Security preservation

No change to SEC-1, profile isolation, private persistence, extension restrictions, debugger restrictions, scheme restrictions, traversal protections, clipboard security, cookie isolation, hardened runtime, or Gatekeeper OS settings.

## Operator actions required before signing can resume

1. Install full Xcode and point `xcode-select` at it so `xcodebuild` and `stapler` work.
2. Obtain and install a **Developer ID Application** certificate for the distribution team.
3. Configure notarization credentials outside source (preferred: App Store Connect API key set).
4. Only after the above, in a later authorized phase: run the existing `package:mac` path, verify nested helpers, notarize, staple, then run `codesign --verify --deep --strict` and `spctl`.

Machine-readable companion: `reports/rc4-signed-release-preparation.json`.
