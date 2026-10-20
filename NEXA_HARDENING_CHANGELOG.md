# NEXA — Hardening & Release-Readiness Changelog

All changes are hardening/validation/packaging only. No product features added.
Existing P0–P13 behavior preserved. Gate after each step: tests + typecheck +
build + lint.

## SEC-1 — Partition permission policy (STEP A)

**Problem:** `setPermissionRequestHandler` was installed only on
`session.defaultSession`, but tabs run in `persist:nexa-<id>` /
`nexa-private-<id>` partitions, which fell back to Electron defaults.

**Files:**
- `src/shared/permissions.ts` (NEW) — pure, dependency-free deny-by-default policy
  (`isPermissionAllowed`), documented allow/deny sets, and `persistPartition` /
  `privatePartition` helpers.
- `src/main/security/permissions.ts` (NEW) — `applyPermissionPolicy(session)` sets
  both `setPermissionRequestHandler` and `setPermissionCheckHandler` from the
  shared decision; renderer-supplied origin never widens the decision.
- `src/main/index.ts` — applies the policy to `defaultSession` and, in
  `attachAll()`, to every profile's persistent + private partition.
- `tests/unit/permissions.test.ts` (NEW, 14 tests) — decision logic (allow set,
  deny-by-default, sensitive denied), applier installs both handlers on any
  session, origin ignored, partition isolation, and source-wiring guards.

**Security impact:** all NEXA sessions now enforce an explicit deny-by-default
policy. Allowed: `clipboard-sanitized-write`, `notifications`, `fullscreen`,
`pointerLock`. Denied: geolocation, media (camera/mic), display-capture, HID,
serial, USB, midi, DRM, etc. **Compatibility:** preserves the previously-granted
set; adds fullscreen/pointerLock so normal browsing UX is not regressed.

## ESLint — real lint (STEP B)

**Files:**
- `package.json` — `lint` script changed from `echo 'eslint not configured yet'`
  to `eslint . --max-warnings 0`; added devDeps `typescript-eslint@8.70`,
  `eslint-plugin-react-hooks@7.1`.
- `eslint.config.js` (NEW) — flat config: `@eslint/js` recommended +
  `typescript-eslint` recommended + react-hooks (renderer); ignores build
  artifacts + `test-extension/`; tests override allows dynamic `require()`.
- Fixes to reach **0 errors / 0 warnings** (correctness only, no reformat):
  - `extensions.ts` — stale disable `no-var-requires` → `no-require-imports` (v8).
  - `ai-provider-adapters.ts` — documented single `no-explicit-any` on SSE payload.
  - `agent.ts`, `ai-providers.ts`, `ai.ts` — removed useless `\/` escapes in regex
    char classes (semantically identical).
  - `observation.ts`, `page-content.ts`, `worker.ts` (×2), `page-content.test.ts`
    — documented `no-control-regex` disables for intentional control-char sanitizers.
  - Removed genuinely unused imports/vars across `ai-registry`, `ai`, `downloads`,
    `library`, `protection`, `vpn`, `nexa.d.ts`, `store.ts`, `Settings.tsx`,
    `NewTab.tsx`, `ai-service.test.ts`.
  - `Bookmarks.tsx` — memoized `items` (the exact react-hooks suggestion).
  - `scripts/p52-ollama-validate.mts` — `ok ? a : b` expression → `if/else`.

**Security impact:** none (hygiene). Real static analysis now gates the repo.

## SEC-2 — Electron upgrade (STEP C/D)

**Files:**
- `package.json` — `electron ^37.4.0` → `^44.4.1`.
- `src/main/services/vault.ts` — `copySecret` made `async` for Electron 44's
  async `clipboard` API (await write; Promise-based auto-clear).
- `src/main/ipc/register.ts` — `vaultCopy` handler now `await`s `copySecret`.

**Security impact:** resolves runtime Electron + extract-zip advisories; no
invariant weakened. See `NEXA_ELECTRON_UPGRADE_AUDIT.md`.

## Release config (STEP E)

**Files:**
- `src/main/index.ts` — `channel` now `app.isPackaged ? 'stable' : 'dev'` (was
  hardcoded `'dev'`).
- `src/shared/types.ts` — documented **DOC-1**: `prefs.extState` retained as a
  legacy field (unused since P13; kept to avoid a prefs migration; removable in a
  future migration pass).
- `package.json` — `package*` scripts run `npm run clean` first.

## Packaging / signing readiness (STEP F/G)

**Files:**
- `electron-builder.yml` — macOS `hardenedRuntime: true`, `gatekeeperAssess: false`,
  `entitlements`/`entitlementsInherit`.
- `build/entitlements.mac.plist` (NEW) — Hardened Runtime entitlements.

**Impact:** signing-ready and inert without credentials. See
`NEXA_PACKAGING_SIGNING_AUDIT.md`.

## Test evidence (final)
- 42 files / **746 tests** pass (was 732; +14 SEC-1 tests).
- typecheck PASS (against Electron 44 types), build PASS, lint PASS (0/0).
- `npm audit`: 2 moderate (vitest, dev-only); runtime advisories resolved.

## Explicitly NOT done (out of scope / deferred)
- PERF-1 code splitting: no runtime evidence it materially hurts a local-disk
  desktop load; not redesigned (deferred, documented).
- vitest→5 upgrade (breaking, dev-only advisory) — deferred to a test-tooling phase.
- Any new features (Cloud Sync, Marketplace, new AI/Worker) — not started.
