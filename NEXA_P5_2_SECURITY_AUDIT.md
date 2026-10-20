# NEXA P5.2 — Security Audit

Date: 2026-09-16. Scope: additive P5.2 browser tools + hybrid observation.

## Forbidden-pattern scan (agent path)

```
rg "child_process|execFile|spawn|shell:|osascript|powershell|readFile|writeFile|
    unlink|mkdir|eval(|new Function|window.nexa.execute|require("
  src/shared/observation.ts src/shared/agent.ts src/main/services/agent.ts
  src/main/services/agent-permissions.ts src/main/services/agent-ipc-host.ts
→ NONE FOUND (clean)
```

`executeJavaScript` appears **only** in `src/renderer/src/App.tsx`, and only in
fixed, non-model scripts. Model-supplied arguments are injected exclusively via
`JSON.stringify(...)` (data, not code); the ephemeral `eid` is additionally
stripped to `[a-z0-9_]`. There is no `execute_javascript`/`eval` tool and no
generic IPC (`agent.execute`/`runAnything`/`shell`/`filesystem`).

## Preserved P5.1 boundaries (unchanged)

- `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`,
  `webSecurity=true` — untouched.
- Typed capability IPC, Zod validation, profile-id validation in main.
- `PermissionEngine` remains the single authority; decisions use the **live
  Chromium origin**, never a model-supplied URL. Mode-aware (Ask/Assist/Agent).
- P5 `wrapUntrusted()` / `INJECTION_GUARD` fences every page-derived observation,
  including all new `observe`/`extract_*`/`find_text`/`wait_for` outputs.

## New-surface review

| Concern | Result |
|---------|--------|
| Credential exposure | Secret fields redacted at `buildObservation` — value never leaves the page (verified by test + live Ollama run) |
| `javascript:` / `data:` / `file:` URLs | `extract_links` + element hrefs keep **http(s) only**; navigation still `isSafeHttpUrl`-gated |
| Sensitive-field typing | `type` on secret fields → `ask` in every mode; `<input type=password>` blocked in the renderer executor |
| Destructive/high-risk intents | Still `DESTRUCTIVE → deny`, high-risk set → `NOT CONFIGURED` |
| Unbounded observation | Elements ≤ 60, strings/rows/cols/items clamped, readable text reuses P5 truncation |
| Loop / runaway | P5.1 identical-call + new observation-aware (no page change) detection |
| Vision | Honest `VISION NOT CONFIGURED` for text-only models; no screenshot sent to non-vision models |
| Profile / private mode | Reused P5.1: task cancelled + context cleared on profile switch; no persistence in private mode |

## Impossible through the agent (still holds)

```
AI → shell / OS commands           ✗
AI → arbitrary filesystem          ✗
AI → arbitrary JavaScript / eval   ✗
AI → credentials / cookies / tokens ✗
AI → VPN helper / privileged helper ✗
AI → arbitrary IPC                 ✗
AI → payment / silent destructive  ✗
```

## P4.2 VPN

Untouched. Native WireGuard/helper/transport/validation gate remains
**BLOCKED — ENVIRONMENT**. No VPN code was modified for P5.2.
