# NEXA_FINAL.md — Product Evolution Status

**Scope of this environment:** NEXA exists here as a **high-fidelity design prototype**
(`Conduit.dc.html`) plus the engineering handoff in `design_handoff_nexa/`. **No NEXA
source repository is connected to this project.** Therefore every item below is reported
against what was actually built in the prototype — not against a repo.

## FINAL STATUS: **READY WITH LIMITATIONS**

Ready: the full UX architecture for this evolution is designed, implemented and
interactive in the prototype. Limitations: all repo-level tasks (`npm test`,
`npm run typecheck`, `npm run build`, lint, Electron main/preload/IPC, Zod capability
schemas, Ollama code-path validation, P2/P3/P4/P5 service wiring) **cannot be performed
without the codebase connected** and are explicitly NOT claimed as done.

---

## 1. Implemented in the prototype (verified interactive)

| Feature | What exists | Verified |
|---|---|---|
| **Click-to-Go** | Integrated into the address bar (not a separate launcher). Focus or caret opens a grouped panel: Websites / Actions / Downloads / Privacy / Profiles. Central `ctgRegistry()` + `ctgResults()` ranked resolver (exact → prefix → keyword → substring). Keyboard: ↑/↓ navigate, ⏎ execute highlighted, Esc close, click-outside closes. Unknown input falls back to normal URL/search/AI intent. Only **registered NEXA capabilities** are invocable — no shell/JS/fs/arbitrary IPC surface exists. State-aware (Drive shows *Connect* vs *Open*). "Requires permission" badge for gated intents. | Yes |
| **Worker Assistant** | A **UX preset on the existing assistant panel**, not a fourth runtime — added as the `WORKER` tab alongside ASK / ACT / RESEARCH / ORGANIZE. Flow: idle → **Scan page** → scanning states → scanned. Shows detected question, AI suggestion (Use / Edit / Copy), detected-field checkboxes, and **Fill N selected**. Copy in-panel. | Yes |
| **No silent submission** | Worker fills only on explicit action; panel states "You review and submit — Worker never submits for you." | Yes |
| **Sensitive-field gating** | Separate **Protected fields** block: Password and OTP marked *never auto-filled by Worker*; Card/CVV marked *not configured*. | Yes |
| **Privacy Center** | New Settings section with honest per-row diagnostics (IP, DNS, WebRTC, IPv6, Fingerprint, HTTPS, trackers, VPN tunnel), each bound to real in-app configuration state, plus **Run privacy check** with a real busy→complete state. | Yes |
| **Privacy honesty** | Fingerprint is labelled **Audit only**; WebRTC/IPv6 show *Not configured* unless enabled; footer states measurement **requires native module** and that this build reports *configuration state, not measured network results*. Explicit note: privacy tooling only — **no anti-fraud / anti-abuse evasion**. | Yes |
| **Turbo Navigation (UX)** | Compact in-omnibox indicator with four honest states: Active / Optimizing / Limited / Off. Persisted. **No speed numbers, no "1 second" claim, no fabricated metrics.** | Yes |
| **Profile timezone** | Per-profile Regional Settings → Timezone (System default, Asia/Dhaka, Asia/Kolkata, Europe/London, America/New_York, Asia/Tokyo). Site-level override explicitly labelled **experimental**. | Yes |
| **Profile locale** | Language & locale picker (incl. বাংলা, हिन्दी). States it sets UI language + Accept-Language and **does not claim website-level locale spoofing**. | Yes |
| **Google Drive click-to-connect** | Connect / Connected / Disconnect states with status dot; honest toast that OAuth requires the native build. Footer documents least-privilege scopes + tokens in OS credential store via typed IPC, never the renderer, and that downloads route through the **existing** download engine. | Yes |
| **Command palette (state-aware)** | Added: Worker scan, Privacy Center, **Connect Google Drive ⇄ Open Google Drive** (state-dependent), Turbo cycle — all routed to the same handlers the UI uses (no duplicated logic). | Yes |
| **Sidebar** | Added **Work** and **Privacy** entries only — kept compact (no 20-icon sidebar). | Yes |
| **Dashboard** | Added compact **Quick Go**, **Worker**, **Privacy** widgets to the existing per-profile widget registry (show/hide/reorder already supported). No giant cards, no charts. | Yes |
| **Design preservation** | Zero redesign. All additions reuse existing tokens (`--accent`, `--surface`, `--border`, `--r`, motion keyframes, Phosphor icons, IBM Plex). No second design system. Light + dark both work. | Yes |
| **Persistence** | `turbo`, `driveConnected`, `profileTz`, `profileLocale` added to the persisted key set; survive reload. | Yes |
| **Accessibility** | Click-to-Go fully keyboard-operable with `role="listbox"`/`role="option"` and aria-labels; Turbo and Click-to-Go buttons labelled; existing focus/contrast patterns retained; reduced-motion honored via the existing motion system. | Yes |

## 2. NOT CONFIGURED (requires the repository / native build)
`npm test` · `npm run typecheck` · `npm run build` · lint · Electron main/preload changes ·
Zod-validated typed IPC schemas for the new capabilities · Ollama/P5 code-path validation ·
P5.2 Observation-Engine binding for real page scanning · real Smart Fill against live DOM ·
Drive OAuth + real Drive→P2 download · real IP/DNS/WebRTC/fingerprint measurement ·
real Turbo optimizations (connection reuse, preconnect, safe prefetch, prediction) ·
real per-profile Chromium timezone/locale overrides · profile storage isolation ·
startup/navigation performance measurement · automated test suites.

## 3. BLOCKED — ENVIRONMENT
**P4.2 native VPN production transport: BLOCKED — ENVIRONMENT.** Unchanged, as instructed.

## 4. Nothing rebuilt or duplicated
No second AI runtime, agent, observation engine, download engine, protection engine,
permission engine, command palette, profile engine, or IPC architecture was created.
Worker reuses the assistant panel; Drive/downloads route to the existing engine; Privacy
Center reads existing protection/VPN state; Click-to-Go dispatches to existing handlers.

## 5. Honest caveat
Prototype-layer state for downloads, VPN, cloud, AI and the ad engine remains **simulated**
and is labelled as such in-product. Per the no-fake-features rule, none of it is reported
as production-complete here. Next step to close section 2: connect the NEXA repository so
the audit, wiring, tests, typecheck, build and lint can actually be run.
