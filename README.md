# NEXA

Open-source Chromium desktop browser (Electron + React + TypeScript).

Browse. Protect. Download. Understand. Transfer.

## Status

This repo is the production scaffold from the design handoff. **P0 foundation is in place.** Native download, VPN, cloud, AI, filter, and extension hosts are **not configured** and the UI says so.

Read `NEXA_IMPLEMENTATION_AUDIT.md` and `docs/` before adding features.

## Develop

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
```

## Security defaults

- Sandboxed renderer, context isolation, no Node in the page
- Typed IPC (no generic filesystem/shell)
- Vault: PBKDF2 210k + AES-GCM 256 in the main process; key sealed with OS `safeStorage`
- Privacy toggles default off except Secure DNS preference
- VPN never reports Protected without a real tunnel

Do not commit `.env` or keys. Copy `.env.example` only if you add optional provider credentials — runtime secrets belong in OS secure storage.
