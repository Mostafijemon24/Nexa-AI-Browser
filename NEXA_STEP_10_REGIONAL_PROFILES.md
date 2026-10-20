# NEXA — STEP 10 · Per-Profile Timezone, Locale & Language

Additive, per-profile regional customization: timezone, locale, ordered language
preferences, and NEXA-owned date/time/number formatting. Built on the existing
profile prefs + session architecture. **Legitimate regional preferences only — not
a fingerprint-spoofing / anti-detection system.**

Flow: `Profile prefs.regional → validate (Intl) → Accept-Language (session) + NEXA UI formatting`.

---

## 1. Non-negotiable: not anti-detection

STEP 10 adds **no** navigator/webdriver/canvas/WebGL/AudioContext/hardware spoofing
and **no** fingerprint randomization. Regional values are normal, observable browser
preferences. The Privacy Center fingerprint audit remains authoritative and truthful
(timezone/locale still appear as readable signals). Source-guarded.

## 2. Data model

`ProfileRegionalPreferences` (`src/shared/regional.ts`) ⇔ `RegionalPrefs`
(`src/shared/types.ts`, stored at `prefs.regional`):

```ts
{ timezone: string /* IANA | 'auto' */,
  locale: string /* BCP-47 | 'auto' */,
  languages: string[] /* ordered BCP-47 */,
  dateFormat: 'auto'|'DMY'|'MDY'|'YMD',
  timeFormat: 'auto'|'12h'|'24h',
  weekStartsOn: 'auto'|0|1,
  measurementSystem: 'auto'|'metric'|'imperial' }
```

- **Timezone** validated against the runtime **IANA** registry via `Intl` (rejects
  `GMT+6`, `Dhaka Time`, `foo/bar`). Registry from `Intl.supportedValuesOf('timeZone')`
  (curated fallback). No homemade TZ database, no network.
- **Locale / languages** validated as **BCP-47** via `Intl.getCanonicalLocales`.
- New profiles inherit **system defaults** (`'auto'`); the OS timezone is never modified.

## 3. Honest capability model (the important part)

Chromium's **runtime timezone and locale are process-global** — there is no stable
Electron API to override them per session, and JS monkey-patching is forbidden. NEXA
therefore reports a **layered, honest** capability matrix (`capabilityReport`):

| Layer | State | Reality |
| --- | --- | --- |
| Accept-Language (Chromium session) | **SUPPORTED** | `session.setUserAgent(ua, acceptLanguages)` per profile session — a real, capability-specific API |
| NEXA UI formatting | **SUPPORTED** | `Intl.DateTimeFormat`/`NumberFormat` with the profile locale/timezone |
| Page locale (`navigator.language`) | **PARTIALLY_SUPPORTED** | preference stored + influences Accept-Language; per-session runtime override not available |
| Page timezone (`Date`/`Intl`) | **PARTIALLY_SUPPORTED** | preference stored + used for NEXA UI; page runtime timezone is process-global, **not** faked |
| Invalid input | **INVALID_CONFIGURATION** | validation failed; nothing applied |

The Settings UI shows these states explicitly ("Applied" / "Partial") and states the
Chromium limitation in plain text. **A UI toggle alone is never presented as browser-applied.**

## 4. What is actually applied

- **Accept-Language header** on both profile sessions (`persist:nexa-<id>` and
  `nexa-private-<id>`) via `RegionalService.setUserAgent(ua, acceptLanguages)`. Built
  with descending q-values + base-language fallbacks: `['bn-BD','en-US'] → "bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7"`.
- **NEXA-owned UI formatting** (date/time/number, week-start, measurement) via `Intl`.

Applied on: startup (`attachAll` → `regional.applyForProfiles`), profile switch, and
whenever regional prefs change (`store.setRegional → regional.apply`).

## 5. Architecture & isolation

```
Renderer (Settings / store.setRegional)
  │ persist via existing saveProfilePrefs (no second store)
  │ regional.apply IPC (Zod, active-profile only)
  ▼
Main RegionalService → session.setUserAgent(ua, acceptLanguages)   [SUPPORTED]
                    → capabilityReport()                            [honest matrix]
```

- **Profile isolation:** main applies the **active profile only**; the store resets
  `regionalCaps` on profile switch and re-applies. No cross-profile regional storage.
- **Private mode:** inherits the active profile's regional config; nothing extra is
  persisted (metrics/regional runtime are not written to history). Private session
  gets the same Accept-Language as the profile (consistent browsing).
- **VPN:** timezone and VPN are independent — NEXA never auto-syncs timezone to VPN country.
- **IP/DNS/WebRTC:** untouched (P4/P7 remain authoritative).

## 6. Worker Assistant

A short, honest regional descriptor (`describeRegional`) is attached to the Worker's
trusted user-context ("locale …; timezone …; week starts …; measurement …; never act
without user confirmation") so it can interpret ambiguous dates/numbers (e.g.
`03/04/2026`). The Scan→Understand→Suggest→Edit→Fill→**User confirms Submit** workflow
is unchanged — regional context **never** triggers a silent submit.

## 7. UI

- **Settings → Language & Region**: searchable timezone picker (with UTC±offset),
  locale picker, ordered preferred-languages list (add/reorder/remove), date/time/week/
  measurement selects, a live preview, and the honest capability matrix. Dense; reuses
  `Row`/`Cycle`/`.field`/`.pill`/`.honest`.
- **Command Palette**: `Region: Open Language & Region`, `Change Timezone`, `Change Language`.
- **Click-to-Go**: `regional`, `timezone`, `locale`, `language`, `region` → Settings → Regional.
- **Privacy Center**: read-only "Regional Configuration" card (browser config, explicitly *not* fingerprint protection).

## 8. Platform differences (§42)

| Platform | Accept-Language (session) | NEXA UI formatting | Page timezone/locale runtime |
| --- | --- | --- | --- |
| macOS | Supported | Supported | Process-global (PARTIAL) |
| Windows | Supported | Supported | Process-global (PARTIAL) |
| Linux | Supported | Supported | Process-global (PARTIAL) |

Behavior of the Accept-Language + Intl layers is consistent across platforms (they are
Chromium/V8 features). The per-session timezone/locale runtime limitation is a Chromium
architecture property, identical on all three platforms. No platform-specific claims beyond this.

## 9. Files changed

**New:** `src/shared/regional.ts`, `src/main/services/regional.ts`,
`tests/unit/regional.test.ts`, `NEXA_STEP_10_*` docs.

**Modified:** `src/shared/types.ts` (`RegionalPrefs` + default), `src/shared/channels.ts`,
`src/shared/ipc.ts` (`regional.apply` + Zod), `src/main/ipc/register.ts` (handler),
`src/main/index.ts` (wiring + startup apply), `src/preload/index.ts`,
`src/renderer/src/nexa.d.ts`, `src/renderer/src/state/store.ts` (regional slice + worker
context), `src/renderer/src/views/Settings.tsx` (`RegionalSettings`),
`src/renderer/src/views/PrivacyCenter.tsx` (config card), `src/renderer/src/lib/catalogs.ts`,
`src/shared/click-to-go.ts` (`regional` cmd + `settingsSection`), `src/shared/worker.ts`
(regional descriptor), `tests/unit/click-to-go.test.ts`, `tests/unit/theme-tokens.test.ts`,
`NEXA_IMPLEMENTATION_AUDIT.md`, `NEXA_DESIGN_AUDIT.md`.
