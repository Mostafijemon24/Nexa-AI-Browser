# NEXA — STEP 7 · Privacy Center & Real-Time Privacy Diagnostics

Additive, honesty-first Privacy Center built on the existing P3 protection, P4 VPN,
profile, IPC and design-token systems. **No engine was replaced or duplicated.**
No AI is required for any diagnostic. No fake protection states are ever emitted.

---

## 1. What it does

A dedicated **Privacy Center** view surfaces the browser's real privacy/security
posture on demand. Every value is either verified or honestly labelled
`UNKNOWN` / `UNAVAILABLE` / `NOT_CONFIGURED` / `CHECKING`.

Entry points (all functional):
- Toolbar shield popover → **Privacy Center** button
- Settings → Privacy → **Open Privacy Center**
- Command Palette → **Privacy** group (Open, Run Check, IP, DNS, WebRTC, Fingerprint)
- Click-to-Go: `privacy`, `privacy center`, `privacy scan`, `check privacy`,
  `ip check`, `dns check`, `webrtc check`, `fingerprint check`

## 2. Architecture

```
PrivacyCenterView  ──▶  store.runPrivacyCheck()  (orchestration, session-only)
                              │
        ┌─────────────────────┼──────────────────────────────┐
        ▼                     ▼                               ▼
 existing P3 store       existing P4 store             browser-native probe
 (protection snap)       (vpn status)                  (renderer, App.tsx)
        │                     │                     WebRTC · fingerprint · permissions
        │                     │                               │
        │                     │                     IPC privacy.diagnose (main)
        │                     │                     os.networkInterfaces + dns.getServers
        │                     │                     + cookie COUNT (live origin)
        └──────────┬──────────┴───────────────┬───────────────┘
                   ▼                           ▼
          pure @shared/privacy classifiers (deterministic)
                   ▼
             PrivacyReport (in-memory, never persisted)
```

## 3. Files added / changed

| File | Change |
| --- | --- |
| `src/shared/privacy.ts` (NEW) | Pure core: IP classification, HTTPS, interface summary, WebRTC/DNS normalization, fingerprint surface, aggregation, origin authority. |
| `tests/unit/privacy.test.ts` (NEW) | 25 unit tests. |
| `src/renderer/src/views/PrivacyCenter.tsx` (NEW) | The Privacy Center view (cards, `aria-live`, honest pills). |
| `src/shared/channels.ts` | + `privacyDiagnose`. |
| `src/shared/ipc.ts` | + `privacyDiagnoseSchema` (Zod, bounded, request-only). |
| `src/shared/session.ts`, `src/shared/types.ts` | + `'privacy'` ChromeView. |
| `src/main/ipc/register.ts` | + `privacy.diagnose` handler (profile revalidation, `os.networkInterfaces`, `dns.getServers`, live-origin cookie COUNT). |
| `src/preload/index.ts`, `src/renderer/src/nexa.d.ts` | + `privacy.diagnose` bridge + types. |
| `src/renderer/src/state/store.ts` | + privacy slice, `setPrivacyProbe`, `runPrivacyCheck`, `openPrivacyCenter`, profile reset. |
| `src/renderer/src/App.tsx` | + WebRTC/fingerprint/permission probe, view route, AdPanel entry, palette `Privacy` group. |
| `src/shared/click-to-go.ts` | + `privacy` command (shared registry). |
| `src/renderer/src/views/Settings.tsx` | + "Open Privacy Center" row in Privacy. |
| `tests/unit/theme-tokens.test.ts` | + 9 STEP-7 source-guard tests. |

## 4. Diagnostics — what is real vs honest-unavailable

