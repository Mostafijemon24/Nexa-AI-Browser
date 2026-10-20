# NEXA — STEP 7 · Security Audit (Privacy Center & Diagnostics)

Scope: the additive Privacy Center + diagnostics only. Method: source-level review
+ automated source-guard tests (`theme-tokens.test.ts` → "Privacy Center (STEP 7)")
+ behavioural unit tests (`privacy.test.ts`).

Result: **PASS.**

---

## 1. Threat model

The Privacy Center reads system/network/browser signals and renders them. Risks:
falsely reassuring the user (fake protection), leaking data to third parties,
exposing secrets/cookies, crossing profile boundaries, persisting private-mode
activity, or opening a generic execution/network primitive via IPC.

## 2. Attack surface & findings

| Surface | Finding | Evidence |
| --- | --- | --- |
| **External telemetry** | None. No `fetch`/HTTP/STUN/TURN in the privacy path. WebRTC uses empty `iceServers`. | `rg fetch\|http\|stun:` on privacy files → none; `iceServers: []`. |
| **Secret leakage** | No vault/secret access in diagnostics. | `@shared/privacy` + probe touch no vault. |
| **Cookie exposure** | Cookie COUNT only; values never read/returned. | `cookies.get({url})` → `cookies.length`. |
| **AI-generated state** | Diagnostics are deterministic; no AI calls. | no `aiComplete`/`aiChat`/`ollama` in privacy path. |
| **Generic IPC** | One capability-specific, Zod-validated channel. | `privacy.diagnose` only; no `execute`/`runCommand`/`networkRequest`. |
| **eval / shell** | None. | no `eval`/`new Function`/`child_process` in privacy path. |
| **Origin authority** | Live guest origin (`guest.getURL()`) used for cookie scoping; guest ownership verified. | `hostWebContents?.id === win.webContents.id`. |
| **Profile isolation** | Main revalidates `profileId == active`; state resets on switch. | `loadProfilesIndex().activeProfile`; store reset. |
| **Private-mode persistence** | Nothing persisted; report is in-memory only. | no `savePrivacy`/`privacyHistory`; renderer state only. |
| **Fake protection** | Honest enums only; verified-positive labels gated. | `aggregatePrivacy` counts verified/concerns; no `ANONYMOUS`/`100%` labels. |
| **Public-IP fabrication** | A private IP is never labelled public; site-visible public IP is `NOT_CONFIGURED`. | `classifyIp` ranges; `publicIp: 'NOT_CONFIGURED'`. |
| **Fingerprint evasion** | No randomization/spoofing; audit only. | no `randomize`/`spoof`/`Math.random` fingerprinting. |

## 3. Origin authority

Cookie scoping uses the authoritative live guest origin resolved in main via
`webContents.fromId`, verified to be embedded by the app window. Renderer-supplied
URLs are used only as a non-authoritative hint for display; http/https gating via
`parseLiveOrigin`.

## 4. Renderer / main boundary

- **Main** owns OS-level reads (`os.networkInterfaces`, `dns.getServers`) and
  cookie count; returns only classified/safe metadata.
- **Renderer** owns browser-native reads (WebRTC host candidates, fingerprint
  signal availability, permission states) — all local, no network.
- Classification/aggregation is pure (`@shared/privacy`), unit-tested.

## 5. Data retention & logging

No diagnostic result is persisted to disk, session store, or logs. No `console.log`
of network/cookie data was added. The report lives only in renderer memory and is
cleared on profile switch.

## 6. Fingerprint privacy

The audit reports which high-entropy signals are *readable* (surface size), plus
the user's own device values shown locally only. It never transmits, randomizes, or
spoofs values, and implements no anti-fraud/anti-bot/CAPTCHA evasion.

## 7. WebRTC & DNS

- WebRTC: empty `iceServers` → only host candidates; mDNS `.local` treated as
  obfuscated (no exposure); any real IP → `POTENTIAL_EXPOSURE`. No global disable.
- DNS: `dns.getServers()` only (no query); conservative leak verdict; platform
  differences acknowledged (`NOT_CONFIGURED`/`UNKNOWN` where not verifiable).

## 8. VPN integration

Read-only reuse of P4 `VpnStatus`. `PROTECTED`/`VERIFIED` are shown only when the
existing VPN layer verified the tunnel/handshake. No WireGuard helper, adapter,
handshake, or kill-switch logic was touched or bypassed.

## 9. Known limitations

- Site-visible public IP and WebRTC public candidates are `NOT_CONFIGURED` (no
  external service shipped).
- DNS leak detection is conservative and platform-dependent.
- Fingerprint surface is a documented signal-count band, not an entropy score.

## 10. Verdict

No external telemetry, secret/cookie exposure, AI-state fabrication, generic IPC,
eval/shell, profile leak, private-mode persistence, or fake-protection findings.
**Security Audit: PASS.**
