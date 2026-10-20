# NEXA Security (architecture + threat model + data flow)

## Principles
Privacy-by-default · security-by-design · local-first · zero-trust · least-privilege · fail-closed.
Never claim "100% secure/anonymous/untraceable". Use technically defensible states:
Protected / Verified / No detected leak / Requires auth / Not configured.

## No data sharing by default
No user data goes to NEXA servers, analytics, ad networks, AI providers, cloud, or crash
reporting unless the user explicitly enables the feature. Prototype defaults (keep them):
`aiPageData:false, telemetry:false, crash:false, dataSharing:false, secureDns:true`.
Every external request must be documented (data / purpose / destination / permission).

## Password vault (already real in prototype — harden for production)
- Prototype: **PBKDF2 (SHA-256, 210k) → AES-GCM 256**; stored blob is `{v,salt,iters,iv,ct}`;
  **plaintext never persisted** (verified: no username/password/site in storage).
  Decrypted creds live only in instance memory while unlocked; cleared on lock/profile-switch.
- Production: keep the crypto; **bind/seal the derived key to the OS keychain** (macOS
  Keychain, Windows DPAPI/Credential Manager, Linux Secret Service) via native IPC. Never
  store keys beside the DB. Auto-lock (default 5 min) + lock on profile switch. Never log
  secrets. Copy → clipboard clears after 30s. Notifications never contain secret values.
- **Autofill fail-closed:** validate scheme+host+port+origin+frame; block cross-origin,
  phishing look-alikes (`example.com.attacker.com`), and iframe leakage. Username may fill
  independently; password requires strict origin match.
- Generator uses `crypto.getRandomValues` (never `Math.random`). Strength + reuse analysis
  is 100% local; no plaintext to any breach API (use k-anonymity range query only if the
  user opts in).

## Firewalls (enforced boundaries)
- **AI → vault/cookies/tokens = DENIED** by default.
- **Cloud → vault = BLOCKED** (no password backup to cloud).
- **Extensions → vault/AI keys/VPN creds/internal APIs = DENIED** unless explicitly granted.
- **Dashboard widgets** may show counts ("42 saved, 3 reused") but never password values.

## IPC / process security
Typed, validated, minimal, permission-checked. Renderer cannot touch filesystem, vault,
keychain, sockets or shell directly. Sandbox renderers; don't expose privileged native APIs
to web content; strong CSP (avoid `unsafe-eval`, minimize `unsafe-inline`). Prevent path
traversal / symlink abuse. Never disable TLS verification.

## Threat model (summary)
Actors: malicious websites, phishing sites, malicious extensions, local malware,
compromised dependencies, network attackers, rogue AI/cloud providers, compromised renderer,
malicious imports. Assets: passwords, cookies, tokens, API keys, history, bookmarks,
downloads, cloud files, profile data, private-browsing data.
Negative tests to implement: wrong-origin autofill → BLOCK; renderer→vault direct → BLOCK;
extension→vault → BLOCK; invalid/fake-profile-id IPC → REJECT; tampered vault → DETECT/fail-safe;
malformed import → REJECT; unauthorized cloud/AI request → BLOCK.

## Data-flow map (per feature, document)
User → NEXA → (local service | external provider) → exact data sent → purpose → permission.
Example — AI summarize: page text → local model (default, on-device, no network) OR, only
if user enabled a cloud provider + granted page access, → that provider over TLS.

## VPN honesty
Never show "Protected" unless a real tunnel is verified. Distinguish Browser-proxy vs
System-VPN vs DNS vs WebRTC vs Kill-switch — do not merge into one misleading status.

## Updates
Signed, integrity-verified, version-checked, rollback-safe. Never download→execute unsigned
payloads. No fake "up to date" without a real check.

## Secrets hygiene
No API keys / tokens / signing creds / private keys committed. Ship `.env.example`; add
secret scanning to CI.
