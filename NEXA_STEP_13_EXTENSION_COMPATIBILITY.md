# NEXA STEP 13 — Extension Compatibility Report

Electron `37.10.3` (Chromium ~130). NEXA loads **unpacked Manifest V3** extensions
into the existing per-profile Chromium sessions (`session.extensions`). Support is
capability-based and reported honestly. NEXA does **not** claim full Chrome Web
Store compatibility.

Legend: **Electron Support** = does the installed runtime implement it ·
**NEXA Support** = does NEXA surface/validate/allow it · **Status** =
`SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED | BLOCKED`.

| API | Electron Support | NEXA Support | Status | Notes |
|-----|------------------|--------------|--------|-------|
| `runtime` | Yes | Yes | SUPPORTED | Messaging, `onInstalled`, ids. Core MV3 surface. |
| `storage` | Yes | Yes | SUPPORTED | Per-session → **profile-isolated** automatically; private = ephemeral. |
| `scripting` | Partial | Validated | PARTIALLY_SUPPORTED | Programmatic injection subset; content-script manifests supported. |
| content scripts (manifest) | Yes | Yes | SUPPORTED | Injected into profile `<webview>`s; isolated world; `matches` validated. |
| background `service_worker` | Yes | Yes | SUPPORTED | MV3 SW lifecycle is Chromium-managed; failure-isolated. |
| `action` (toolbar) | Partial | Metadata + click | PARTIALLY_SUPPORTED | Title/icon/click surfaced; **hosted popup rendering** is a known limitation. |
| `activeTab` | Partial | Validated | PARTIALLY_SUPPORTED | Honored where Chromium grants it; site-access UI complements it. |
| `tabs` | Partial | Validated | PARTIALLY_SUPPORTED | Query/basic ops vary by Electron; not guaranteed complete. |
| `i18n` | Yes | Yes | SUPPORTED | Locale message substitution. |
| `alarms` | Yes | Yes | SUPPORTED | Background scheduling. |
| `webRequest` | Partial | Gated | PARTIALLY_SUPPORTED | **P3 Protection remains authoritative** (precedence documented below). |
| `declarativeNetRequest` | Partial | Gated | PARTIALLY_SUPPORTED | Same precedence; cannot disable NEXA protection. |
| `cookies` | Partial | Elevated perm | PARTIALLY_SUPPORTED | High-risk; requires explicit approval; scoped to profile session. |
| `contextMenus` | Partial | Validated | PARTIALLY_SUPPORTED | Availability version-dependent. |
| `notifications` | Partial | Validated | PARTIALLY_SUPPORTED | Subject to OS + Electron support. |
| `downloads` | No/Partial | Via P2 only | PARTIALLY_SUPPORTED | Any download path routes through the **P2 engine**; no second engine. |
| `history` | No | Elevated perm | UNSUPPORTED | Not surfaced by Electron; declared → high-risk marker, no runtime API. |
| `bookmarks` | No | Elevated perm | UNSUPPORTED | Same as history. |
| `identity` | No | BLOCKED-ish | UNSUPPORTED | OAuth identity brokering not provided; high-risk marker. |
| `commands` | Partial | Validated | PARTIALLY_SUPPORTED | Keyboard commands vary. |
| `offscreen` | Partial | — | PARTIALLY_SUPPORTED | Not exercised by NEXA UI. |
| `sidePanel` | No | — | UNSUPPORTED | NEXA does not host a side panel surface for extensions. |
| `permissions` (runtime request) | Partial | — | PARTIALLY_SUPPORTED | Optional-permission prompts not fully surfaced this phase. |
| `debugger` / `nativeMessaging` / `proxy` / `management` / `privacy` / `vpnProvider` / `certificateProvider` / enterprise.* | n/a | **Refused** | BLOCKED | In `FORBIDDEN_PERMISSIONS`; manifest classified BLOCKED, never loaded. |

## Sources & distribution

- **Supported:** `LOCAL_FOLDER` (unpacked) via explicit user file picker.
- **Types tracked:** `LOCAL_FOLDER`, `LOCAL_PACKAGE`, `DEVELOPMENT_LOAD`.
- **Not supported this phase:** Chrome Web Store install/scrape, `.crx` signature
  verification, remote/auto updates. (See §36/§37 of the prompt — future phase.)

## Packaging implications

- Electron loads unpacked extensions from a directory path; the folder must remain
  on disk. NEXA re-loads enabled extensions on every boot (`applyForProfile`).
- No signing/verification pipeline exists; installation is an explicit,
  permission-reviewed, user-confirmed local action.

## webRequest / declarativeNetRequest precedence (P3)

```
Network request
   → NEXA P3 Protection (block/allow, authoritative)
   → Extension webRequest/DNR observers (only within what P3 permits)
```

An extension requesting `webRequest`/`declarativeNetRequest` is classified
HIGH-risk and requires explicit approval, but it **cannot** disable or override
P3. P3 evaluates first and remains the final authority.
