# NEXA RC-1 — Release Candidate Validation Checklist (macOS)

**Build under test:** NEXA 0.1.0 · Electron **44.4.1** · Chromium ~140 · Node 24
**Purpose:** Everything that must be validated on a real macOS machine before RC-1
sign-off. The *automated* portion is executed by `scripts/rc1-validate.sh`; the
*manual* portion below requires a display, signing identity, and live services.

Mark each item: `[x]` PASS · `[!]` FAIL (file a blocker) · `[~]` BLOCKED — ENVIRONMENT.
Every FAIL must reference a defect ID.

---

## 0. Automated gate (run first, on any machine)

```bash
bash scripts/rc1-validate.sh
```

Expected: **17 passed, 0 failed**, exit code 0. Covers: Electron 44.4.1 pin, lint
(0/0), typecheck, 746 tests, RC-1 runtime harness (`reports/rc1-validation.json`
and `reports/rc1-validation.md`), clean+build, artifact layout, main entry, no
eval/`shell:true`, no raw `ipcRenderer` exposure, hardened `webPreferences`,
SEC-1 permission wiring on default+persist+private sessions, extension
`allowFileAccess:false`, dependency audit (2 moderate dev-only vitest).
Environment-only items in the harness stay BLOCKED — ENVIRONMENT, never PASS.

- [ ] `rc1-validate.sh` → 17/0, exit 0

---

## 1. Signed + notarized package build  *(needs Developer ID + notarization creds)*

Prereqs (env): `CSC_LINK`/keychain Developer ID Application identity;
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization.

```bash
npm run package:mac            # clean → build → electron-builder --mac
```

- [ ] Build completes; `dist/` contains `NEXA-0.1.0-*.dmg` and `*-mac.zip`
- [ ] `.app` icon is the NEXA icon (PNG→`.icns` conversion is confirmed working)
- [ ] `codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/NEXA.app"` → valid on disk
- [ ] `spctl -a -vvv -t install "dist/mac-arm64/NEXA.app"` → accepted / notarized
- [ ] `xcrun stapler validate "dist/mac-arm64/NEXA.app"` → stapled
- [ ] Hardened Runtime present; entitlements match `build/entitlements.mac.plist`
- [ ] asar present; `test-extension/`, `src/`, `tests/`, `scripts/` NOT in bundle

> If credentials are absent, mark `[~]` and validate an **unsigned** `--dir` build
> for functionality only: `npx electron-builder --dir --mac`.

---

## 2. First launch & window

- [ ] `open dist/mac-arm64/NEXA.app` launches without Gatekeeper block (signed)
- [ ] Window shows (hidden-inset traffic lights, 1440×900 default), no white flash beyond splash
- [ ] Settings → About (or dev appInfo) reports **electron 44.4.1**, chrome ~140, channel **stable**
- [ ] No DevTools/console errors on boot; no unhandled promise rejections in Console.app

---

## 3. Electron 44 runtime regressions  *(highest priority — new this cycle)*

### 3a. Async clipboard (vault copy) — the one adapted breaking change
- [ ] Vault → reveal a saved credential → **Copy password**
- [ ] Paste elsewhere immediately → the password is on the clipboard (write awaited)
- [ ] Wait 30 s without copying anything else → clipboard is cleared (auto-clear via Promise path)
- [ ] Copy download URL (Downloads → Copy URL) still works (renderer `navigator.clipboard`)

### 3b. Permission policy (SEC-1) — deny-by-default on tab partitions
Open a normal tab AND a private tab; visit test pages:
- [ ] Geolocation request (e.g. `openstreetmap.org` locate) → **denied**, no prompt-bypass
- [ ] Camera/microphone (`webrtc.github.io/samples/`) → **denied**
- [ ] Screen capture / display-capture → **denied**
- [ ] Fullscreen (video full-screen button) → **allowed**
- [ ] Pointer lock (a canvas game) → **allowed**
- [ ] Notifications prompt → allowed (documented pre-existing behavior)
- [ ] Same results in a **second profile** and in **private** tabs (policy is per-partition)

### 3c. Webview / rendering
- [ ] Navigate to a heavy HTTPS site (youtube/github) → renders, scrolls, video plays
- [ ] `window.open`/target=_blank → opens in the OS default browser (external), not a NEXA popup
- [ ] Mixed-content / insecure resource is blocked (webSecurity on)

---

## 4. Per-feature P0–P13 walkthrough

### 4.1 Profiles & isolation
- [ ] Create Profile B; switch A↔B; each has independent tabs/bookmarks/history/downloads
- [ ] A cookie/login in Profile A is NOT visible in Profile B
- [ ] Delete a profile → its data directory is gone; other profiles intact

### 4.2 Private mode
- [ ] Open private window; browse; close it → no history/cookies/downloads persisted
- [ ] Private tabs are not restored on relaunch

### 4.3 P2 Downloads
- [ ] Start a large download → progress, speed, ETA update
- [ ] Pause / resume / cancel / retry each work
- [ ] Concurrent downloads queue correctly; queue promotes on completion
- [ ] Filename sanitization (try a URL with `../` or reserved name) → safe filename
- [ ] Open file / show in folder / copy URL work
- [ ] Private-mode download is not written to the persistent downloads list

### 4.4 P3 Content Protection
- [ ] Toggle protection; badge/count reflects blocked requests on an ad-heavy page
- [ ] Per-site allow/block override works and is scoped to the site
- [ ] Protection stats are per-profile; not leaking across profiles/private

