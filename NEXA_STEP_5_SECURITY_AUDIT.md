# NEXA — STEP 5 Security Audit (Worker Assistant)

Scope: the additive Worker Assistant layer. Verifies STEP 5 introduces no new
execution surface, no secret exposure, no silent high-risk actions, and no
weakening of the existing Electron/agent security posture.

## 1. No generic execution path

| Check | Status | Evidence |
|-------|--------|----------|
| No `eval` / `new Function` | **PASS** | Not present in `worker.ts`, worker store slice, or WorkerPanel; guarded by source tests |
| No arbitrary `executeJavaScript` | **PASS** | Fill uses only fixed executor tools; capture uses fixed `OBSERVE_SRC`/`WORKER_EXTRAS_SRC` (non-model) |
| No model-generated selectors/JS | **PASS** | Targets resolved by ephemeral `eid` via existing `resolveTarget`; model output is only answer text |
| No shell / generic filesystem | **PASS** | Worker never touches shell or fs |
| No generic IPC (`worker.execute`) | **PASS** | No new IPC channel; reuses `ai.chat` + existing agent executor only |
| Only registered ids executable | **PASS** | `buildFillPlan` maps to `type`/`select_option`/`set_checkbox`; unknown field types → no action |

## 2. Secret / credential protection

| Check | Status | Evidence |
|-------|--------|----------|
| Password fields never typed | **PASS** | Excluded by `toolForFieldType('password') → null`; executor also blocks `type` into password inputs |
| Secret values never in scan | **PASS** | `buildObservation` omits secret values; `WorkerField.value` undefined when secret (tested) |
| Secret values never in AI context | **PASS** | Suggestions skip secret fields entirely; only labels + non-secret context sent |
| No secret in suggestions/logs/history | **PASS** | Serialized-scan test asserts no `hunter2`/OTP/API-key/card values; history stores counts + host only |
| OTP / token / card / SSN detection | **PASS** | Reuses `SENSITIVE_FIELD_RE` / `isSensitiveField` (tested) |
| Vault secrets to model | **NOT_CONFIGURED** | Vault autofill deferred to a later phase; not exposed |

## 3. Silent high-risk action prevention

| Check | Status | Evidence |
|-------|--------|----------|
| Never submits a form | **PASS** | No submit tool; agent `submit*` remain in `HIGH_RISK_UNAVAILABLE` |
| Never clicks final action buttons | **PASS** | Worker classifies buttons for display only; no `click` in worker path |
| No send/purchase/pay/delete/publish | **PASS** | High-impact button classes flagged, never actioned |
| Default stops at REVIEW REQUIRED | **PASS** | `finalizeWorkerFill` → state `review`; user submits manually |
| Sensitive writes confirmation-gated | **PASS** | `workerFillDecision` → `confirm` for secret; ASSIST confirms all; ASK blocks all |

## 4. Prompt-injection defense

| Check | Status | Evidence |
|-------|--------|----------|
| Page text treated as untrusted data | **PASS** | `buildWorkerSuggestionMessages` fences with `wrapUntrusted` + `INJECTION_GUARD` |
| Fence-marker spoofing neutralized | **PASS** | `wrapUntrusted` strips injected markers (tested: only one wrapper marker remains) |
| Hostile instructions stay inert | **PASS** | "ignore previous instructions"/"reveal system prompt" remain fenced content (tested) |
| Model cannot route navigation/actions | **PASS** | AI only returns answer text; fill decisions are deterministic + permission-gated |

## 5. Privacy / isolation

| Check | Status | Evidence |
|-------|--------|----------|
| Private mode: no task-history persistence | **PASS** | `finalizeWorkerFill` skips history when `isPrivate` |
| Private mode: page context not persisted | **PASS** | Context text held in non-persisted module var; cleared on session clear |
| No worker state in persisted session/prefs | **PASS** | Worker fields excluded from `persistSession`/`persistPrefs` |
| Profile isolation | **PASS** | All worker state + `workerCtx` reset in `switchProfile`; history filtered by profile |
| AI request carries private flag | **PASS** | `aiComplete(..., { private })` passed to `ai.chat` |

## 6. Electron / platform posture (unchanged)

| Setting | Status |
|---------|--------|
| `sandbox=true` · `contextIsolation=true` · `nodeIntegration=false` · `webSecurity=true` | **PASS (unchanged)** |
| CSP | **PASS (unchanged)** |
| No new preload/IPC surface | **PASS** |

**No security regressions.** STEP 5 did not weaken any existing security class,
permission gate, or Electron setting to enable Worker features.
