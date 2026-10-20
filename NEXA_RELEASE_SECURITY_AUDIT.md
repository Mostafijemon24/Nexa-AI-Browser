# NEXA — Release Security Audit (post-hardening)

Re-review of the threat model after STEP A–G. Evidence is current repository
source. No vulnerabilities were invented.

| Threat | Mitigation | Evidence | Residual risk |
|--------|-----------|----------|---------------|
| Renderer compromise → Node/host | sandbox + contextIsolation + nodeIntegration off + webSecurity; preload exposes only `window.nexa` invoke-wrappers | index.ts:82–85; preload/index.ts:209 | Low |
| IPC abuse / arbitrary dispatch | single typed registry, Zod-parsed, capability-specific; `safeError()` sanitizes; explicit deny firewall for AI/cloud/extension→vault | register.ts; :1085–1090 | Low |
| **Permission abuse (camera/mic/geo) on tabs** | **NEW:** deny-by-default policy on defaultSession + every profile partition; origin cannot widen decision | shared/permissions.ts; main/security/permissions.ts; index.ts attachAll; permissions.test.ts | Low (was Medium/SEC-1) |
| Profile escape (cross-profile data) | per-profile partitions + `assertSafeProfileId` at every stateful service; distinct persist/private partitions | 11 services; permissions.test.ts isolation | Low |
| Private-mode leakage | in-memory `nexa-private-<id>` partitions; private tabs never persisted; extensions off-by-default in private | session.ts; downloads/protection/extensions | Low |
| Credential exposure (AI keys) | `safeStorage`-encrypted `ai.key.<id>`; only passed to adapters in main; renderer sends key via IPC, never stores it | ai-registry.ts:105–149; store.ts:837–839 | Low |
| Drive token theft | tokens `safeStorage`-encrypted; `getStatus` returns metadata only; Bearer only in main `fetch` | drive.ts:103,119–125 | Low |
| Vault secret leak | PBKDF2+AES-GCM+safeStorage; `injectCredential` fixed template keeps secret in main; copySecret writes to OS clipboard only (now async, auto-clears 30 s) | vault.ts; register.ts:109–140 | Low |
| Extension compromise / escalation | Chromium sandbox; MV3 validation; forbidden perms/hosts blocked; `allowFileAccess:false`; no `nexa.*`/generic bridge | extensions.ts; extensions.test.ts | Low |
| AI prompt injection | `wrapUntrusted`/`INJECTION_GUARD`; page content untrusted; control-char sanitizers | worker.ts/page-content.ts/observation.ts | Low |
| Agent privilege escalation | plan→authorize→fixed tool switch (no raw model JS); `AGENT_MAX_STEPS=25`, no-progress | App.tsx executeAgentTool; agent.ts | Low |
| Download path traversal | `sanitizeFilename` (reserved names, sep/`..` rejection); per-profile dirs | shared/downloads.ts | Low |
| VPN helper abuse | privileged ops via signed helper over socket/pipe; `execFile` `shell:false`; no key exposure to renderer | helper/main.ts; vpn-platform/base.ts | Low; helper signing = ENV |
| Dependency vulnerabilities | Electron→44.4.1 (runtime advisories + extract-zip resolved) | npm audit; upgrade audit | Low runtime; 2 moderate dev-only (vitest) |
| Packaging tampering | asar on; clean-before-package; fixtures excluded; signing config ready | electron-builder.yml; package.json | Signing = BLOCKED — ENVIRONMENT |

## Static regression (post-hardening)
- `eval` / `new Function`: **none** in `src`.
- `child_process`: only VPN helper + `vpn-platform/base.ts`, both `shell:false`.
- Generic IPC / `ipcRenderer` exposure in preload: **none**.
- Secrets in renderer/preload/shared: only **type names / IPC input schemas /
  pass-through params** — no stored secrets, no `safeStorage` outside main.
- `as any` / `@ts-ignore` / `@ts-nocheck`: **0 / 0 / 0**.

## Residual / environment risks
- Runtime security behavior on Electron 44/Chromium ~140 not exercised
  (headless) → **BLOCKED — ENVIRONMENT** (required release gate).
- Notifications remain auto-granted (pre-existing, documented); tighten to a
  consent prompt when a permission-UI phase is authorized.
- vitest dev-only advisory pending a test-tooling upgrade.
