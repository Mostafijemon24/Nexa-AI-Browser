# NEXA RC-1 — Readiness & Audit Summary

*Prepared for real-machine (macOS) validation. No product features added. No code
changed except release-blocking defects (none found this pass).*

## Audit result (P0–P13 + Hardening), re-verified now

| Check | Result |
|-------|--------|
| ESLint (`--max-warnings 0`) | **0 errors / 0 warnings** |
| Typecheck (vs Electron 44 types) | **PASS** |
| Unit/service tests | **746/746 PASS** |
| Clean + production build | **PASS** |
| `npm audit` | **2 moderate** — dev-only `vitest`/`@vitest/mocker`; runtime advisories resolved |
| Security greps | no `eval`/`new Function`/`shell:true`; controlled `executeJavaScript`/`execFile` |
| Preload surface | only `window.nexa` invoke-wrappers; no raw `ipcRenderer`/fs/shell |
| SEC-1 permission policy | applied to defaultSession + persist + private partitions |
| Extension load | `allowFileAccess:false` (6 call sites) |
| Build artifacts | `out/main/index.js`, `out/preload/index.cjs`, `out/renderer/index.html`; main entry correct; no stray dirs after clean |

All the above are automated by `scripts/rc1-validate.sh` → **17 passed, 0 failed** once the RC-1 runtime harness is included. Harness reports: `reports/rc1-validation.json` and `reports/rc1-validation.md`. Environment-only checks in that report stay BLOCKED — ENVIRONMENT.

## Electron 44.4.1 packaged behavior — verified as far as the environment allows

Ran `npx electron-builder --dir --mac`:
- ✅ electron-builder pipeline starts correctly against the pinned Electron 44.4.1.
- ✅ App icon PNG → `.icns` auto-conversion **succeeds** (`dist/.icon-icns/icon.icns`).
- ✅ `dist/mac-arm64/NEXA.app` scaffold is created.
- ⛔ Final packaging **stalls downloading the Electron 44 darwin dist** from GitHub
  (sandbox network); the cache only holds an unrelated old Electron zip.

**Conclusion:** packaging **configuration and pipeline are valid**; producing the
actual `.app`/`.dmg` requires the Electron 44 binary download + (for release) a
signing identity — **BLOCKED — ENVIRONMENT** here, and is the first real-machine
step in the checklist.

## What MUST be validated manually on macOS (summary)

The full, executable checklist is `NEXA_RC1_VALIDATION_CHECKLIST.md`. Highest
priority, because they are new or unverifiable headlessly:

1. **Signed + notarized build** (`npm run package:mac`) → codesign / spctl / stapler.
2. **Electron 44 regressions:**
   - Async **clipboard vault-copy** (write awaited; 30 s auto-clear via Promise path).
   - **Permission policy**: geolocation/camera/mic/display-capture **denied**;
     fullscreen/pointerLock **allowed**; verified in a 2nd profile + private.
3. **Live services** (cannot run here): Ollama AI, Google Drive OAuth, native
   WireGuard tunnel, live MV3 extension load (content script + service worker).
4. **Full P0–P13 feature walkthrough**, crash/offline/recovery, and running-app
   security spot-checks (no Node in renderer; no secrets in storage/logs).

## Deliverables added this pass
- `scripts/rc1-validate.sh` — machine-executable automated gate (16 checks).
- `NEXA_RC1_VALIDATION_CHECKLIST.md` — full macOS RC-1 checklist with pass/fail boxes.
- `NEXA_RC1_READINESS.md` — this summary.
- Doc accuracy fix: icon note in `NEXA_PACKAGING_SIGNING_AUDIT.md` (conversion verified).

## RC-1 gate
```
RELEASE-READY WITH ENVIRONMENT LIMITATIONS
```
- **Code blockers:** none found (no code changed this pass).
- **Environment blockers (required before RC-1 sign-off):** signed/notarized build,
  GUI/runtime validation on Electron 44, native WireGuard, live Google OAuth,
  live AI providers, live extension load.
- **Deferred (non-blocking):** vitest→5 (dev-only advisory); PERF-1 code splitting.
```
Next action: run scripts/rc1-validate.sh on the target Mac, then execute
NEXA_RC1_VALIDATION_CHECKLIST.md end-to-end.
```
