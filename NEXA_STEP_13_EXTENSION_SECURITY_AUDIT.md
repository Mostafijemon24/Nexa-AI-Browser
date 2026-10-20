# NEXA STEP 13 — Extension Security Audit

## Trust boundaries

```
Chromium extension (isolated world / SW)
        ↓ chrome.* subset only (no window.nexa, no Node)
Chromium sandbox (per-profile session)
        ↓
NEXA main process (identity + validation authority)
        ↓ capability-specific, Zod-validated IPC
NEXA services (P2 downloads, P3 protection, P5/P12 AI, Vault, VPN, Drive)
```

An extension is **never** trusted. It receives only the standard Chrome extension
surface that Electron implements, scoped to its profile session. It cannot reach
Node, the filesystem, the shell, OS credentials, internal IPC, vault secrets, AI
provider keys, VPN keys, or Drive OAuth tokens.

## Extension sandbox

- Runs inside the Chromium renderer/SW sandbox of the profile partition.
- Content scripts execute in an **isolated world** — no page-JS or NEXA-JS access,
  no `window.nexa`, no Node.
- Extensions load with **`allowFileAccess: false`** (no `file://`).
- Popups are standard extension pages with their own CSP; no Node, no NEXA IPC.

## Permission model

- Chrome permissions → explicit NEXA taxonomy (`PERMISSION_MAP`).
- Nothing is auto-granted; **install requires explicit user confirmation** after a
  main-validated permission review (`preview()` → dry-run, no code loaded).
- High-risk permissions (`COOKIES, WEB_REQUEST, SCRIPTING, HOST_ACCESS, DOWNLOADS,
  HISTORY, BOOKMARKS, IDENTITY`) are flagged and explained.
- Forbidden permissions (`debugger, nativeMessaging, proxy, management, privacy,
  vpnProvider, certificateProvider, enterprise.*, …`) → manifest classified
  **BLOCKED** and never loaded.
- Risk classification (`LOW/MEDIUM/HIGH/BLOCKED`) is a UX indicator, not a
  substitute for the permission checks.

## Host permissions

- Parsed + normalized; only `http`/`https`/`*` schemes and `<all_urls>` accepted.
- **Rejected schemes:** `file, chrome, chrome-extension, devtools, electron, data,
  javascript, ftp, ws, wss, about, blob`.
- `chrome://`, `devtools://`, `electron://` are never exposed to content scripts.

## Private mode

- Extensions are **disabled in private mode by default**.
- Loaded into the non-persistent private partition (`nexa-private-<id>`) **only**
  when the user explicitly enables per-extension private access AND the extension
  is otherwise enabled (`canRunInPrivate`).
- Private storage is ephemeral (in-memory partition). No private page data logged.

## Profile isolation

- Records persist per profile (`<profileDir>/extensions.json`).
- Extensions load into the profile's own partition; storage/cookies/state are
  isolated by Chromium per-session. Switching profiles loads a different set.
- Persisted records are **untrusted on read** (`normalizeExtensionRecords`).

## NEXA API bridge

- NEXA exposes **no `nexa.*` API to extensions** in this phase (safest default).
- Forbidden names (`nexa.execute/eval/fetch/fs/shell/ipc`) do not exist.
- The renderer↔main extension IPC is capability-specific and Zod-validated:
  `ext.list/get/install/remove/setEnabled/setPrivate/setSiteAccess/pickFolder`.
  No generic `extension.execute/invoke/ipc/fetch/fs/shell`.

## IPC & identity

- Extension **identity is resolved main-side** from the Electron-loaded
  `Extension` object; ids are validated (`/^[a-p]{32}$/`). Renderer-supplied ids
  are validated but never authoritative for what actually runs.
- Manifest is validated **before** any `loadExtension` call (guard-tested by
  source-order assertion).

## Storage

- `chrome.storage` is per-session → isolated by profile automatically; extension A
  cannot read extension B (separate extension origins).

## AI integration

- No AI bridge is exposed to extensions this phase. If added later, it must route
  `Extension → NEXA API → permission check → AIService → Provider Registry`,
  never returning provider keys/tokens, and must respect privacy/local-first/context
  limits + injection defenses (P12 invariants).

## Downloads

- Any extension-initiated download must flow through the **P2 Download Engine**
  (destination rules, concurrency, filename sanitization, profile/private
  isolation, user permission). No second download engine is introduced.

## Vault / VPN / Drive

- **Vault:** no access to the password DB, AES keys, or safeStorage keys. Autofill
  stays under the existing Vault/Autofill system.
- **VPN:** no access to WireGuard keys/config/helper socket/interfaces. State, if
  ever exposed, is read-only.
- **Drive:** no access to OAuth tokens; integration stays in the NEXA Drive Service.

## Navigation

- Extensions cannot bypass NEXA navigation safety; `javascript:`, `data:`, `file:`
  remain blocked as host schemes and are not granted via host permissions.

## Failure isolation

- Every runtime interaction is wrapped; a bad extension yields an **Extension
  Error** (record `lifecycle: ERROR`, disabled), never a browser crash. Startup
  reconcile skips broken extensions.
- Logs carry only safe metadata (id/name/version/lifecycle). No secrets, cookies,
  page content, or tokens are logged.

## Update risks

- No remote/auto update in this phase → no compromised-update vector introduced.
  Local replacement requires re-install (explicit, reviewed).

## Threat model (prompt §47)

| # | Threat | Mitigation |
|---|--------|-----------|
| 1 | Malicious extension | Sandbox + capability model + explicit permission review; forbidden perms BLOCKED. |
| 2 | Compromised update | No remote/auto update; local re-install is explicit + reviewed. |
| 3 | Excessive permissions | Taxonomy + high-risk flags + risk class + user confirm; forbidden → BLOCKED. |
| 4 | → NEXA privilege escalation | No `window.nexa`, no generic IPC; main is the authority. |
| 5 | → filesystem | `allowFileAccess:false`; `file:` scheme rejected; no fs bridge. |
| 6 | → shell | No shell/child_process anywhere in the extension layer (guard-tested). |
| 7 | → vault | No vault APIs exposed; Vault crypto untouched. |
| 8 | → AI credentials | No AI bridge; keys stay in main safeStorage (P12). |
| 9 | → private browsing data | Disabled in private by default; ephemeral partition; no private logs. |
| 10 | → cross-profile data | Per-profile records + per-partition sessions; records untrusted on read. |
| 11 | → VPN private keys | No VPN control/keys; WireGuard untouched. |
| 12 | → protection bypass | P3 evaluates first and stays authoritative over webRequest/DNR. |
| 13 | → arbitrary IPC | Only capability-specific Zod-validated channels; no generic bridge. |
