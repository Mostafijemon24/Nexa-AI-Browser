# NEXA — Release Test Matrix

Commands run at hardening completion. Electron 44.4.1, Node 24.17.0, macOS
(darwin), arm64/host. Headless (no display, no Electron binary, no signing).

| Test | Result | Environment | Evidence |
|------|--------|-------------|----------|
| Unit/service tests | **PASS** 746/746 (42 files) | headless node/vitest | `npm test` |
| Typecheck | **PASS** | vs Electron 44 types | `npm run typecheck` |
| Build | **PASS** (main+preload+renderer) | electron-vite | `npm run build` |
| ESLint | **PASS** 0 errors / 0 warnings | `eslint . --max-warnings 0` | `npm run lint` |
| npm audit | **2 moderate (dev-only vitest)** | runtime advisories resolved | `npm audit` |
| Security scan | **PASS** (no eval/new Function/shell:true; controlled exec/executeJavaScript) | rg | see release security audit |
| Profile isolation | **PASS** | assertSafeProfileId ×11 + service tests | downloads/library/protection/vpn/ext service tests |
| Private mode | **PASS** | in-memory partition + off-by-default extensions | extensions(.service) tests |
| Permission policy | **PASS** | deny-by-default on default+persist+private | permissions.test.ts (14) |
| Downloads (P2) | **PASS** (logic) | sanitize/queue/lifecycle | downloads-pure/service tests |
| Protection (P3) | **PASS** (logic) | rules/overrides/stats | protection-pure/service tests |
| VPN (P4) | **PASS** (logic) | parser/helper protocol/transport/service | 8 vpn-* tests |
| AI (P5/P12) | **PASS** (logic) | routing/context/secrets | ai-* tests |
| Vault | **PASS** (logic) | crypto/origin/no-leak; async clipboard adapted | vault-crypto/autofill |
| Drive (P8) | **PASS** (logic) | OAuth/PKCE/token/P2 handoff | drive.test.ts |
| Extensions (P13) | **PASS** (logic) | MV3/perms/hosts/lifecycle/isolation | extensions(.service) |
| GUI (1280–2560 / light+dark / keyboard) | **BLOCKED — ENVIRONMENT** | no display | — |
| Packaging (dmg/nsis/AppImage) | **BLOCKED — ENVIRONMENT** | no Electron binary / toolchain | electron-builder.yml |
| Signing (mac/win) | **BLOCKED — ENVIRONMENT** | no certificates | config ready, inert |
| Native VPN (WireGuard tunnel) | **BLOCKED — ENVIRONMENT** | no privileged helper/device | P4.2 doc |
| Live Google Drive OAuth | **NOT_CONFIGURED** | no `NEXA_GOOGLE_CLIENT_ID` | drive.ts |
| Live AI (Ollama/cloud) | **NOT_CONFIGURED** | no runtime/keys | ai-registry |
| Live extension load / content script / SW | **BLOCKED — ENVIRONMENT** | no GUI Electron | extensions.ts |
| Crash/recovery, offline, smoke test | **BLOCKED — ENVIRONMENT** | needs launched app | — |

## Notes
- All logic-level results are from pure/unit + service tests with fakes
  (fake session/extensions, simulated transports). They do not substitute for a
  launched-app run, which is environment-blocked here.
- No tests were skipped, `.only`'d, or `.todo`'d. No coverage tool is configured.
