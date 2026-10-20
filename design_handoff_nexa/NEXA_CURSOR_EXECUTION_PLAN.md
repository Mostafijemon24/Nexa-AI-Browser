# NEXA — Cursor Execution Plan

Read `README.md`, `NEXA_ARCHITECTURE.md`, `NEXA_SECURITY.md`, `NEXA_DESIGN_SYSTEM.md`,
`NEXA_FEATURE_MATRIX.md` first. Then inspect the repo and write `NEXA_IMPLEMENTATION_AUDIT.md`
(what exists vs this handoff) **before** feature work. Do not mass-rewrite working code.
Do not redesign the approved UI. Do not invent backends — mark honest states.

## Definition of done (per feature)
UI → event → state → service → backend → persistence → error handling → restart-restore → test.
No dead buttons. No fake data. No fake security/VPN/cloud/auth status.

## P0 — Security / Architecture / Build foundation
1. Scaffold (or verify) Electron/Tauri + React + TS; renderer sandbox + CSP.
2. Typed IPC boundary + validation; `PlatformAdapter` interfaces + 3 impls.
3. Design-token system (from `NEXA_DESIGN_SYSTEM.md`) + light/dark + accent-mix.
4. Central state architecture + persistence layer (profile vs global scoping).
5. OS secure storage (keychain) adapter. Secret scanning in CI.

## P1 — Core browser
6. Browser shell (collapsible title bar hidden-by-default, tab strip, toolbar, sidebar, status bar).
7. Real tabs (open/close/switch/close-others/left/right/reopen/pin/duplicate/context menu, session restore).
8. Profiles (real isolation) + switch/create/edit/avatar/accent/status; lock vault on switch.
9. Workspaces bound to tab/session sets.
10. Bookmarks (add/edit/delete/folders/nested/search/manager/bar/import/export) — **currently a placeholder; implement**.
11. History + Collections (currently placeholders).
12. Settings (full-page) + real dropdowns + persistence; command palette routing to services.
13. Theme engine (presets, accent, address-bar styles, radius/density/motion, ambient bg, reduced-motion).

## P2 — Downloads / Cloud / AI / VPN
14. Native download engine (segmented/turbo, pause/resume/retry/queue/schedule/speed-limit/ETA/integrity/recovery) → wire the existing Downloads UI + detection + destination picker + "clear completed".
15. Cloud transfer (Drive/GCS/Dropbox/OneDrive/S3/custom): OAuth, pickers, upload, progress, errors; tokens in secure store.
16. AI provider abstraction (OpenAI-compat/Anthropic/Google/Ollama/LM Studio), local default; ASK/ACT/DOWNLOAD/RESEARCH/ORGANIZE; execution-plan confirm; enforce AI↔secret firewall.
17. VPN/network adapters (WireGuard/OpenVPN/SOCKS5/proxy); real states; kill switch/DNS/WebRTC/IPv6/split-tunnel; keep the 34-country catalog UI.

## P3 — Password manager / Extensions / DevTools / Advanced
18. Port the WebCrypto vault; seal key to OS keychain; login-form detection + origin-aware fail-closed autofill; save/update prompts.
19. Content-protection engine (EasyList-compatible), live counters, per-site, modes/categories, filter-list updates.
20. Extensions via Chromium APIs (sandboxed; no vault access); enable/disable/remove/permissions/load-unpacked.
21. Chromium DevTools integration (F12).
22. Security Center + Privacy Center bound to real subsystem state; data deletion/export controls.

## P4 — Pixel QA / Accessibility / Performance
23. Visual regression vs references at 1280×800 / 1440×900 / 1920×1080 / 2560×1440, light+dark, scaling 100–200%.
24. Accessibility: keyboard nav, visible focus, ARIA, contrast, reduced motion, screen readers.
25. Performance: avoid re-renders/leaks; lazy-load hidden widgets; async services off UI thread.

## P5 — Packaging / Signing / Installers / Release
26. macOS/Windows/Linux builds + installers + signing/notarization; auto-update channel; About wired to real actions.

## P6 — Final security / cross-platform / acceptance
27. Negative security tests (see `NEXA_SECURITY.md`), cross-profile isolation, restart/recovery, installer/upgrade/uninstall, zero-dead-button + zero-fake-state audit.

## Acceptance gates
Functional QA · Security QA · Pixel QA · Cross-platform QA · Installer QA · Performance QA · Accessibility QA · Release QA — all pass, producing a real installable NEXA for macOS, Windows, Linux.