| Diagnostic | Implementation | Honesty |
| --- | --- | --- |
| **HTTPS** | From the live URL only (`classifyHttps`). | IMPLEMENTED |
| **Content protection** | Reuses P3 store snapshot (`perDomain[domain]` blocked/requests, state). | IMPLEMENTED (reused) |
| **VPN** | Reuses P4 `VpnStatus` (state, `health.handshakeAgeSec`, killSwitch, ipv6). `PROTECTED`/`VERIFIED` only when the VPN layer verified it. | IMPLEMENTED (reused) |
| **Local interface IPs** | Main `os.networkInterfaces()`, classified (`summarizeInterfaces`). IPv4/IPv6 counts + IPv6 availability. | IMPLEMENTED |
| **Site-visible public IP** | Not determined — NEXA ships no external IP-echo service. | `NOT_CONFIGURED` (honest) |
| **DNS** | Main `dns.getServers()` → `normalizeDns`. Leak verdict conservative: `NO_LEAK_DETECTED` only when VPN connected AND all resolvers tunnel-side; `POTENTIAL_LEAK` when a public resolver is used under VPN; `UNKNOWN` without VPN. | IMPLEMENTED (platform-dependent) |
| **WebRTC** | Renderer `RTCPeerConnection` with **empty `iceServers`** (no external STUN) → host candidates only → `normalizeWebrtc`. Detects local-IP exposure with zero external calls; mDNS `.local` = obfuscated. Public-candidate detection would need STUN. | IMPLEMENTED (public-candidate = NOT_CONFIGURED) |
| **Fingerprint surface** | Renderer signal-availability probe → `buildFingerprint` → deterministic surface band (documented thresholds). | IMPLEMENTED |
| **Permissions** | Renderer `navigator.permissions.query` (camera/mic/geo/notifications/clipboard). | IMPLEMENTED (some `unavailable` per platform) |
| **Cookies** | Main `session.cookies.get({url})` → COUNT only (never values). | IMPLEMENTED |

## 5. Origin authority

Site-specific checks use the live tab URL, and — for cookie scoping — the
**authoritative live guest origin** (`guest.getURL()` via `webContents.fromId`,
verified to belong to our window). Renderer-claimed origins are never trusted for
main-side work. `parseLiveOrigin`/`isDiagnosableOrigin` gate http/https only.

## 6. Profile isolation & private mode

- Main revalidates `profileId` against the persisted active profile before any work.
- `privacyReport` is renderer-only, in-memory state; it is **never persisted**.
- On `switchProfile`, all privacy state resets to idle (`privacyReport: null`).
- Private mode leaves no diagnostic/IP/DNS/WebRTC/fingerprint history on disk —
  nothing is written anywhere in any mode.

## 7. AI boundary

Diagnostics are fully deterministic and never call AI. `@shared/privacy` imports no
model/LLM code; `runPrivacyCheck` performs no AI calls. (AI may *explain* a result
in a future step, but can never generate the underlying state.)

## 8. IPC boundary

One capability-specific, Zod-validated channel: `privacy.diagnose`. Bounded input
(`profileId`, optional `url`, optional `webContentsId`); safe output (interface
classes, resolver strings, cookie count, live URL). No generic `execute`/
`runCommand`/`networkRequest`/`shell`/`eval`.

## 9. Network privacy

No external diagnostic endpoint is contacted. WebRTC uses an empty `iceServers`
list (no STUN/TURN). DNS/IP come from local OS APIs. Nothing (passwords, cookies,
tokens, history, page content, AI context) is ever transmitted.

## 10. Performance

On-demand only. WebRTC gathering is bounded to 1.5s. No background scanning, no
continuous fingerprinting, no polling, no artificial delays.

## 11. Honest limitations

- **Public IP (site-visible):** `NOT_CONFIGURED` — no external echo shipped.
- **WebRTC public candidates:** require an external STUN server → not probed.
- **DNS leak certainty:** conservative; only claims `NO_LEAK_DETECTED` under a
  verified VPN with tunnel-side resolvers. Platform DNS exposure varies
  (macOS/Windows/Linux) — `dns.getServers()` reflects the resolver set known to the
  runtime, which may differ from system-wide configuration.
- **Fingerprint surface:** signal-availability count with documented bands; not a
  uniqueness/entropy score.
- **Cookies:** count only; values are never read or shown.
- No fingerprint spoofing/randomization and no evasion of fraud/CAPTCHA/anti-bot —
  out of scope by design (privacy audit only).
