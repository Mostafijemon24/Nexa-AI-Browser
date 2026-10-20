# NEXA — STEP 8 · Google Drive + Secure Cloud Download Integration

Additive, read-only Google Drive **source provider** that hands downloads to the
existing **P2 Download Engine**. No second download manager, no new vault, no new
IPC style, no browser redesign. OAuth + tokens live only in the main process.

Workflow: `Connect (OAuth) → Browse/Search → Select → download() [main] → P2 engine → Downloads UI`.

---

## 1. Configuration status

| Item | Status |
| --- | --- |
| Implementation (code, tests, build) | **IMPLEMENTED** |
| Live OAuth / API calls | **NOT_CONFIGURED — REQUIRES GOOGLE CLOUD OAUTH CREDENTIALS** |

Credentials are read from the environment and **never** committed/hard-coded:

```
NEXA_GOOGLE_CLIENT_ID       (required — a Google "Desktop app" OAuth client id)
NEXA_GOOGLE_CLIENT_SECRET   (optional — desktop clients are protected by PKCE)
```

With no `NEXA_GOOGLE_CLIENT_ID`, `drive.getStatus` returns `NOT_CONFIGURED` and the
UI shows an honest "Not configured" state. **No fake account/files/progress are ever shown.**

## 2. Architecture

```
Renderer (DriveView / store)
   │ typed, Zod-validated request (fileId / category / query — never a URL or token)
   ▼
Main DriveService
   ├── SecureStorage (OS safeStorage) ....... token store (per profile)
   ├── OAuth 2.0 + PKCE loopback flow ....... system browser → 127.0.0.1 callback
   ├── Google Drive API client (fetch) ...... files.list / files.get / export
   ├── Profile validation ................... assertActive(profileId)
   └── Download authorization ............... files.get is authoritative
             │  enqueue({ url, filename, headers:{Authorization} })
             ▼
   P2 DownloadService.enqueueUrl → session.downloadURL(url,{headers})
             ▼
   Existing Download Manager UI (progress/pause/resume/cancel/retry)
```

## 3. Files added / changed

| File | Change |
| --- | --- |
| `src/shared/drive.ts` (NEW) | Pure core: OAuth (auth URL, state, redirect, callback, PKCE-consumer), file normalization, MIME→export mapping, id/URL/filename guards, error normalization, backoff. |
| `tests/unit/drive.test.ts` (NEW) | 24 unit tests. |
| `src/main/services/drive.ts` (NEW) | `DriveService`: config(env)/status/connect(loopback+PKCE)/disconnect/refresh/list/search/download. Tokens via SecureStorage; profile revalidation. |
| `src/main/services/downloads.ts` | + `enqueueUrl()` — provider handoff into the **existing** P2 pipeline (headers attached in main). |
| `src/main/index.ts` | Construct `DriveService`, wire the P2 handoff, register. |
| `src/shared/channels.ts`, `src/shared/ipc.ts` | + `drive.*` channels + Zod schemas. |
| `src/shared/types.ts`, `src/shared/session.ts` | + `'drive'` ChromeView. |
| `src/main/ipc/register.ts` | + 6 Drive handlers + safe error messages. |
| `src/preload/index.ts`, `src/renderer/src/nexa.d.ts` | + `drive` bridge + types. |
| `src/renderer/src/state/store.ts` | + drive slice + actions + profile reset. |
| `src/renderer/src/views/Drive.tsx` (NEW) | Compact Drive browser (connect / list / search / folders / download / export). |
| `src/renderer/src/views/Settings.tsx` | Cloud → Google Drive card is now functional. |
| `src/renderer/src/App.tsx` | View route + `Cloud` palette group + Drive commands. |
| `src/shared/click-to-go.ts` | + `drive` command. |
| `src/renderer/src/design-system/tokens.css` | + `.spin` utility (reduced-motion safe). |
| `tests/unit/theme-tokens.test.ts` | + 14 STEP-8 source-guard tests. |

## 4. OAuth security

- **Flow:** loopback redirect (`http://127.0.0.1:<port>/oauth2/callback`) opened in the
  user's real system browser via `shell.openExternal`. No password is ever entered into NEXA.
- **PKCE:** S256. `code_verifier` (48 random bytes) → `code_challenge` (SHA-256), `code_challenge_method=S256`.
- **state:** 24 random bytes, verified with a length-safe constant-time compare (`validateState`).
- **Redirect validation:** only loopback URIs accepted (`isValidRedirectUri`); callback path must match (`parseCallback`).
- **Offline access:** `access_type=offline` + `prompt=consent` to obtain a refresh token.
- **Cancellation/timeout:** a 5-minute bounded wait; explicit cancel drops the loopback server.
- **Main-authoritative:** the renderer never claims success — the connection state is whatever `DriveService` returns after the token exchange + userinfo call.

