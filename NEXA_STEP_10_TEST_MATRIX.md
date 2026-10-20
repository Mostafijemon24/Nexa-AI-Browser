# NEXA — STEP 10 · Test Matrix

Commands: `npm test` (602 pass), `npm run typecheck` (PASS), `npm run build` (PASS),
`npm run lint` (NOT_CONFIGURED — placeholder script).

## 1. Regional core unit tests — `tests/unit/regional.test.ts` (18)

| Area | Cases |
| --- | --- |
| Timezone validation | accepts UTC/Asia\_Dhaka/Europe\_Berlin/America\_New\_York/Asia\_Tokyo/Australia\_Sydney; rejects `GMT+6`,`Dhaka Time`,`Bangladesh Time`,`foo/bar`,`invalid`,``,`auto`,non-string |
| Timezone offset + registry | `UTC → UTC+00:00`; invalid → null; registry non-empty + contains UTC (no network) |
| Locale validation | accepts en-US/en-GB/bn-BD/de-DE/fr-FR/ja-JP/hi-IN; rejects `en_US`/`english`/`e`/`123`/`en US`/``/`auto`/object |
| Canonicalization | `en-us→en-US`, `BN-bd→bn-BD`, junk→null |
| Languages | normalize+dedupe+bound; Accept-Language q-values with base fallbacks; empty→'' |
| Defaults | system defaults, `'auto'` formats, seeded language |
| Validation | normalizes explicit values; invalid tz/locale → `INVALID_CONFIGURATION` |
| Capability report | Accept-Language + app formatting SUPPORTED; tz/locale PARTIALLY_SUPPORTED; exact Accept-Language string |
| Formatting | deterministic DMY/MDY/YMD at a fixed instant; `1,234.56` (en-US) / `1.234,56` (de-DE) |
| Week/measurement | explicit overrides; locale-derived (en-US→imperial, de-DE→metric) |
| Worker descriptor | bounded, contains tz/locale + "never act without user confirmation"; invalid→'' |

## 2. Source-guard tests — `tests/unit/theme-tokens.test.ts` › "Regional profiles (STEP 10)" (9)

| Guard | Assertion |
| --- | --- |
| Not anti-detection | no navigator.webdriver/getImageData/toDataURL/HTMLCanvasElement/WebGLRenderingContext/getParameter/AudioContext/Math.random/randomizeFingerprint |
| Intl-delegated validation | uses `Intl.DateTimeFormat`+`getCanonicalLocales`+`supportedValuesOf`; no fetch/http |
| Honest capability | tz/locale `PARTIALLY_SUPPORTED`; `INVALID_CONFIGURATION`; UI states Chromium process-global limit + "not fingerprint protection" |
| Capability-specific header API | only `sess.setUserAgent(ua, accept)`; no webRequest/onBeforeSendHeaders/onHeadersReceived/set-all-headers |
| Capability IPC only | `regional.apply` in preload+register; no regional.execute/run/request/browser.execute/eval |
| Active-profile only | register applies `activeProfile`; service `assertSafeProfileId` |
| Profile isolation | store resets `regionalCaps`; re-applies on switch |
| No unsafe primitives | no child_process/execFile/fs.*/executeJavaScript/Date.prototype/Intl reassignment |
| Existing persistence | `persistPrefs`; no localStorage/sessionStorage/indexedDB |

## 3. Regression

`tests/unit/click-to-go.test.ts` updated: "every command maps to a real view, overlay,
panel, **or settings section**" (the new `regional` command uses `settingsSection`).

## 4. Manual / GUI checklist

| Check | Expected |
| --- | --- |
| Settings → Language & Region | dense; searchable tz; locale/lang pickers; reorder/remove; live preview; honest matrix |
| Timezone search | instant, local, `Asia/Dhaka · UTC+06:00` style |
| Language ordering | primary first; Accept-Language preview updates |
| Profile switch | regional state re-applies for the new profile; no leakage |
| Private tab | inherits profile regional config; nothing extra persisted |
| Command Palette / Click-to-Go | Region commands + `timezone`/`language` resolve |
| Privacy Center | Regional Configuration card labeled as config, not protection |
| Light/Dark, reduced motion, keyboard nav | tokens honored; controls focusable/labelled |

## 5. Status

- Automated: **602/602 pass**, typecheck PASS, build PASS.
- Lint: **NOT_CONFIGURED**.
- GUI verification: **NOT_CONFIGURED — ENVIRONMENT** (no display; not claimed as PASS).
