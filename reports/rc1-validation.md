# NEXA RC-1 runtime validation

Generated: 2026-10-08T17:43:22.845Z

**Decision:** AUTOMATED_PASS_WITH_ENVIRONMENT_BLOCKERS

This harness reuses the existing typed permission, extension, and persistence services. It does not add product features and does not change the security architecture. Environment-only items stay **BLOCKED — ENVIRONMENT**. They are not mocked into PASS.

| Result | Count |
| --- | ---: |
| PASS | 11 |
| FAIL | 0 |
| BLOCKED — ENVIRONMENT | 9 |

Unit suite boundary: default `vitest` include remains `tests/unit/**/*.test.ts`. This harness is outside that include, so the existing **746** unit tests are preserved. `scripts/rc1-validate.sh` still runs lint, typecheck, those tests, and the production build.

| ID | Area | Status | Evidence |
| --- | --- | --- | --- |
| electron-44-pin | Electron 44 runtime | PASS | Installed electron@44.4.1; package.json declares ^44.4.1. |
| electron-44-clipboard-types | Async clipboard | PASS | Electron 44.4.1 type definitions declare clipboard.writeText/readText as Promise-based. Live OS clipboard was not touched. |
| electron-44-binary | Electron 44 runtime | PASS | ELECTRON_RUN_AS_NODE probe of the local Electron binary reported 44.4.1. No window was opened. |
| sec1-deny-by-default | SEC-1 | PASS | isPermissionAllowed grants only clipboard-sanitized-write, notifications, fullscreen, pointerLock; sensitive and unknown permissions return false. |
| sec1-partition-policy | Permission policy | PASS | The same deny-by-default handlers were applied to default, persistent, and private session stand-ins. Origin did not widen any decision. This is the typed policy, not a live Chromium prompt. |
| partition-names | Profile isolation | PASS | persistPartition and privatePartition are distinct; private partitions are not persistent. |
| sec1-production-wiring | SEC-1 | PASS | Production main process applies the policy to defaultSession and both partition kinds, with hardened webPreferences. No security source was modified by this harness. |
| clipboard-async-source-contract | Async clipboard | PASS | Vault copySecret awaits clipboard.writeText, then schedules a 30s readText comparison and clears only if the clipboard still holds that secret. The OS clipboard was not written or read. |
| extension-security-invariants | Extensions | PASS | Injected session recorded allowFileAccess:false on persist install and private enable. Private load is skipped while private is off. file/chrome/javascript host patterns are rejected. debugger is BLOCKED and was not loaded. Profile id traversal is refused. Production source has 6 allowFileAccess:false sites. Live Chromium MV3 load was not performed. |
| profile-disk-isolation | Profile isolation | PASS | Persistence wrote profile A session into its own directory, did not persist the private tab, and profile B does not load that session. Profile id traversal is refused. This is on-disk file isolation, not a live Chromium cookie jar. |
| unit-suite-boundary | Test inventory | PASS | Default vitest include remains tests/unit/**/*.test.ts. This harness is excluded, so it cannot change the existing 746-test count. |
| env-gui | Live GUI | BLOCKED — ENVIRONMENT | Real window interaction, first launch, and page rendering were not executed. Not simulated as PASS. |
| env-gatekeeper | Gatekeeper | BLOCKED — ENVIRONMENT | Gatekeeper first-launch acceptance was not executed. Not simulated as PASS. |
| env-signing | Signing / notarization | BLOCKED — ENVIRONMENT | codesign, notarization, and stapler were not executed. Not simulated as PASS. |
| env-wireguard | Native WireGuard | BLOCKED — ENVIRONMENT | No WireGuard handshake, signed helper, or tunnel was started. NOT_CONFIGURED was not fabricated as PROTECTED. Not simulated as PASS. |
| env-oauth | Live OAuth | BLOCKED — ENVIRONMENT | No OAuth consent, token exchange, or Google sign-in was performed. Not simulated as PASS. |
| env-external | External services | BLOCKED — ENVIRONMENT | Ollama, Google Drive, and a live extension content-script load against example.com were not contacted. Not simulated as PASS. |
| env-os-clipboard | Async clipboard | BLOCKED — ENVIRONMENT | The OS clipboard was not written, read, or observed for the 30-second clear. The source contract is a separate check. Not simulated as PASS. |
| env-chromium-cookies | Profile isolation | BLOCKED — ENVIRONMENT | Live Chromium cookie/cache isolation between partitions was not observed. On-disk profile files are a separate check. Not simulated as PASS. |
| env-permission-prompts | Permission policy | BLOCKED — ENVIRONMENT | A live page geolocation, camera, or display-capture prompt was not observed. Policy decisions are a separate check. Not simulated as PASS. |

## Not counted as PASS

Real GUI interaction, Gatekeeper, signing/notarization, native WireGuard, live OAuth, and external services were not executed. A missing binary, a failed headless Electron probe, or a mock session is not treated as a live runtime PASS.
