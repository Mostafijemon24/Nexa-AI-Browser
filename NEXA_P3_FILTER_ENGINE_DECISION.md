# NEXA P3 — Filter Engine Decision

## Question
Which filtering backend and rule-list strategy should NEXA adopt for P3?

## Options considered

| Option | Pros | Cons / risk |
|---|---|---|
| **Embed a full third-party engine** (e.g. a compiled adblock core + full EasyList/EasyPrivacy) | Broad coverage, cosmetic filtering | Large binary/runtime surface, license + redistribution obligations, must ship + auto-update multi-MB lists, higher attack surface, harder to audit, risk of shipping stale/partial lists. Overkill for P3 scope. |
| **Ship a copy of EasyList/EasyPrivacy verbatim** | Coverage | These lists are GPL/CC-licensed with attribution/share-alike terms; verbatim redistribution creates licensing obligations we do not want to bake in silently. Also multi-MB, needs update infra. |
| **Internal filtering abstraction + a compact NEXA-authored rule set (chosen)** | Fully owned, auditable, tiny, no license entanglement, standards-compatible **syntax** (Adblock subset) so lists can be extended later; real ALLOW/BLOCK via `session.webRequest` | Coverage is intentionally limited (curated well-known domains); no cosmetic filtering; external updates not enabled. |

## Decision
Adopt the **internal filtering abstraction** (`src/shared/protection.ts`) with a **compact, NEXA-authored rule set** (`src/main/services/protection-rules.ts`).

- **Syntax:** an Adblock/EasyList-compatible **subset** — `||domain^`, `$script,image,...` resource options, `$third-party`, `@@` exceptions, plain-domain lines, `!` comments. Cosmetic (`##`) and regex rules are explicitly rejected by the parser (not silently mis-parsed).
- **Rule content:** plain domain facts for well-known advertising, analytics/telemetry, social-tracking and push/pop-under annoyance endpoints. Domain lists are factual, not a redistributed copy of any specific third-party list — this avoids license/attribution entanglement while remaining honest about coverage.
- **Engine:** decisions run in the **main process** on `session.webRequest.onBeforeRequest` per profile partition. `cancel:true` = BLOCK, `cancel:false` = ALLOW. This is the real Chromium primitive, not a simulation.

## Coverage & honesty
- Network-level tracker/ad/annoyance blocking: **REAL** (bundled list).
- Cosmetic filtering (element hiding): **NOT CONFIGURED** — network-only.
- Malicious-domain protection: **NOT CONFIGURED** — no threat-intelligence source; never shown as "Protected".
- External filter-list updates: **NOT CONFIGURED / EXPERIMENTAL** — no live network fetch in P3.

## Future extension (not implemented in P3)
The abstraction is deliberately decoupled from the UI and from rule *sourcing*. A future slice can add a `filter-updater` that:
- fetches a configured HTTPS EasyList-style URL,
- validates + parses it with the existing parser,
- atomically replaces the ruleset only if valid (rollback on failure — never replace a valid ruleset with a broken one),
- records version + timestamp,
without changing the engine, IPC, or UI contracts.

## Why not couple to React
Filtering runs in main and is exposed via typed IPC + a one-way event stream (mirroring the P2 download engine). The renderer is a pure projection; swapping the rule backend requires no UI rewrite.
