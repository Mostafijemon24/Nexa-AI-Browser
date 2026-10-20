# NEXA — STEP 6 · Test Matrix (Secure Vault Autofill)

Baseline before STEP 6: **449/449**. After STEP 6: **478/478** (+29).

- `tests/unit/vault-autofill.test.ts` — 20 new behavioural tests.
- `tests/unit/theme-tokens.test.ts` — 9 new source-guard tests
  ("Secure Vault Autofill (STEP 6)").

```
Test Files  32 passed (32)
Tests       478 passed (478)
typecheck   PASS
build       PASS
```

No existing test was deleted, weakened, or reconfigured.

---

## Coverage vs. STEP 6 §29 requirements

### Origin matching (`matchCredentialOrigin`)
| Case | Test | Result |
| --- | --- | --- |
| exact hostname (scheme+host+port) | "exact scheme+host+port" | PASS |
| scheme difference (downgrade) | "rejects scheme downgrade" | PASS |
| port difference | "rejects port difference" | PASS |
| subdomain (same site) | "accepts same-site subdomain as domain confidence" | PASS |
| lookalike domain | "rejects lookalike domains" | PASS |
| internationalized / punycode | "rejects internationalized/punycode lookalikes" | PASS |
| ineligible/invalid input | "rejects ineligible live schemes and invalid input" | PASS |

### Field detection / classification (`classifyField`, `findLoginFields`)
| Case | Test | Result |
| --- | --- | --- |
| username | classify + find | PASS |
| email | classify + find | PASS |
| password | classify (type + autocomplete) | PASS |
| OTP | "classifies OTP and security code" | PASS |
| security code | same | PASS |
| unknown / non-sensitive | "does not treat unknown fields as sensitive" | PASS |
| distinct classes | "PASSWORD ≠ USERNAME, OTP ≠ PASSWORD, …" | PASS |
| target selection (nearest username) | "picks the password field and the nearest preceding" | PASS |
| no password → no target | "returns no password target …" | PASS |

### Security (no secret leakage) — source guards
| Case | Test | Result |
| --- | --- | --- |
| password never in AI context | no AI in autofill path; core carries no secret | PASS |
| password never in renderer state | "the secret NEVER returns to the renderer" | PASS |
| password never in task history | "private mode / profile isolation … no history" | PASS |
| password never in logs | "secret injected in MAIN … no secret logging" | PASS |
| selection contract has no password | "never exposes a password field in the selection contract" | PASS |
| no generic secret IPC | "IPC is capability-specific + request-only" | PASS |

### Permissions
| Mode | Enforcement | Result |
| --- | --- | --- |
| ASK | renderer blocks + main rejects (`data.mode === 'ask'`) | PASS |
| ASSIST | explicit Fill click required | PASS |
| AGENT | explicit Fill action required (no silent policy) | PASS |

### Multiple credentials
| Case | Test | Result |
| --- | --- | --- |
| one match | "returns one/multiple/no matches" | PASS |
| multiple matches | same + "ranks exact before subdomain" | PASS |
| no match | same | PASS |

### Private mode / profile isolation
| Case | Test | Result |
| --- | --- | --- |
| no persistence | "autofill keeps no history" (no `vaultAutofillHistory`) | PASS |
| profile A ≠ profile B | main revalidates active profile; state reset on switch | PASS |

### Form submission
| Case | Test | Result |
| --- | --- | --- |
| autofill never submits | "never auto-submits — only sets values + events" | PASS |

### Failure states (mapped, honest)
| Case | Handling |
| --- | --- |
| vault locked | `vault_locked` → "Unlock the vault to autofill" |
| vault unavailable | `unavailable` state → "Set up vault" |
| invalid/ambiguous target | `no_password_field` → "No login field detected" |
| origin mismatch | `origin_mismatch` → "This site does not match the saved credential" |
| origin ineligible | `origin_ineligible` / `ineligible` state |
| profile mismatch | `profile_mismatch` |
| ask-mode blocked | `vault_blocked_ask` |

### GUI verification
Not performed in this environment (no interactive session run). Status:
**NOT_CONFIGURED** — see final report.
