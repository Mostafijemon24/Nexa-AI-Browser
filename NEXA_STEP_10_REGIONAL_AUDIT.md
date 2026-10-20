# NEXA — STEP 10 · Regional Capability & Performance Audit

A focused, honest audit of what each regional layer can and cannot do in the current
Electron/Chromium architecture, plus performance characteristics.

## 1. Capability investigation (evidence-based)

| Setting | Mechanism investigated | Verdict | Why |
| --- | --- | --- | --- |
| Language preference | `session.setUserAgent(ua, acceptLanguages)` | **SUPPORTED** | Stable Electron session API; sets the real `Accept-Language` header for that profile session (persist + private). |
| NEXA UI date/time/number | `Intl.DateTimeFormat` / `Intl.NumberFormat` | **SUPPORTED** | Standard V8/ICU; applied with profile locale + timezone for NEXA-owned surfaces. |
| Page `navigator.language` | per-session override | **PARTIALLY_SUPPORTED** | No stable per-session Electron API; Chromium app locale is process-global. Preference still influences Accept-Language. Not faked. |
| Page timezone (`Date`/`Intl` in sites) | per-session override | **PARTIALLY_SUPPORTED** | Chromium timezone is process-global (`TZ` at launch). A per-page CDP `Emulation.setTimezoneOverride` exists but requires attaching the debugger to every web tab (invasive, conflicts, and out of scope); NEXA does **not** JS-monkey-patch `Date`/`Intl`. Preference is used for NEXA UI only. Reported honestly. |
| Week start / measurement | locale derivation (`Intl.Locale.weekInfo`, region) + explicit override | **SUPPORTED (NEXA UI)** | Used for NEXA-owned UI; never rewrites websites. |

**Conclusion:** the only true browser-level regional application is the session
**Accept-Language** header. Everything else is either NEXA-owned formatting (SUPPORTED)
or an honestly-reported Chromium limitation (PARTIALLY_SUPPORTED). No layer is faked.

## 2. Why not CDP timezone emulation?

`Emulation.setTimezoneOverride`/`setLocaleOverride` are real Chromium overrides, but
applying them means attaching `webContents.debugger` to every web tab. That (a) is not
currently used anywhere in NEXA, (b) can conflict with other debugger consumers, (c)
detaches on navigation and must be re-applied, and (d) increases the attack/complexity
surface for a modest gain. Per the STEP 10 honesty rule ("A UI toggle alone does not
count… report PARTIALLY_SUPPORTED"), NEXA reports the limitation rather than shipping a
fragile per-tab override. This can be revisited as a separate, explicit feature.

## 3. Performance

- **Timezone registry** (`Intl.supportedValuesOf('timeZone')`) is computed once and
  cached (`_timeZoneCache`). No repeated parsing, no network.
- **No per-navigation cost:** regional application runs only on startup, profile switch,
  and preference change — never on each navigation. `setUserAgent` is a cheap session call.
- **Formatting** uses native `Intl` (C++/ICU), invoked lazily by NEXA UI.
- **Selectors** are pure local filters over the cached registry — instant, no AI/network.

## 4. Persistence

Stored at `prefs.regional` via the existing `saveProfilePrefs` (shallow-merged with
`defaultProfilePrefs`, so older profiles get the default and new fields are back-filled).
No second database, no renderer localStorage, no redundant copies.

## 5. Isolation & privacy summary

- Per-profile files → strong isolation; main applies the **active** profile only.
- Private mode inherits the profile config (consistent browsing); no extra persistence.
- Fingerprint audit remains truthful; regional values are shown as configuration, not protection.

## 6. Limitations (honest)

- Page runtime timezone/locale are **not** per-session in Chromium → PARTIALLY_SUPPORTED.
- Week-start derivation uses `Intl.Locale.weekInfo` where available, else a small regional
  heuristic (documented in code).
- GUI/visual validation: **NOT_CONFIGURED — ENVIRONMENT** (headless).
