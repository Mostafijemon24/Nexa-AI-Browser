# NEXA P4.2 — Signing & Installer

No certificates/signing identities exist in this environment; every signing/notarization/install step below is **DOCUMENTED, NOT EXECUTED**. Nothing here is claimed as performed. The helper (`src/helper/main.ts`) is standalone so it can be built + signed separately from the Electron bundle, and it creates the transport endpoint the main app connects to.

## Endpoint & transport (implemented)
- macOS/Linux: unix domain socket, created by the helper, `chmod 0600`, owner root:wheel (macOS) / root (Linux). Removed on helper exit.
- Windows: named pipe `\\.\pipe\nexa-vpn-helper` with an ACL granting only the NEXA app/service identity.
- Main connects as a client only (`SocketHelperTransport`); never creates the endpoint.

## macOS
- **Install:** ServiceManagement privileged helper — SMAppService (current macOS) or legacy SMJobBless (confirm vs. `electron-builder` `mac.minimumSystemVersion`). Helper registered as a daemon that owns the socket.
- **Signing:** Developer ID Application signature on app + helper (same Team ID); `SMPrivilegedExecutables`/`SMAuthorizedClients` code-signing requirements pin the app↔helper pair; **Hardened Runtime** + **notarization**; entitlements limited to WireGuard needs.
- **Lifecycle:** install→verify identity+version+signature→register/start→health check (`probeWireGuard`)→ready. Upgrade: stop old→install new→verify→start→health check→rollback on failure. Uninstall: disconnect→remove routes→restore DNS→disable kill switch→stop→remove helper→remove socket.

## Windows
- **Install:** dedicated Windows Service (Authenticode-signed) running as LocalSystem or a constrained service account; exposes the named pipe with a restrictive ACL.
- **Signing:** Authenticode on service binary + installer (MSI); certificate identity documented; startup mode manual/demand; recovery policy configured.
- **Lifecycle:** service create→verify signature/version→start→health check→ready; upgrade stop→replace→start with rollback; uninstall removes service + pipe and restores network state.

## Linux
- **Install:** distro package (deb/rpm) installs the helper + a systemd unit with a minimal capability set (`CAP_NET_ADMIN`, `NoNewPrivileges=yes`, restricted `ReadWritePaths`) **or** a narrowly-scoped polkit action authorizing only the NEXA helper.
- **Trust:** package signed per-distro; helper binary root-owned `0755`, socket `0600`.
- **Lifecycle:** package install/upgrade/downgrade (rollback); uninstall stops the unit, removes the socket, restores routes/DNS.

## Version pinning & mismatch
Main records `HELPER_PROTOCOL_VERSION` and rejects mismatches (`VPN_HELPER_VERSION_MISMATCH` → helper state `error`), preventing unsafe operation across incompatible versions. (Verified in `vpn-helper-transport.test.ts`.)

## Bundled WireGuard binaries
None bundled; system installation preferred. Any future bundling requires license/provenance/reproducibility/CVE/signing/packaging review (see P4.1 dependency policy).

## Dependency audit (P4.2)
No new runtime dependencies. Only Node built-ins added: `node:net` (transport). No native modules, no telemetry SDK, no VPN SDK.
