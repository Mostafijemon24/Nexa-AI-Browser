# NEXA P0–P13 — Architecture Audit

*Audit only. No code modified. Evidence = repository source at audit time.*

## 1. Stack baseline (installed, verified)

| Component | Version | Source |
|-----------|---------|--------|
| Electron | 37.10.3 | `node_modules/electron` |
| Chromium | ~130 (bundled with Electron 37) | runtime |
| Node (dev) | v24.17.0 | `node -v` |
| React | 19.3.0 | `node_modules/react` |
| TypeScript | 5.9.3 | `node_modules/typescript` |
| Zod | 3.25.76 | `node_modules/zod` |
| Vite | 7.3.6 | `node_modules/vite` |
| electron-vite | 4.0.1 | build system |
| electron-builder | 26.15.3 | packaging |
| Zustand | 5.0.15 | renderer state |

## 2. Layer map

```
Electron Main (src/main)
├── index.ts            window + CSP + permission handler + service wiring
├── ipc/register.ts     single IPC surface (ipcMain.handle + Zod + safe errors)
├── services/           20 services (see below)
├── platform/           OS adapters (profileDir, paths)
└── helper/ (privileged VPN helper, separate process)
        │
Preload (src/preload/index.ts)  contextBridge → window.nexa (invoke wrappers only)
        │
Sandboxed Renderer (src/renderer/src)
├── App.tsx             shell, tabs (<webview>), command palette, agent/worker executors
├── views/              9 views (Settings, Downloads, Drive, Protection, Privacy, NewTab, …)
└── state/store.ts      Zustand store (single store, profile-scoped hydration)
        │
Shared (src/shared)     pure contracts + Zod schemas + pure logic (25 modules)
```

### Services (`src/main/services`, 20)
`persistence, secure-storage, vault, library, downloads, protection(+rules),
vpn(+vpn-helper,+vpn-platform), ai(+ollama,+ai-registry,+ai-provider-adapters),
agent(+agent-permissions,+agent-ipc-host), drive, regional, extensions, fs-atomic`.

No duplicate services detected. Each capability has exactly one owner service.

## 3. Rendering surface

Web content renders in `<webview partition="persist:nexa-<id>">`
(`App.tsx:1282`), created with only `src/partition/style` — no `nodeintegration`,
no `disablewebsecurity`, no `allowpopups`. Embedder window
(`index.ts:78–85`): `sandbox:true, contextIsolation:true, nodeIntegration:false,
webSecurity:true, webviewTag:true`.

## 4. Session / partition topology

- Persistent per profile: `persist:nexa-<id>` (on-disk).
- Private per profile: `nexa-private-<id>` (no `persist:` prefix → in-memory,
  non-persistent).
- Services attach to both partitions via `session.fromPartition(...)`
  (downloads `:121–122`, protection `:134–135`, regional `:40`, extensions `:66–68`).

## 5. IPC surface (single, typed)

- One registry `src/shared/channels.ts` (≈150 channels), one handler module
  `src/main/ipc/register.ts` (`ipcMain.handle` + Zod parse + `ok()/safeError()`).
- Capability-specific naming (`downloads.*`, `vpn.*`, `ai.*`, `agent.*`, `ext.*`,
  `drive.*`, …). No generic `execute/invoke(arbitraryString)/fetch/fs/shell`.
- The `agent.*` surface is a single typed architecture (start/cancel/pause/resume/
  permission/toolResult/history/event) — **not** per-tool IPC. Confirmed intact.
- Explicit **deny firewall** channels: `firewall.ai.vault`, `firewall.cloud.vault`,
  `firewall.extension.vault` all bound to a `deny` handler that throws `denied`
  (`register.ts:1085–1090`) — a defense-in-depth assertion that these bridges do
  not exist.

## 6. Preload exposure

`contextBridge.exposeInMainWorld('nexa', nexa)` (`preload/index.ts:209`) — the only
exposure. `ipcRenderer` is **not** exposed; every method is a thin
`ipcRenderer.invoke(channel, payload)` or a scoped `ipcRenderer.on(eventChannel)`
subscription. No Node, `fs`, `shell`, `process`, secrets, or generic invoke.

## 7. Dependency flow (no cycles observed)

```
renderer/store ──invoke──▶ preload ──ipc──▶ register ──▶ service ──▶ session/persistence
      ▲                                                    │
      └──────────────── event channels (on) ◀──────────────┘  (downloads/protection/vpn/ai/agent/ext)
```

- Shared modules are pure and imported by both main and renderer (no runtime
  cross-layer imports; renderer never imports a `src/main` service).
- No circular service dependencies found; services receive collaborators via
  constructor injection in `index.ts` (e.g. Drive → downloads.enqueueUrl,
  Extensions → persist + emit).

## 8. Layer-ownership integrity

| Concern | Owner (correct layer) |
|---------|----------------------|
| Secrets (keys/tokens/vault) | Main only (`secure-storage` + `vault`) |
| Network to providers/Drive | Main only (adapters, drive.ts) |
| Filesystem | Main only (`fs-atomic`, persistence) |
| Privileged OS (WireGuard) | Separate privileged helper process |
| Profile identity validation | Main (`assertSafeProfileId`) at every service boundary |
| DOM/page execution | Renderer against `<webview>` via fixed snippets |

No renderer leakage of privileged concerns detected.

## 9. Observations (INFO)

- Renderer builds to a single ~1.56 MB JS chunk (no code splitting) — see
  Performance audit.
- `prefs.extState` (`shared/types.ts:150,312`) is now unused after P13 replaced the
  static extensions list with live state — harmless residual schema field.
