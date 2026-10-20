# NEXA — STEP 6 · Secure Vault Autofill & Smart Fill

Additive capability built on the existing NEXA vault, observation, semantic-target,
PermissionEngine, Worker Assistant and typed-IPC systems. **No system was replaced
or redesigned.** The vault cryptography, secure-storage, PBKDF2/AES-GCM and OS
`safeStorage` integration are untouched.

---

## 1. Fundamental secret boundary

```
AI can understand the form.        AI can identify the likely field.
AI cannot see the secret.

Renderer can request autofill.     Renderer cannot receive the secret.

Vault can decrypt the secret.      Only the secure main-process path handles it.

NEXA may fill the field.           NEXA must not silently submit.
```

The decrypted password exists **only** inside the main process, for the duration
of a single `injectCredential()` call, embedded in a fixed injection snippet. It
never enters: AI context, Zustand/React state, worker history, logs, analytics,
task history, page observation, or any IPC payload the renderer can read.

---

## 2. Secret flow (implemented)

```
Renderer (VaultAutofillPopover → vaultAutofillFill)
    │  observe page (assigns data-nx-eid), classify fields, resolve target eids,
    │  read guest webContentsId
    ▼
IPC  passwordManager.autofill   { profileId, credentialId, webContentsId,
    │                             usernameEid?, passwordEid, mode }   ← NO secret
    ▼
Main (register.ts handler)
    ├─ revalidate profile identity  (must equal persisted active profile)
    ├─ permission gate              (mode === 'ask' → blocked)
    ├─ vault unlocked?              (else vault_locked)
    ├─ resolve LIVE guest webContents via webContents.fromId
    ├─ verify guest belongs to our window  (guest.hostWebContents === win)
    ├─ authoritative live origin = guest.getURL()   (never renderer/model URL)
    ├─ select credential by id, matchCredentialOrigin(liveUrl, cred.origin)
    ├─ vault.reveal(...) decrypts in MAIN
    ├─ injectCredential(guest, { …, secret })  → fixed snippet on guest webContents
    └─ return ok({ filled })        ← renderer receives only a boolean status
```

The renderer only ever learns: success / failure / requires-confirmation and safe
metadata (username/email, origin, entry label).

---

## 3. Files added / changed

| File | Change |
| --- | --- |
| `src/shared/vault-autofill.ts` (NEW) | Pure core: `classifyField`, `findLoginFields`, `hasLoginForm`, `matchCredentialOrigin`, `matchCredentials`, `isEligibleOrigin`, `displayOrigin`, request/result contracts (no secret). |
| `tests/unit/vault-autofill.test.ts` (NEW) | 20 unit tests: classification, origin matching, selection, no-secret shape. |
| `src/shared/channels.ts` | + `vaultAutofill: 'passwordManager.autofill'`. |
| `src/shared/ipc.ts` | + `vaultAutofillSchema` (Zod, request-only, eid-regex validated). |
| `src/main/ipc/register.ts` | + `injectCredential()` main-side injector; + autofill handler (profile revalidation, permission gate, live-origin verification, origin match, main-only decrypt+inject); + safe error mappings. |
| `src/preload/index.ts` | + `passwordManager.autofill` (request-only bridge). |
| `src/renderer/src/nexa.d.ts` | + typed `autofill` signature returning `{ filled }`. |
| `src/renderer/src/state/store.ts` | + vault-autofill slice + `setVaultAutofill` hook + detect/fill/select actions + profile reset. |
| `src/renderer/src/App.tsx` | + `vaultAutofillLive` runner (observe→classify→IPC), `VaultButton` + `VaultAutofillPopover`, Worker "Login form detected" banner, Click-to-Go `vault` command. |
| `src/shared/click-to-go.ts` | + `panel: 'vault'` and `vault`/`passwords`/`fill login` command (shared registry). |
| `tests/unit/theme-tokens.test.ts` | + 9 STEP-6 source-guard tests. |

---

## 4. Vault architecture reused

- **Storage & crypto:** unchanged. `VaultService` (`src/main/services/vault.ts`)
  and `core/vault-crypto.ts` (PBKDF2 + AES-GCM) remain authoritative; secrets stay
  encrypted at rest; keys sealed with OS `safeStorage`.
- **Decryption:** autofill uses the existing `vault.reveal()` in the main process
  only. No new decryption, derivation, or storage path was added.
