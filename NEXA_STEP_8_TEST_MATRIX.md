# NEXA — STEP 8 · Test Matrix (Google Drive Integration)

Baseline before STEP 8: **512/512**. After STEP 8: **550/550** (+38).

- `tests/unit/drive.test.ts` — 24 behavioural tests.
- `tests/unit/theme-tokens.test.ts` — 14 source-guard tests ("Google Drive (STEP 8)").

```
Test Files  34 passed (34)
Tests       550 passed (550)
typecheck   PASS
build       PASS
```

No existing test was deleted or weakened.

---

## Coverage vs. STEP 8 §40/§41 requirements

### OAuth
| Case | Test | Result |
| --- | --- | --- |
| minimum read-only scope | "uses the minimum read-only scope" | PASS |
| S256 PKCE + offline auth URL | "builds an S256 PKCE offline auth URL" | PASS |
| loopback-only redirect | "accepts only loopback redirect URIs" | PASS |
| state validation | "validates state" | PASS |
| callback parse (code+state) | "parses a valid callback" | PASS |
| provider error (access_denied) | "returns provider error without throwing" | PASS |
| invalid callback rejection | "rejects mismatched path / missing code / non-loopback" | PASS |
| expired-token handling | "treats missing/expired tokens as expired" | PASS |
| expiry from expires_in | "computes absolute expiry" | PASS |

### Drive metadata
| Case | Test | Result |
| --- | --- | --- |
| normalization (drops unsafe/unknown) | "normalizes a raw file…" | PASS |
| folder / workspace flags | "flags folders and workspace files" | PASS |
| invalid id rejection | "rejects objects with invalid ids" | PASS |
| MIME → kind | "mimeToKind gives friendly labels" | PASS |
| Workspace export mapping | "maps supported Workspace types" | PASS |
| unsupported export → null | "returns null (EXPORT_NOT_SUPPORTED)" | PASS |

### Security (behavioural)
| Case | Test | Result |
| --- | --- | --- |
| file-id validation | "validates Drive file IDs" | PASS |
| unsafe URL rejection | "accepts only https google-owned links" | PASS |
| download URL builders reject bad ids | "builds alt=media download URL and rejects bad ids" | PASS |
| export URL builder | "builds export URL with mimeType" | PASS |
| bounded/escaped list URLs | "builds bounded, escaped list URLs" | PASS |
| folder scoping only with valid id | "scopes folder listing by parent id only when valid" | PASS |
| error normalization (no secrets) | "maps statuses…", "messages never contain tokens" | PASS |
| bounded backoff | "grows then caps" | PASS |

### Security (source guards)
| Case | Test | Result |
| --- | --- | --- |
| no token in renderer state/storage/URL | guard | PASS |
| tokens only in main + SecureStorage | guard | PASS |
| minimum scope; no write/delete/gmail/calendar | guard | PASS |
| OAuth main-authoritative (PKCE+state+loopback) | guard | PASS |
| reuses P2 engine; no second download manager | guard | PASS |
| Drive API authoritative for downloads | guard | PASS |
| capability-specific IPC; no eval/shell/generic | guard | PASS |
| main revalidates active profile | guard | PASS |
| disconnect never deletes files (revoke only) | guard | PASS |
| honest states; no fake cloud; no hard-coded creds | guard | PASS |
| open-in-Drive strict https validation | guard | PASS |
| no AI in Drive path | guard | PASS |
| profile isolation reset | guard | PASS |
| Drive UI accessible (aria-live + labels) | guard | PASS |

### Downloads / Click-to-Go / Command Palette
- P2 handoff + no duplicate engine + correct filename/export are covered by the guard tests and
  the export-mapping behavioural tests. Click-to-Go `drive` command is covered by the existing
  `click-to-go.test.ts` "every command id maps to a real view" invariant; palette `Cloud` group +
  Drive commands are wired with real handlers (source-verified).

### Error handling (offline/401/403/404/429/invalid_grant/API-down)
Covered by `normalizeGoogleError` tests (401/403/404/429/5xx + invalid_grant) and safe-message tests.

### Live / environment
- **OAuth Live Test:** NOT_CONFIGURED — ENVIRONMENT (no Google Cloud credentials).
- **GUI Verification:** NOT_CONFIGURED — ENVIRONMENT (headless).
- **Lint:** NOT_CONFIGURED (stub).
