# NEXA — STEP 6 · Security Audit (Secure Vault Autofill)

Scope: the additive vault-autofill capability only. Method: source-level review +
automated source-guard tests (`tests/unit/theme-tokens.test.ts` → "Secure Vault
Autofill (STEP 6)") + behavioural unit tests (`tests/unit/vault-autofill.test.ts`).

Result: **PASS.**

---

## 1. Threat checklist

| Risk | Finding | Evidence |
| --- | --- | --- |
| **Plaintext secrets** | None introduced. Secrets stay AES-GCM encrypted at rest; decrypt is the existing `vault.reveal()` in main. | `src/main/services/vault.ts`, unchanged. |
| **Secret leakage to renderer** | Autofill returns only `{ filled }`. The revealed password is passed solely into `injectCredential`. | `register.ts` autofill handler returns `ok({ filled })`; `secret: vault.reveal(...)` flows only into the injector. |
| **AI exposure** | AI is never given passwords/OTP/tokens. Vault selection is deterministic; no secret crosses any AI path. | No AI call in the autofill path; `@shared/vault-autofill` handles no secret. |
| **Zustand / React exposure** | No store field holds a secret. State carries only metadata + status. | store slice: `vaultMatches` (metadata), `vaultAutofillState`, `vaultSelectedId`. |
| **Logging** | No `console.log` of password/secret/pw/vault anywhere. | `rg "console\.(log\|…)\(.*(password\|secret\|reveal\|pw)"` → none. |
| **IPC exposure** | Single request-only channel; no generic secret getters. | No `getPassword`/`readVault`/`executeVaultCommand`/`getSecret` in preload. |
| **Profile leakage** | Main revalidates `profileId` == persisted active profile; guest must be embedded by our window. | `loadProfilesIndex().activeProfile`; `guest.hostWebContents === win.webContents.id`. |
| **Private-mode leakage** | No autofill history, no `lastUsedAt` write, no task-history metadata — in any mode. | No `vaultAutofillHistory`; fill records nothing. |
| **Origin confusion** | Live origin from `guest.getURL()`; strict scheme/host/port; registrable-domain gating. | `matchCredentialOrigin`, tests for scheme/port/subdomain. |
| **Phishing / lookalike autofill** | Lookalike and IDN/punycode hosts resolve to `none`; page title never used. | `matchCredentialOrigin` tests: `example-login.com`, `xn--…`. |
| **Arbitrary execution** | Fixed, non-model injector; targets by `data-nx-eid`; no `eval`/`new Function`/AI selectors/coords. | `injectCredential` fixed snippet. |
| **Automatic submission** | Never submits; only value + `input`/`change` events. | No `.submit()`/`form.submit` in `register.ts`. |

## 2. Secret memory lifetime

The decrypted password is:
- obtained via `vault.reveal()` **inside** the autofill handler,
- passed directly to `injectCredential(...)`,
- embedded once into the fixed `code` string and executed on the guest,
- unreferenced after the call returns (eligible for GC).

It is never assigned to a module/global variable, cache, store, or log.

## 3. Permission enforcement (defense-in-depth)

- **Renderer:** `vaultAutofillFill` blocks ASK mode before any IPC.
- **Main:** the handler independently rejects `mode === 'ask'`, requires the vault
  unlocked, and requires an origin match — the renderer cannot bypass these.

## 4. Injection integrity

`injectCredential` sanitizes the eid before use
(`String(eid).replace(/[^a-z0-9_]/gi,'')`), uses the native value setter, and only
dispatches `input`/`change`. The renderer-side agent `type` executor continues to
refuse `type="password"` inputs; the only path that writes a password is the
main-only injector, which is gated as above.

## 5. Residual / documented limitations

- Registrable-domain equivalence uses a compact multi-label suffix set, not the full
  PSL (pre-existing, documented in `protection.ts`).
- Detection is bounded to the first ~60 observed interactive elements.
- No phishing guarantee beyond origin-confidence gating.

## 6. Verdict

No plaintext-secret, renderer-exposure, AI-exposure, logging, IPC-exposure,
profile-leak, private-mode-leak, origin-confusion, arbitrary-execution, or
auto-submit findings. **Security Audit: PASS.**
