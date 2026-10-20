#!/usr/bin/env bash
# NEXA RC-1 — machine-executable validation (automated portion).
#
# Runs every check that can be verified WITHOUT a display / signing identity /
# live network services, then prints the manual macOS steps that a human must
# perform on a real machine. Exits non-zero if any automated check fails.
#
# Usage:  bash scripts/rc1-validate.sh
# From:   repository root.

set -u
cd "$(dirname "$0")/.." || exit 2

PASS=0
FAIL=0
BOLD=$(printf '\033[1m'); GRN=$(printf '\033[32m'); RED=$(printf '\033[31m')
YEL=$(printf '\033[33m'); DIM=$(printf '\033[2m'); RST=$(printf '\033[0m')

ok()   { PASS=$((PASS+1)); printf "%s  PASS%s  %s\n" "$GRN" "$RST" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "%s  FAIL%s  %s\n" "$RED" "$RST" "$1"; }
info() { printf "%s  ....%s  %s\n" "$DIM" "$RST" "$1"; }
head() { printf "\n%s== %s ==%s\n" "$BOLD" "$1" "$RST"; }

run() { # run "label" cmd...
  local label="$1"; shift
  if "$@" >/tmp/rc1_step.log 2>&1; then ok "$label"; else bad "$label (see /tmp/rc1_step.log)"; fi
}

head "Toolchain"
info "node $(node -v 2>/dev/null)  npm $(npm -v 2>/dev/null)"
EV=$(node -e "console.log(require('electron/package.json').version)" 2>/dev/null || echo "?")
if [ "$EV" = "44.4.1" ]; then ok "Electron pinned to 44.4.1"; else bad "Electron version is '$EV' (expected 44.4.1)"; fi

head "Automated gates"
run "ESLint (0 errors / 0 warnings)"      npm run lint
run "Typecheck (vs Electron 44 types)"    npm run typecheck
run "Unit/service tests"                  npm test
run "RC-1 runtime validation harness"     npm run test:rc1
info "reports: reports/rc1-validation.json and reports/rc1-validation.md"
run "Clean + production build"            bash -c "npm run clean && npm run build"

head "Build artifacts"
[ -f out/main/index.js ]      && ok "out/main/index.js"        || bad "out/main/index.js missing"
[ -f out/preload/index.cjs ]  && ok "out/preload/index.cjs (CJS preload)" || bad "out/preload/index.cjs missing"
[ -f out/renderer/index.html ]&& ok "out/renderer/index.html" || bad "out/renderer/index.html missing"
if ls -d out/*/ 2>/dev/null | grep -q ' '; then bad "stray spaced dir in out/ (would ship)"; else ok "no stray artifacts in out/"; fi
MAIN=$(node -e "console.log(require('./package.json').main)")
[ "$MAIN" = "./out/main/index.js" ] && ok "package.json main → $MAIN" || bad "package.json main is '$MAIN'"

head "Security static checks"
grepbad() { # grepbad "label" pattern paths...
  local label="$1"; shift; local pat="$1"; shift
  if rg -n "$pat" "$@" >/tmp/rc1_grep.log 2>&1; then bad "$label (matches in /tmp/rc1_grep.log)"; else ok "$label"; fi
}
grepbad "no eval() / new Function in src"                 '\beval\(|new Function\(' src
grepbad "no shell:true in src"                            'shell:\s*true' src
grepbad "preload does not expose raw ipcRenderer via the bridge" 'exposeInMainWorld\([^)]*\bipcRenderer\b' src/preload
rg -q "sandbox: true" src/main/index.ts && rg -q "contextIsolation: true" src/main/index.ts \
  && rg -q "nodeIntegration: false" src/main/index.ts && rg -q "webSecurity: true" src/main/index.ts \
  && ok "webPreferences hardened (sandbox/contextIsolation/nodeIntegration/webSecurity)" \
  || bad "webPreferences hardening changed"
rg -q "applyPermissionPolicy\(session.defaultSession\)" src/main/index.ts \
  && rg -q "applyPermissionPolicy\(session.fromPartition\(persistPartition" src/main/index.ts \
  && rg -q "applyPermissionPolicy\(session.fromPartition\(privatePartition" src/main/index.ts \
  && ok "SEC-1 permission policy applied to default + persist + private sessions" \
  || bad "SEC-1 permission policy wiring missing"
C=$(rg -c "allowFileAccess: false" src/main/services/extensions.ts 2>/dev/null || echo 0)
[ "${C:-0}" -ge 1 ] && ok "extensions load with allowFileAccess:false ($C sites)" || bad "allowFileAccess:false missing"

head "Dependency audit (informational)"
npm audit 2>/dev/null | rg "vulnerabilit" | sed 's/^/       /' || info "npm audit produced no summary line"
info "Runtime advisories are expected RESOLVED on Electron 44; any remaining should be dev-only (vitest)."

head "Summary"
printf "  %s%d passed%s, %s%d failed%s\n" "$GRN" "$PASS" "$RST" "$RED" "$FAIL" "$RST"

cat <<'MANUAL'

== MANUAL macOS steps this script CANNOT perform (do on the real machine) ==
  Follow NEXA_RC1_VALIDATION_CHECKLIST.md sections:
    1. Signed + notarized package build (needs Developer ID + notarization creds)
    2. First launch + Gatekeeper acceptance
    3. Live GUI observation of permission prompts and OS clipboard 30s clear
       (policy and source contracts are already in the RC-1 harness report)
    4. Per-feature P0–P13 walkthrough (profiles, private, downloads, protection,
       VPN, AI, agent, worker, vault, privacy, drive, turbo, regional, dashboard,
       extensions live load, multi-provider AI)
    5. Crash / offline / recovery / session restore
    6. Running-app security spot-checks (renderer has no Node; no secrets in storage)
MANUAL

[ "$FAIL" -eq 0 ] || exit 1
