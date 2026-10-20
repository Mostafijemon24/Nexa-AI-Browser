# NEXA — STEP 7 · Test Matrix (Privacy Center & Diagnostics)

Baseline before STEP 7: **478/478**. After STEP 7: **512/512** (+34).

- `tests/unit/privacy.test.ts` — 25 new behavioural tests.
- `tests/unit/theme-tokens.test.ts` — 9 new source-guard tests
  ("Privacy Center (STEP 7)").

```
Test Files  33 passed (33)
Tests       512 passed (512)
typecheck   PASS
build       PASS
```

No existing test was deleted, weakened, or reconfigured.

---

## Coverage vs. STEP 7 §27 requirements

### IP classification / private vs public / IPv4 / IPv6
| Case | Test | Result |
| --- | --- | --- |
| private IPv4 ranges (10/172.16/192.168/CGNAT) never public | "classifies private IPv4 ranges" | PASS |
| loopback / link-local / special IPv4 | "classifies loopback / link-local / special" | PASS |
| public IPv4 | "classifies public IPv4" | PASS |
| IPv6 loopback/link-local/unique-local/public | "classifies IPv6 …" | PASS |
| zone ids / brackets / garbage | "handles zone ids and brackets" | PASS |

### HTTPS classification
| Case | Test | Result |
| --- | --- | --- |
| https/wss → ACTIVE, http/ws → NONE, else UNKNOWN | "classifyHttps" | PASS |

### Interface summary (public-IP safety)
| Case | Test | Result |
| --- | --- | --- |
| families / IPv6 availability / local counts | "summarizes families…" | PASS |
| no routable v6 when only loopback/link-local | "no routable ipv6…" | PASS |

### WebRTC normalization
| Case | Test | Result |
| --- | --- | --- |
| UNAVAILABLE (no RTCPeerConnection) | "UNAVAILABLE when…" | PASS |
| mDNS-only → NO_EXPOSURE_DETECTED | ".local candidates" | PASS |
| private IP → POTENTIAL_EXPOSURE | "private (local) IP" | PASS |
| public IP → POTENTIAL_EXPOSURE | "public IP surfaces" | PASS |
| no candidates → UNKNOWN | "UNKNOWN when no candidates" | PASS |

### DNS normalization
| Case | Test | Result |
| --- | --- | --- |
| no servers → NOT_CONFIGURED | "NOT_CONFIGURED" | PASS |
| unavailable | "UNAVAILABLE" | PASS |
| no VPN → UNKNOWN | "UNKNOWN without VPN" | PASS |
| VPN + tunnel-side → NO_LEAK_DETECTED | "NO_LEAK_DETECTED" | PASS |
| VPN + public resolver → POTENTIAL_LEAK | "POTENTIAL_LEAK" | PASS |

### Fingerprint surface (deterministic)
| Case | Test | Result |
| --- | --- | --- |
| documented threshold bands | "maps counts to bands" | PASS |
| builds over fixed key set | "buildFingerprint counts" | PASS |

### Privacy aggregation (no fake score)
| Case | Test | Result |
| --- | --- | --- |
| STRONG only if verified + no concerns | "STRONG only when…" | PASS |
| MIXED | "MIXED when both…" | PASS |
| UNKNOWN | "UNKNOWN when nothing…" | PASS |
| ATTENTION | "ATTENTION when only concerns" | PASS |

### Origin validation
| Case | Test | Result |
| --- | --- | --- |
| parse http(s) / reject others | "parses http(s) origins" | PASS |

### Security boundaries (source guards)
| Case | Test | Result |
| --- | --- | --- |
| reuses protection + VPN (no second engine) | guard | PASS |
| deterministic, no AI | guard | PASS |
| capability-specific IPC, no eval/shell/generic | guard | PASS |
| profile revalidation + cookie COUNT (no values) | guard | PASS |
| no fake positive labels / no public-IP fabrication | guard | PASS |
| no fingerprint spoofing/randomization/evasion | guard | PASS |
| wired into view/palette/click-to-go/settings | guard | PASS |
| no persistence / reset on switch | guard | PASS |
| accessible (aria-live + headings) | guard | PASS |

### Click-to-Go / Command Palette
Covered by the guard tests above (privacy command + palette group present) and the
existing `click-to-go.test.ts` "every command id maps to a real view" invariant
(the `privacy` command maps to the `privacy` view).

### Profile isolation / private mode / error states
Deterministic behaviour verified via source guards (reset on switch, no
persistence) and by the honest enum outputs (`UNKNOWN`/`UNAVAILABLE`/
`NOT_CONFIGURED`/`CHECKING`) throughout the pure core.

### GUI verification
Not performed — headless environment. Status: **NOT_CONFIGURED — ENVIRONMENT**.
