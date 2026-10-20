# NEXA Browser — Engineering Handoff (Claude → Cursor)

> **NEXA — The Open-Source AI Browser Built Around Downloads**
> Browse. Protect. Download. Understand. Transfer.

## Overview
NEXA is a Chromium-based desktop browser with an integrated AI layer, an IDM-class
download engine, a privacy/content-protection engine, a VPN/network layer, cloud
transfer, a local password manager, profiles/workspaces, and a deep theme/personalization
system. This bundle is the handoff for taking the approved design into a real, installable
desktop application for **macOS, Windows and Linux**.

## About the design files — READ FIRST
The file `NEXA_prototype.dc.html` in this bundle is a **design reference created in HTML**
(a streaming "Design Component"). It is a **prototype of intended look and behavior — NOT
production code to ship**. Several systems in it are *genuinely functional in-browser*
(see the Feature Matrix), but a shippable browser cannot be an HTML page: the task is to
**recreate this design in a real Chromium desktop shell** (the recommended stack is
**Electron or Tauri + React + TypeScript**, or the project's existing stack if one is
already chosen) using that environment's established patterns.

Do **not** copy the HTML directly into production. Do **not** redesign the approved UI.
Recreate it faithfully, then connect every interaction to real state, services and
persistence.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, component proportions, states,
light/dark themes and interaction behavior are all specified. Recreate the UI
pixel-accurately using the target codebase's libraries. Exact tokens are in
`NEXA_DESIGN_SYSTEM.md`.

## What actually works in the prototype (honest summary)
- **Real, functional now (client-side):** theme engine (light/dark, accent-variant
  generation, presets, address-bar styles, motion/radius/density, ambient backgrounds),
  profiles + per-profile dashboard customization (show/hide/reorder widgets, quick
  actions, layout, greeting), profile avatar upload (FileReader) + initials fallback,
  **password vault with real WebCrypto encryption (PBKDF2 210k + AES-GCM), master-password
  create/unlock/lock, CRUD, generator (crypto.getRandomValues), strength, reuse/weak
  audit**, settings persistence (localStorage), workspace switching, tabs
  (open/close/switch/⌘T/⌘W), command palette, dropdowns, downloads "clear completed",
  extensions enable/disable, content-protection toggles, VPN state machine (simulated),
  collapsible title bar.
- **Simulated / UI-only (needs native backend):** actual downloading & segmentation,
  real VPN tunnels + latency/IP, cloud OAuth + transfers, AI model calls, real page
  rendering, DevTools, extension execution, OS keychain, auto-update, installers.

The **Feature Matrix** classifies every feature precisely. Never present a simulated
state as real in production — the prototype already uses honest "requires backend /
simulated" labels; preserve that discipline.

## Documents in this bundle
| File | Purpose |
|---|---|
| `README.md` | This file — orientation + Cursor quick start |
| `NEXA_DESIGN_SYSTEM.md` | Exact tokens: color, type, spacing, radii, shadows, states |
| `NEXA_FEATURE_MATRIX.md` | Per-feature status: implemented / simulated / requires-backend |
| `NEXA_ARCHITECTURE.md` | Target architecture, platform adapters, IPC, state model |
| `NEXA_CROSS_PLATFORM.md` | Build matrix, packaging, signing, installers, auto-update |
| `NEXA_SECURITY.md` | Vault, IPC security, data-flow, threat model, no-data-sharing |
| `NEXA_CURSOR_EXECUTION_PLAN.md` | Phased P0–P6 implementation order for Cursor |
| `NEXA_prototype.dc.html` | The high-fidelity design reference |

## Screen / surface inventory
All surfaces live in the single prototype and share one design system.
1. **Browser shell** — collapsible title bar (hidden by default), tab strip (+theme/header toggles), toolbar (sidebar, back/fwd/reload, omnibox with Ask AI, detection, VPN, extensions, avatar), collapsible sidebar (Home/Downloads/AI/Cloud/Bookmarks/History/Collections + Workspaces), contextual status bar.
2. **New Tab / Home dashboard** — logo, search omnibox, greeting, profile-driven quick actions, reorderable widget cards, ambient backgrounds, Customize entry.
3. **Web content** — believable arXiv-style article with a downloadable-resources table.
4. **Smart detection popover**, **destination picker**, **Google Drive picker**.
5. **Turbo download card** (progress → cloud upload → complete) + **Downloads Center** (filters, clear completed) + **Cloud Transfer**.
6. **AI side panel** — ASK/ACT/DOWNLOAD/RESEARCH/ORGANIZE + execution plan.
7. **Command palette** (⌘K).
8. **Settings** (full-page): General, Profile, Password Manager, Appearance, Downloads, AI, Cloud, Privacy & Security, Security Center, Content Protection, VPN & Network, Extensions, Advanced.
9. **VPN quick panel** + **location selector** (34 countries, best-for, search).
10. **Profile system** — menu (switch/add/edit), edit modal (avatar/name/status/accent), add-profile modal, Customize-dashboard modal.
11. **Password Manager** — create/unlock/list, add/edit drawer with generator.
12. **About / Open Source**.

Detailed per-surface component specs, states and copy are in the prototype; measurements/tokens in `NEXA_DESIGN_SYSTEM.md`.

## Cursor quick start
1. Read `README.md`, then `NEXA_CURSOR_EXECUTION_PLAN.md`.
2. Read `NEXA_ARCHITECTURE.md`, `NEXA_SECURITY.md`, `NEXA_DESIGN_SYSTEM.md`.
3. Inspect the target repo (if any). If none, scaffold Electron/Tauri + React + TS.
4. Produce `NEXA_IMPLEMENTATION_AUDIT.md` (what exists vs this handoff) before writing feature code.
5. Implement the design system as tokens first (do not scatter literals).
6. Build the browser shell, then wire features by priority (P0→P6).
7. A feature is "done" only when UI → event → state → service → persistence → error handling → restart-restore → test all pass. **No dead buttons. No fake states.**
8. Run visual-regression at 1280×800 / 1440×900 / 1920×1080 / 2560×1440, light+dark.

## Assets
- Logo: `assets/nexa-icon.png` (transparent swirl mark), referenced in shell/New Tab/About.
- Icons: **Phosphor Icons** (regular/bold/fill). Keep one icon family.
- Fonts: **IBM Plex Sans** (UI) + **IBM Plex Mono** (numeric/technical). Bundle for offline.
