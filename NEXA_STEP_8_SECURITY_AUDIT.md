# NEXA — STEP 8 · Security Audit (Google Drive Integration)

Scope: the additive Google Drive provider + P2 download handoff. Method: source
review + automated source-guard tests (`theme-tokens.test.ts` → "Google Drive
(STEP 8)", 14 tests) + behavioural unit tests (`drive.test.ts`, 24 tests).

Result: **PASS (implementation)**; live OAuth is **NOT_CONFIGURED — ENVIRONMENT**.

---

## 1. Threat model

An attacker-controlled page, a compromised renderer, or malicious Drive metadata
must not be able to: exfiltrate OAuth tokens, drive an arbitrary download/URL
through NEXA, escape the download directory, cross a profile boundary, delete
Drive files, or fabricate a "connected" state. AI must never reach tokens or the
Drive client.

## 2. OAuth flow

- OAuth 2.0 authorization-code + **PKCE (S256)** via a **loopback** redirect opened in the
  **system browser**. No in-app Google password entry.
- `state` (24 random bytes) verified length-safe/constant-time (`validateState`).
- Redirect restricted to loopback (`isValidRedirectUri`); callback path matched (`parseCallback`).
- Token exchange + refresh happen in main; `invalid_grant` clears tokens.
- **Main is authoritative** for auth success — the renderer only receives the resulting meta.

## 3. Redirect / callback validation

`parseCallback` rejects non-loopback URLs, path mismatches, and missing `code`; explicit
provider errors (e.g. `access_denied`) return `{error}` without throwing. Arbitrary callback
URLs are never accepted.

## 4. Token storage & lifetime

- Stored ONLY in `SecureStorage` (OS `safeStorage`) under `drive:tokens:<profileId>`.
- Never in localStorage/sessionStorage/IndexedDB/Zustand/prefs/cookies/URLs/logs/AI
  (verified by source guards over `store.ts`, `Drive.tsx`, `preload`, `drive.ts`).
- Access tokens refreshed on demand with a 60s expiry skew; revoked/`invalid_grant` → dropped.
- Renderer receives only `DriveConnectionMeta { state, connected, email?, displayName? }`.

## 5. Renderer / main boundary

- Renderer sends only `profileId` + `fileId`/`category`/`query` (Zod-validated, bounded).
- Renderer can **never** supply a download URL or token; `DriveService.download` derives the
  URL from an authoritative `files.get` response.
- IPC is capability-specific (`drive.getStatus/connect/disconnect/list/search/download`). No
  `drive.execute/request/fetch/api`, no `eval`/`new Function`/shell (source-guarded).

## 6. Download authorization & filename safety

`download()` requires: connected+valid tokens, valid `fileId` format, authoritative Drive
metadata, a supported export/download type, and profile match. Handoff uses P2's
`enqueueUrl`, which applies `sanitizeFilename` + `uniqueFilename` + the existing path-traversal
guard (resolved path must stay inside the download dir) and the user's download destination.
`../`, absolute paths, drive letters, UNC, null bytes, control chars and reserved names are
handled by the reused P2 sanitizer.

## 7. Drive API scopes

Exactly `drive.readonly`. No write/delete/gmail/calendar/contacts/photos scopes
(source-guarded). No write/delete/upload/rename/move/share operations exist.

## 8. Profile isolation

Every Drive op calls `assertActive(profileId)` (main revalidates against the persisted active
profile). Tokens are keyed per profile; the store resets Drive state on profile switch.

## 9. Private mode

No Drive credentials/search-history/metadata-history persisted from private mode; Drive UI
state is session-only. Downloads initiated while a private tab is active inherit P2 private
semantics (`isPrivate`).

## 10. Data retention & logging

No file contents are stored. Metadata is a bounded in-memory list (no on-disk Drive DB). No
tokens/headers/codes are logged. Normalized errors are user-safe.

## 11. Large-file handling

Content streams through the main/network → P2 engine (`session.downloadURL`). The renderer
never buffers Drive file bodies (`fetch/arrayBuffer/blob` are not used for file content).

## 12. Rate limits & abuse

Bounded page sizes (≤100), debounced explicit search, explicit pagination, capped exponential
backoff (`backoffMs` ≤ 15s), no recursive crawling, no background polling.

## 13. Disconnect behavior

Best-effort revoke + local token deletion + state clear + in-flight auth cancellation. **Never
deletes Drive files.** The UI distinguishes "Disconnect NEXA from Google Drive" from deleting files.

## 14. AI boundary

`drive.ts` and `drive.ts` service contain no AI calls (`aiComplete`/`aiChat`/`ollama` absent,
source-guarded). AI cannot reach tokens, the Drive client, or arbitrary downloads.

## 15. No fake cloud

Without `NEXA_GOOGLE_CLIENT_ID`, state is `NOT_CONFIGURED` and the UI says so. No fake
IP/account/files/progress/OAuth/API responses. No hard-coded client id/secret/tokens.

## 16. Known limitations

- Live OAuth/API cannot be exercised without Google Cloud credentials → NOT_CONFIGURED — ENVIRONMENT.
- Read-only scope only; write/delete/sync intentionally unimplemented.

## 17. Verdict

No token leakage, generic IPC, eval/shell, arbitrary URL/download, filename escape, profile
leak, private-mode persistence, Drive file deletion, or fake-cloud findings.
**Security Audit: PASS.**
