# NEXA — STEP 9 · Test Matrix

Commands: `npm test` (575 pass), `npm run typecheck` (PASS), `npm run build` (PASS),
`npm run lint` (NOT_CONFIGURED — placeholder script).

## 1. Turbo core unit tests — `tests/unit/turbo.test.ts` (15)

| Area | Cases |
| --- | --- |
| State model | `deriveTurboState` OFF/ON/OPTIMIZING/NOT_SUPPORTED; labels contain no "faster/×" |
| URL safety | accepts http(s); rejects `javascript:`,`data:`,`file:`,`chrome:`,`about:`,`vbscript:`,`blob:`,`ftp:`, empty, non-string; `originOf`; `sameOrigin` |
| Sensitive detection | login/checkout/oauth/authorize/reset-password paths, `login.` host, `?token=`, `bank.` host → true; ordinary pages → false; unparseable → sensitive |
| Preconnect policy | returns origin only when enabled + non-private + non-sensitive + safe scheme; else null |
| Prefetch policy | allows same-origin/trusted/non-sensitive; rejects cross-origin, sensitive, untrusted, private, disabled, unsafe scheme |
| Duplicate guard | identical URL within window → true (inclusive of `NAV_DEDUPE_MS-1`, exclusive at boundary); different URL/null → false |
| Classification | Fast/Normal/Slow by best signal (load→DCL→TTFB); missing/0 → Unavailable |
| Perf formatting | `msLabel` ms/s; missing/negative → "Not available"; `summarizePerf` real values + classification; null summary |

## 2. Source-guard tests — `tests/unit/theme-tokens.test.ts` › "Turbo Mode (STEP 9)" (10)

| Guard | Assertion |
| --- | --- |
| No second engine | no Turbo{Download,Http,Cache,Dns,Proxy,Renderer} / cloudRender / remoteChromium; no `turbo.download/fetch/...` bridge |
| Main-authoritative IPC | preload exposes only `turboPreconnect`; register validates active profile + `preconnectTarget` + `session.preconnect` |
| Sensitive/unsafe rejection | sensitive segments + dangerous schemes present in policy; preconnect refuses private/sensitive |
| Private + profile isolation | store skips private tabs; perf not persisted; profile switch resets perf + `lastNav`/`lastPreconnect` |
| Honest state | ON case + "Not available"/"Unavailable"; no `10x/faster/1 second/guaranteed` |
| Duplicate nav | `isDuplicateNavigation(lastNav …)` used; `NAV_DEDUPE_MS` present |
| Fail-open | preconnect is `.catch(() => {})` fire-and-forget |
| Local-only timing | uses standard Performance API; no fetch/XHR/sendBeacon/AI in core |
| No unsafe primitives | no eval/new Function/child_process/execFile/fs.* in core |
| Accessible + reduced-motion | `role="progressbar"`, `aria-label="Page loading"`, `.nav-progress-bar`, `prefers-reduced-motion` |

## 3. Manual / GUI checklist (see §GUI status)

| Check | Expected |
| --- | --- |
| Toolbar `⚡` states | On (fill) / Off (regular) / Optimizing (spins, respects reduced motion) / Not supported |
| Popover | real TTFB/DCL/Load or "Not available"; honest footnote; toggle master |
| Progress bar | appears on `did-start-loading`, clears on stop; no % / ETA; static under reduced motion |
| Address bar | click→focus / type / Enter all instant; no AI/network for normal input |
| Settings → Turbo | master + 3 sub-toggles; sub-toggles greyed when master off; honest copy |
| Command Palette | Turbo On/Off, Open Turbo Settings, Show Last Navigation Performance |
| Click-to-Go | `turbo`/`performance`/`speed` → opens Turbo popover |
| Private tab | no preconnect; no persisted metrics |
| Profile switch | Turbo perf/state reset |
| Light/Dark | tokens honored; sufficient contrast |

## 4. Status

- Automated: **575/575 pass**, typecheck PASS, build PASS.
- Lint: **NOT_CONFIGURED** (repo has no eslint configured).
- GUI verification: **NOT_CONFIGURED — ENVIRONMENT** (no display available; not claimed as PASS).
- Benchmark: **NOT_CONFIGURED — ENVIRONMENT** (methodology documented in the Performance Audit; instrumentation ships in this step).
