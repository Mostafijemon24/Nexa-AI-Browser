# NEXA P4.1 — Signing & Packaging (Privileged Helper)

The helper (`src/helper/main.ts`) is intentionally standalone so it can be built + **signed separately** from the Electron bundle. It is NOT bundled into the packaged app in this phase; wiring the real transport + installer is the production step below. No certificates or signing identities are invented here.

## Helper lifecycle (all OS)
`install → verify (version + signature) → start → [serve requests] → stop → upgrade → rollback → uninstall`. The main app records the expected helper protocol version (`HELPER_PROTOCOL_VERSION`) and refuses mismatches (`VPN_HELPER_VERSION_MISMATCH`). A missing/unsigned/unexpected helper ⇒ `NOT_CONFIGURED`, never PROTECTED.

## macOS
- **Mechanism:** ServiceManagement privileged helper (SMAppService on current macOS; legacy SMJobBless where the deployment target requires it). Confirm against `electron-builder` `mac.minimumSystemVersion`.
- **Identity/signing:** helper signed with the same Team ID; `SMPrivilegedExecutables` / `SMAuthorizedClients` code-signing requirements pin the app↔helper pair. App: Hardened Runtime + **notarization**; entitlements limited to what WireGuard needs.
- **Communication:** XPC or a unix domain socket owned root:wheel `0600`; the app authenticates via the audit token / code-signing requirement.
- **Install/upgrade/uninstall:** via SMAppService register/unregister; version pinned; rollback = unregister new + re-register known-good. **NOT EXECUTED — ENVIRONMENT LIMITATION.**

## Windows
- **Mechanism:** dedicated Windows Service (Authenticode-signed binary) exposing a **Named Pipe** with a restrictive ACL that grants only the NEXA app identity.
- **Signing:** Authenticode on service binary + installer; service startup mode `manual`/`demand`; recovery policy documented.
- **Auth:** pipe server verifies the client process's signature/identity; rejects unauthorized clients (`VPN_HELPER_UNAUTHORIZED`).
- **Install/upgrade/uninstall:** MSI/installer creates/removes the service; upgrade stops→replaces→starts; rollback restores prior service binary. **NOT EXECUTED — ENVIRONMENT LIMITATION.**

## Linux
- **Mechanism:** polkit action scoped to the helper **or** a systemd unit with a minimal capability set (`CAP_NET_ADMIN`, `NoNewPrivileges`, restricted `ReadWritePaths`).
- **Trust:** distro package (deb/rpm) signed per-distro; polkit policy authorizes only the NEXA helper action; no broad admin rights, no `sudo` in production.
- **Install/upgrade/uninstall:** package manager; rollback via package downgrade. **NOT EXECUTED — ENVIRONMENT LIMITATION.**

## Bundled WireGuard binaries
None bundled. NEXA uses the documented **system** WireGuard installation. If bundling is later required, perform: license audit (WireGuard tools are GPLv2 / MIT depending on component), source audit, version pinning, checksum verification, update + vulnerability policy, per-OS packaging review, and separate signing. Prefer system install.

## Dependency audit (P4.1)
No new runtime dependencies added. Uses only Node built-ins (`child_process`, `fs`, `os`, `path`, `crypto`) and the existing `zod`. No native modules, no new framework. Privilege implications: confined to the separately-signed helper.
