# NEXA — Release Readiness

## State
**RELEASE-READY WITH ENVIRONMENT LIMITATIONS.**

All code-level hardening is complete and verified headlessly. The only remaining
gates are environment validations (signed build, GUI/runtime on Electron 44,
native WireGuard, live OAuth/AI) — not code defects.

## What changed this phase
- **SEC-1 fixed** — deny-by-default permission policy on defaultSession + every
  profile partition (persistent + private), with 14 regression tests.
- **Real ESLint** — flat config (typescript-eslint + react-hooks); `npm run lint`
  passes with **0 errors / 0 warnings**.
- **Electron 37 → 44.4.1** — runtime advisories + extract-zip resolved; one
  breaking change (async `clipboard`) adapted in the vault copy path.
- **Release hygiene** — honest release `channel`, clean-before-package, DOC-1
  documented, macOS signing readiness (entitlements + hardened runtime).

## Verification
| Gate | Result |
|------|--------|
| Tests | 746/746 PASS |
| Typecheck (Electron 44 types) | PASS |
| Build | PASS |
| Lint | PASS (0/0) |
| npm audit | 2 moderate (dev-only vitest); runtime advisories resolved |

## Release checklist
- [x] SEC-1 permission policy on all sessions + tests
- [x] ESLint configured and passing (0/0)
- [x] Electron upgraded; breaking change adapted; invariants preserved
- [x] Runtime dependency advisories resolved
- [x] Security + secret regression clean
- [x] Packaging cleaned; fixtures excluded; signing config ready
- [ ] **ENV:** produce signed macOS build + notarize
- [ ] **ENV:** produce signed Windows installer
- [ ] **ENV:** GUI/runtime validation on Electron 44 (launch, webview, extensions, downloads, permissions, clipboard)
- [ ] **ENV:** native WireGuard tunnel validation (signed helper)
- [ ] **ENV:** live Google Drive OAuth + live AI providers
- [ ] (deferred) vitest→5 for the dev-only advisory
- [ ] (deferred) PERF-1 code splitting if runtime evidence warrants

## Gate
See `NEXA_RELEASE_READINESS_FINAL.md` for the full report and final gate.
