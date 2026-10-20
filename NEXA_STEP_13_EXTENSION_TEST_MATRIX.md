# NEXA STEP 13 — Extension Test Matrix

Environment: local dev, Electron 37.10.3. Automated suite: `npm test` →
**41 files / 732 tests passing**. Typecheck + build pass. Live GUI + live
Chromium extension load require a graphical Electron session.

| Area | Scenario | Expected | Actual | Status | Environment |
|------|----------|----------|--------|--------|-------------|
| Manifest | Valid MV3 | valid, PARTIALLY_SUPPORTED | matches | PASS | vitest |
| Manifest | MV2 | UNSUPPORTED, rejected | matches | PASS | vitest |
| Manifest | invalid name/version | errors | matches | PASS | vitest |
| Manifest | MV2-style background | rejected | matches | PASS | vitest |
| Manifest | MV3 service worker | accepted | matches | PASS | vitest |
| Manifest | content script missing/invalid matches | rejected | matches | PASS | vitest |
| Manifest | forbidden permission | BLOCKED | matches | PASS | vitest |
| Manifest | non-object input | safe reject | matches | PASS | vitest |
| Manifest | real `test-extension/manifest.json` | valid MV3 | matches | PASS | vitest |
| Permissions | chrome→NEXA mapping | correct taxonomy | matches | PASS | vitest |
| Permissions | forbidden tracked as blocked | blocked list | matches | PASS | vitest |
| Permissions | high-risk set + labels | correct | matches | PASS | vitest |
| Host | valid http/https/wildcard/`<all_urls>` | accepted | matches | PASS | vitest |
| Host | file/chrome/devtools/javascript/data/ftp | rejected | matches | PASS | vitest |
| Host | malformed host wildcard | rejected | matches | PASS | vitest |
| Host | normalize + track rejected + broad | correct | matches | PASS | vitest |
| Host | URL matching (subdomain/all_urls) | correct | matches | PASS | vitest |
| Risk | BLOCKED/HIGH/MEDIUM/LOW | correct class | matches | PASS | vitest |
| Record | build from manifest (never auto-enabled) | enabled=false | matches | PASS | vitest |
| Record | blocked → BLOCKED lifecycle | correct | matches | PASS | vitest |
| Record | id validation strict | a-p×32 | matches | PASS | vitest |
| Lifecycle | valid/invalid transitions | enforced | matches | PASS | vitest |
| Private | disabled by default; opt-in only | correct | matches | PASS | vitest |
| Store | drop invalid ids/dupes; coerce | correct | matches | PASS | vitest |
| Store | blocked → disabled on read | correct | matches | PASS | vitest |
| Info view | no path; highRisk list | correct | matches | PASS | vitest |
| Service | install validates + loads persist + enabled | ok | matches | PASS | vitest (fake session) |
| Service | reject missing/relative path | error | matches | PASS | vitest |
| Service | reject invalid manifest pre-load | no load | matches | PASS | vitest |
| Service | reject forbidden perms (BLOCKED) | no load | matches | PASS | vitest |
| Profiles | A install not visible in B | isolated | matches | PASS | vitest |
| Profiles | loads into profile partition only | isolated | matches | PASS | vitest |
| Enable | disable removes; re-enable reloads | correct | matches | PASS | vitest |
| Private | opt-in load into private partition | correct | matches | PASS | vitest |
| Remove | clears record + sessions | correct | matches | PASS | vitest |
| Reconcile | applyForProfile reloads enabled | correct | matches | PASS | vitest |
| Site access | mode persists | correct | matches | PASS | vitest |
| Security | core pure (no electron/ipc/fetch/fs) | clean | matches | PASS | vitest guard |
| Security | dangerous host schemes rejected | present | matches | PASS | vitest guard |
| Security | no generic extension IPC bridge | clean | matches | PASS | vitest guard |
| Security | no eval/child_process/shell/exec JS | clean | matches | PASS | vitest guard |
| Security | identity validated main-side; validate-before-load | ordered | matches | PASS | vitest guard |
| Security | private opt-in + existing partitions | present | matches | PASS | vitest guard |
| Security | preload metadata-only bridge | present | matches | PASS | vitest guard |
| Security | Settings UI honest (no fake store/data) | present | matches | PASS | vitest guard |
| Downloads | extension downloads via P2 | design + no 2nd engine | documented | N/A-runtime | design |
| Protection | P3 authoritative over webRequest/DNR | precedence | documented | N/A-runtime | design |
| Service Worker | start/stop/failure/restart | Chromium-managed, failure-isolated | not GUI-run | NOT_CONFIGURED | needs GUI |
| Content script | live injection on example.com | isolated world | not GUI-run | NOT_CONFIGURED | needs GUI |
| Extension action popup | hosted popup render | limitation | documented | PARTIAL | needs GUI |
| GUI | Manager/menu/install/enable/remove across resolutions/themes | visual | not run | NOT_CONFIGURED | needs GUI |
| Real MV3 | install→enable→run→storage→disable→remove | end-to-end | validator+service proven; live load needs GUI | PARTIAL | needs GUI |

## Honest environment notes

- **GUI NOT_CONFIGURED — ENVIRONMENT:** no graphical Electron session available in
  this run; visual and live-runtime scenarios are not claimed as executed.
- The end-to-end path (validate → per-profile session load → enable/disable/
  private/remove/reconcile) is proven via the service tests using a fake
  `session.extensions` provider; the real Electron provider uses the identical
  code path (`allowFileAccess:false`, `persist:nexa-<id>` / `nexa-private-<id>`).
- The shipped `test-extension/` (action + content script + storage + SW) validates
  as MV3 in the automated suite and is ready for live load when a GUI is available.
