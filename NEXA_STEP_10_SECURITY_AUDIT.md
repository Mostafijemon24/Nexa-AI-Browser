# NEXA — STEP 10 · Security Audit (Regional Profiles)

Scope: `src/shared/regional.ts`, `src/main/services/regional.ts`, the `regional.apply`
IPC, store slice, and Settings/Privacy UI. Regional prefs must not weaken any boundary
or become a spoofing/anti-detection mechanism.

## 1. Threat model & findings

| Risk | Mitigation | Verified |
| --- | --- | --- |
| **Arbitrary timezone injection** | `isValidTimeZone` delegates to `Intl.DateTimeFormat` (throws on unknown IANA); `validateRegional` rejects → `INVALID_CONFIGURATION`; nothing applied. | `regional.test.ts`, source guard |
| **Malformed locale / language** | `isValidLocale` = structural regex + `Intl.getCanonicalLocales`; `normalizeLanguages` validates/dedupes/bounds (≤10). | unit tests |
| **Fingerprint spoofing / randomization** | No navigator/webdriver/canvas/WebGL/AudioContext/hardware code; no `Math.random(`; no randomization. Privacy Center audit unchanged + authoritative. | source guard |
| **Unsafe / generic header mutation** | Only `session.setUserAgent(ua, acceptLanguages)` — a capability-specific API. No `webRequest`/`onBeforeSendHeaders`/`onHeadersReceived`, no "set-all-headers". | source guard |
| **Generic execution bridge** | Only `regional.apply({ profileId })` (Zod). No `regional.execute/run/request`, no `browser.execute`. Renderer cannot pass raw headers/URLs/JS. | source guard |
| **Renderer-controlled profile id** | `regionalApplySchema` = `profileIdSchema`; main **ignores** the requested id and applies `loadProfilesIndex().activeProfile`; `assertSafeProfileId` in the service. | source guard |
| **Cross-profile leakage** | Active-profile-only apply; store resets `regionalCaps` on switch and re-applies; prefs are per-profile files. | source guard |
| **Private-mode persistence** | Regional prefs are profile settings (intended). No transient private regional metadata is written to history; capability report is in-memory. | code review |
| **Page-script injection / prototype patching** | No `executeJavaScript`, no `Date.prototype`/`Intl.* =` reassignment. Timezone/locale runtime is left to Chromium (honest PARTIAL). | source guard |
| **Secret leakage** | Regional data carries no secrets; nothing sent to external services or cloud AI. Worker descriptor is a short honest string, local-only. | code review |
| **VPN / kill-switch interaction** | No timezone↔VPN sync; no routing changes. | code review |
| **Performance / DoS** | Timezone registry cached (`_timeZoneCache`); no per-navigation work; `setUserAgent` runs only on apply (startup / switch / change). | code review |

## 2. Preserved invariants

- Sandbox, `contextIsolation`, `nodeIntegration=false`, `webSecurity=true`, CSP — unchanged.
- Typed, Zod-validated IPC — extended by exactly one capability channel (`regional.apply`).
- Persistence uses the existing `saveProfilePrefs` (no second store, no renderer localStorage).
- P2/P3/P4/P5/P7/P8/P9 architectures untouched.

## 3. Honest limitation (per §44)

NEXA cannot override Chromium's **process-global** runtime timezone/locale per session
via a stable, supported API, and JS monkey-patching is disallowed. Those layers are
reported **PARTIALLY_SUPPORTED** and are **not faked**. The only true browser-level
application is the session **Accept-Language** header; everything else is NEXA-owned UI
formatting. This is stated in the Settings UI and the capability report.

## 4. Residual items

- Language registry in the picker is a curated subset; any valid BCP-47 tag is still
  accepted through validation (so the subset is not a security boundary).
- No lint tooling configured (repo `npm run lint` is a placeholder); static checks rely
  on `tsc` + the source-guard suite.