### 4.5 P4 VPN (native)  *(needs signed helper + WireGuard)*
- [ ] Import a WireGuard config → validates; bad config → honest error (no crash)
- [ ] Connect → status becomes **PROTECTED only after real handshake**
- [ ] Kill switch blocks traffic when tunnel drops
- [ ] DNS/IPv6/WebRTC leak checks in Privacy Center reflect the tunnel
- [ ] Disconnect cleanly; sleep/wake revalidates; no fake state if helper absent (`NOT_CONFIGURED`)

### 4.6 P5 AI + P5.1/5.2/5.3 Agent  *(needs Ollama at 127.0.0.1:11434)*
- [ ] AI status shows CONNECTED with a real local model; OFFLINE when Ollama is down (no fake)
- [ ] Summarize / explain / translate / page Q&A stream and can be cancelled
- [ ] Agent task: plans → asks permission → executes fixed tools; never runs arbitrary JS
- [ ] Agent stops at step cap / no-progress; pause/resume/cancel work
- [ ] Page content is treated as untrusted (injection attempt in page does not hijack the agent)

### 4.7 Worker Assistant
- [ ] Scan a form → suggestions → fill fields → **never auto-submits**; user submits
- [ ] Sensitive fields handled; task history per-profile; disabled/ephemeral in private

### 4.8 Vault / Autofill
- [ ] Create master password; lock/unlock; add/edit/delete credentials
- [ ] Autofill on a matching origin only (scheme/host/port/registrable domain)
- [ ] Reveal/copy require unlocked vault; password never appears in DevTools/renderer state
- [ ] (ties to 3a) copy auto-clears after 30 s

### 4.9 P7 Privacy Center
- [ ] Diagnostics show honest states (SUPPORTED / PARTIALLY_SUPPORTED / NOT_CONFIGURED)
- [ ] No claim of an unavailable external diagnostic as real

### 4.10 P8 Google Drive  *(needs `NEXA_GOOGLE_CLIENT_ID`)*
- [ ] Connect → OAuth loopback (127.0.0.1) → CONNECTED; email shown, **no token in UI/DevTools**
- [ ] List/search/select; large-file download hands off to P2 (appears in Downloads)
- [ ] Workspace export format handling; disconnect revokes and clears tokens
- [ ] Tokens never in logs (check Console.app), localStorage, or IPC responses

### 4.11 P9 Turbo
- [ ] Preconnect/nav-timing shown as real measurements; no fake "x% faster"/"1-second" claims
- [ ] Prediction disabled for sensitive/private/cross-profile navigation

### 4.12 P10 Regional
- [ ] Set timezone/locale/preferred languages → `Accept-Language` reflects order
- [ ] Page runtime tz/locale honestly shown PARTIALLY_SUPPORTED; no navigator spoofing

### 4.13 P11 Dashboard
- [ ] Each widget shows real state (downloads/protection/vpn/ai/worker/drive/privacy/turbo/profile/regional/recent/bookmarks/collections/history/extensions)
- [ ] Layout persists per profile; invalid/legacy layout migrates; cold start OK

### 4.14 P13 Extensions (live MV3 load)
- [ ] Settings → Extensions → Install local extension → select `test-extension/`
- [ ] Permission review shows correct permissions/hosts/risk before enabling
- [ ] Content script runs on `https://example.com/*` (marker element appears)
- [ ] Service worker starts; storage works; action/popup opens
- [ ] Enable/disable/remove work; state is per-profile; **disabled in private unless opted in**
- [ ] Confirm extension cannot read `file://`, cannot reach `window.nexa`, cannot bypass P3

### 4.15 P12 Multi-Provider AI
- [ ] Provider cards show Ollama LOCAL Connected; OpenAI/Anthropic NOT_CONFIGURED
- [ ] Configure a cloud key (test key) → stored via safeStorage; key never echoed to UI/logs
- [ ] Local-first routing; privacy mode `local_only` blocks cloud; explicit fallback only
- [ ] Switching profile switches AI config; no cross-profile leakage

---

## 5. Crash / offline / recovery
- [ ] Kill the renderer (Activity Monitor) → NEXA recovers the tab, no full crash
- [ ] Turn off networking → AI/Drive/VPN show honest OFFLINE/NOT_CONFIGURED (no fake states)
- [ ] Force-quit mid-download → relaunch → download state recovers safely (no corruption)
- [ ] Relaunch → non-private session restores; private does not

## 6. Running-app security spot-checks
- [ ] In a tab DevTools console: `typeof require` → `undefined`; `typeof process` → `undefined`
- [ ] `window.nexa` exposes only the intended capability namespaces (no `ipcRenderer`, no fs/shell)
- [ ] `localStorage`/`sessionStorage` contain no API keys / tokens / passwords
- [ ] Console.app shows no logged secrets (keys, tokens, cookies, page content)

---

## 7. Sign-off

| Area | Result | Notes |
|------|--------|-------|
| Automated gate (§0) | | |
| Package + sign + notarize (§1) | | |
| Launch (§2) | | |
| Electron 44 regressions (§3) | | |
| Features P0–P13 (§4) | | |
| Crash/offline/recovery (§5) | | |
| Security spot-checks (§6) | | |

**RC-1 decision (choose one):**
`RELEASE-READY` · `RELEASE-READY WITH ENVIRONMENT LIMITATIONS` · `NOT RELEASE-READY`

Blocking defects: ______  ·  Validator: ______  ·  Date: ______

---

### Environment prerequisites summary
Developer ID + notarization creds · display · Ollama (`qwen3:8b`, `nomic-embed-text`)
· `NEXA_GOOGLE_CLIENT_ID` · signed WireGuard helper + a WireGuard peer · normal internet.
Any missing prerequisite → mark the dependent items `[~] BLOCKED — ENVIRONMENT`
(not FAIL).