## 5. Token storage

Tokens (`access`/`refresh`/`expiry`/`scope`/`email`) are serialized and stored **only**
in `SecureStorage` (OS `safeStorage`) under `drive:tokens:<profileId>`. They never touch
`localStorage`/`sessionStorage`/IndexedDB/Zustand/JSON prefs/cookies/URLs/logs/AI. The
renderer receives only `DriveConnectionMeta { state, connected, email?, displayName? }`.

## 6. Scopes

Exactly one, minimal, read-only scope:

```
https://www.googleapis.com/auth/drive.readonly
```

No `drive` (write), Gmail, Calendar, Contacts or Photos scopes.

## 7. Download handoff (P2 is authoritative)

`DriveService.download(profileId, {fileId, isPrivate})`:
1. `assertActive(profileId)` + `isValidFileId(fileId)`.
2. `ensureAccessToken` (refresh if expired).
3. `files.get` → **authoritative** name + mimeType (renderer metadata is ignored).
4. Workspace file → `exportFormatFor` (PDF/DOCX/XLSX/PPTX/PNG) or `EXPORT_NOT_SUPPORTED`; ordinary file → `alt=media`.
5. Hand to `downloads.enqueueUrl({ url, filename, headers:{Authorization: Bearer …}, isPrivate })`.
6. P2 sanitizes the filename, applies the duplicate policy + traversal guard, and owns all progress/controls. The Drive download appears as a normal NEXA download.

Large files stream through the main/network layer into P2 — the renderer never
`fetch()`/`arrayBuffer()`/`blob()`s Drive content.

## 8. Workspace export mapping

| Google type | Export | Ext |
| --- | --- | --- |
| Document | `application/pdf` | pdf |
| Spreadsheet | `…spreadsheetml.sheet` | xlsx |
| Presentation | `…presentationml.presentation` | pptx |
| Drawing | `image/png` | png |
| Script | `…script+json` | json |
| Form / Site / Map / Shortcut | — | `EXPORT_NOT_SUPPORTED` (honest, no fake download) |

## 9. Profile isolation & private mode

- Tokens + UI state are profile-scoped; `assertActive` rejects cross-profile requests in main.
- On profile switch the store resets all Drive state (`driveMeta: null`, files, folder, query).
- **Private mode:** a Drive download inherits the active tab's private flag → P2 private-download
  semantics. No Drive credentials, search history, or file-metadata history are persisted from
  private mode; Drive UI state is session-only (Zustand, not persisted).

## 10. Disconnect

Best-effort token revoke (`oauth2.googleapis.com/revoke`) + delete from SecureStorage + clear
UI state + cancel any in-flight auth. **Disconnect only removes NEXA's authorization; it never
deletes Google Drive files.** STEP 8 has no write/delete/upload/rename/move/share capability.

## 11. Errors, rate limits, network

- Google errors normalized to safe states: `AUTH_EXPIRED` (401/`invalid_grant`), `RATE_LIMITED`
  (403/429), `ERROR` (404/5xx). Messages never contain tokens/headers/stack traces.
- `invalid_grant` on refresh → tokens dropped → honest "needs attention / reconnect".
- Bounded: `pageSize ≤ 100`, debounced search (350ms), explicit pagination, no recursive crawling,
  no background polling, `backoffMs` capped at 15s. No AI in the Drive path.

## 12. Accessibility

Keyboard-usable rows/buttons, `aria-label`s on file actions and search, `aria-live="polite"`
for connection/list/search status, semantic headings, visible focus (reused tokens), reduced-motion-safe spinner.

## 13. Click-to-Go & Command Palette

- Click-to-Go: `drive`, `google drive`, `connect drive`, `open drive`, `my drive`, … → Drive view.
- Palette (`Cloud` group): Open / Connect / Disconnect / Search Google Drive — all with real handlers.

## 14. Known limitations

- **OAuth live path: NOT_CONFIGURED — REQUIRES GOOGLE CLOUD OAUTH CREDENTIALS** (no secrets in dev).
- Read-only by design — no upload/delete/rename/move/share/sync (out of scope).
- `download()` waits for P2's `will-download` event; the resulting item is a standard P2 download.
- Metadata is not cached to disk (bounded in-memory list only); no local Drive database.
