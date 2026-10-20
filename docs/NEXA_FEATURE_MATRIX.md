# NEXA Feature Matrix

Status legend:
- **FUNCTIONAL (client)** — genuinely works in the prototype, client-side; port the logic.
- **SIMULATED** — realistic UI + state machine, but no real backend; wire to a service.
- **REQUIRES BACKEND / NATIVE / AUTH / OS** — needs native module, provider API, OAuth, or OS integration.

| Feature | Prototype status | Cursor action | Persistence |
|---|---|---|---|
| Design system / tokens / light+dark | FUNCTIONAL | Port to token system | n/a |
| Theme engine (accent variants, presets, address-bar styles, radius/density/motion, ambient bg) | FUNCTIONAL | Recreate; keep runtime accent-mix | per-profile |
| Settings persistence | FUNCTIONAL (localStorage) | Move to profile prefs store | profile |
| Profiles (create/switch/edit/avatar/accent/status) | FUNCTIONAL (client) | Back with real Chromium profile isolation | REQUIRES OS/profile isolation for true isolation |
| Avatar upload + initials fallback | FUNCTIONAL (FileReader) | Validate MIME/size, resize, store locally | profile |
| Dashboard customization (show/hide/reorder widgets, quick actions, layout, greeting, reset) | FUNCTIONAL | Recreate; single source of truth | profile |
| Workspaces (switch, active state) | SIMULATED (state only) | Bind to real tab/session sets | profile/workspace |
| Tabs (open/close/switch, ⌘T/⌘W, new-tab page) | FUNCTIONAL (UI) | Bind to real Chromium tabs; add close-others/left/right, reopen, pin, duplicate, context menu | session |
| Command palette (⌘K) | FUNCTIONAL | Route commands to real services (no duplicate logic) | n/a |
| **Password vault (PBKDF2+AES-GCM, create/unlock/lock, CRUD, generator, strength, reuse/weak audit, copy+clipboard-clear)** | **FUNCTIONAL (WebCrypto)** | Keep crypto; bind key to **OS keychain** via native IPC; add login-form detect + origin-aware autofill | profile, encrypted |
| Password autofill (origin/scheme/host validation, phishing block) | REQUIRES NATIVE (form detection + fill) | Implement fail-closed autofill | profile |
| Downloads UI (queue, states, detail, clear completed) | SIMULATED | Wire to real download engine | profile |
| Download engine (segmented/turbo, pause/resume/retry, speed/ETA, integrity) | REQUIRES NATIVE | Native multi-connection download service | profile |
| Cloud transfer (Drive/GCS/Dropbox/OneDrive/S3/custom, pickers) | SIMULATED + REQUIRES AUTH | OAuth + provider SDKs; tokens in secure store | profile, tokens encrypted |
| AI side panel (ASK/ACT/DOWNLOAD/RESEARCH/ORGANIZE, execution plan) | SIMULATED | Provider abstraction (OpenAI-compat/Anthropic/Google/Ollama/LM Studio); local default | keys in secure store |
| AI ↔ vault/cookies/tokens firewall | DESIGN INTENT | Enforce: AI has NO vault/cookie/token access by default | n/a |
| VPN (state machine, 34-country catalog, best-for, search, quick panel, diagnostics, kill switch, DNS/WebRTC/IPv6, split tunnel) | SIMULATED | WireGuard/OpenVPN/SOCKS5/proxy adapters; states must reflect real tunnel | profile |
| Content protection / ad blocker (modes, categories, filter lists, per-site, stats) | SIMULATED (toggles real, counts static) | Real filter engine (EasyList-compatible); live counters | profile |
| Security Center (real states) + Privacy toggles (AI page-data OFF, telemetry OFF, crash OFF, secure DNS) | FUNCTIONAL (toggles) | Bind indicators to real subsystem state | profile/global |
| Extensions manager (list, enable/disable, remove, permissions, load-unpacked) | SIMULATED | Chromium extension APIs; sandboxed; no vault access | profile |
| DevTools | REQUIRES NATIVE | Use Chromium DevTools (F12) | n/a |
| Bookmarks | DESIGNED, NOT IMPLEMENTED (routes to placeholder) | Implement add/edit/delete/folders/search/manager/import/export | profile |
| History / Collections | DESIGNED, placeholder | Implement | profile |
| About / Open Source | FUNCTIONAL (UI) | Wire Check-for-Updates, GitHub, license, system info to real actions | n/a |
| Account / sign-in | DESIGN INTENT (honest "not configured") | Provider abstraction; never fake auth; usable without account | n/a |
| Collapsible title bar (hidden default, ⌘⇧H, persisted) | FUNCTIONAL | Recreate | global |
| Auto-update | REQUIRES BACKEND | Signed update channel; no fake "up to date" | n/a |
| Installers (macOS/Win/Linux), signing, notarization | REQUIRES BUILD PIPELINE | See NEXA_CROSS_PLATFORM.md | n/a |

## Known gaps to call out explicitly to users in-product
Bookmarks, History, Collections are placeholders. Downloads/VPN/Cloud/AI/Ad-engine are UI+state without native backends. The prototype already labels these honestly ("requires backend", "simulated data", "requires native module") — keep those labels until each backend lands.