- **No new password manager**, no plaintext DB, no localStorage/sessionStorage
  secrets, no renderer-held key.

## 5. Field detection & classification

Deterministic, multi-signal (`src/shared/vault-autofill.ts`), from the existing
OBSERVE_SRC raw capture (type, name, id, autocomplete, aria-label, label,
placeholder). Classes implemented: `USERNAME`, `EMAIL`, `PASSWORD`, `OTP`,
`SECURITY_CODE`, `PHONE`, `NAME`, `NON_SENSITIVE`, `UNKNOWN`. Never relies on a
single attribute. `PASSWORD ≠ USERNAME`, `OTP ≠ PASSWORD`, `SECURITY_CODE ≠ USERNAME`.

## 6. Origin matching (`matchCredentialOrigin`)

- Authority is the **live guest URL** (`guest.getURL()` in main), never a model or
  renderer-claimed origin, never the page title.
- `exact` = scheme + host + port equal. `domain` = same registrable domain (eTLD+1)
  same-site subdomain. Everything else → `none` (blocked).
- Scheme downgrade (https credential → http live) is rejected. Port mismatch is
  rejected. Lookalike (`example-login.com` vs `example.com`) → `none`. Punycode/IDN
  hosts compared as distinct.

## 7. Permissions (PermissionEngine-aligned)

| Mode | Vault autofill |
| --- | --- |
| **ASK** | Blocked. Renderer shows safe metadata only; main rejects (`vault_blocked_ask`). |
| **ASSIST** | Explicit user confirmation required — the popover **Fill login** click is the confirmation. |
| **AGENT** | Credential insertion remains sensitive; still requires an explicit user Fill action. No silent credential policy was invented. |

## 8. Profile isolation

Main revalidates the renderer-supplied `profileId` against the **persisted active
profile** (`persist.loadProfilesIndex().activeProfile`) and only operates on that
profile's unlocked vault. The guest webContents must be embedded by our window.
Renderer profile IDs are never trusted blindly. Store state resets on `switchProfile`.

## 9. Private mode

Autofill records **no history in any mode** (there is no autofill history, no
`lastUsedAt` write on fill, no task-history entry) — private-safe by construction.
Where the vault is unlocked, private pages may autofill with the same explicit
confirmation; nothing about the usage is persisted.

## 10. AI boundary

The local AI may help understand a form, but it is never given passwords, OTPs,
security codes, tokens, or decrypted values. Vault selection is a deterministic
NEXA operation (`matchCredentials` + explicit user choice). No AI output path can
carry a secret.

## 11. IPC boundary

One capability-specific, Zod-validated channel: `passwordManager.autofill`. It is a
**request** (`credentialId` + target eids + `webContentsId`), not a secret getter.
There is no `getPassword`, `readVault`, `executeVaultCommand`, or generic secret IPC.
The result carries only `{ filled }`.

## 12. Browser execution

The secret is set through a **fixed, non-model** snippet executed by main on the
guest webContents. Targets are resolved by the existing observation ephemeral
`data-nx-eid`. No `eval`, `new Function`, model-generated JS, AI CSS selectors, or
coordinate clicks. The renderer-side agent `type` executor still refuses password
inputs — the secure password path is main-only.

## 13. Submission policy

Autofill **never** submits. `injectCredential` only sets values and dispatches
`input`/`change` events. The user reviews and submits manually.

## 14. OTP / 2FA

OTP / one-time-code / verification-code fields may be **detected** and reported
("Manual entry required"). No SMS/email reading, no authenticator extraction, no
2FA bypass, no silent OTP submission.

## 15. Saving new passwords

The existing vault already supports saving credentials (vault manager in Settings →
Passwords). STEP 6 does **not** add form-capture password saving. Boundary for a
future explicit "Save password" prompt is documented; nothing is captured without
an explicit user action.

## 16. Honest limitations

- Not universal autofill: detection is bounded to the first ~60 observed elements
  and standard login-form shapes.
- Registrable-domain matching uses a compact suffix list (documented in
  `protection.ts`), not the full Public Suffix List.
- No 100% phishing detection; only origin-confidence gating and lookalike rejection.
- No automatic OTP; manual entry only.
- No silent secure login; every fill is user-initiated and never auto-submitted.
