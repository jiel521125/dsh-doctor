#!/usr/bin/env bash
# =============================================================================
#  deploy.sh  —  Deploy Path A (standalone) into a DSH portable installer
#                macOS / Linux version
#
#  Usage:
#     cd dsh-doctor/standalone
#     ./deploy.sh  /path/to/your/DeepSeekHarness
# =============================================================================
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "USAGE: $0 <path-to-DeepSeekHarness>"
  echo "  Example: $0 ~/release/DeepSeekHarness"
  exit 2
fi

TARGET="$(cd "$1" && pwd)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

echo "============================================================"
echo " dsh-doctor  Path A Deployment"
echo "============================================================"
echo " Source : $SCRIPT_DIR/DeepSeekHarness"
echo " Target : $TARGET"
echo "============================================================"

# 1. Validate target
if [[ ! -f "$TARGET/node/node" && ! -f "$TARGET/node/node.exe" ]]; then
  echo "[1/5] FAIL: $TARGET/node/node(.exe) not found"
  exit 3
fi
if [[ ! -f "$TARGET/app/lib/bin.js" ]]; then
  echo "[1/5] FAIL: $TARGET/app/lib/bin.js not found"
  exit 3
fi
echo "[1/5] OK   Target validated."

# 2. Copy doctor-engine.js
cp "$SCRIPT_DIR/DeepSeekHarness/app/lib/doctor-engine.js" "$TARGET/app/lib/doctor-engine.js"
echo "[2/5] OK   Copied doctor-engine.js -> $TARGET/app/lib/"

# 3. Copy dsh-doctor.cmd (also works as reference on non-Windows)
if [[ -f "$SCRIPT_DIR/DeepSeekHarness/dsh-doctor.cmd" ]]; then
  cp "$SCRIPT_DIR/DeepSeekHarness/dsh-doctor.cmd" "$TARGET/dsh-doctor.cmd"
  echo "[3/5] OK   Copied dsh-doctor.cmd -> $TARGET/"
else
  echo "[3/5] SKIP dsh-doctor.cmd not found (non-Windows)"
fi

# 4. Patch bin.js with dispatcher
if grep -q "doctorDispatch" "$TARGET/app/lib/bin.js" 2>/dev/null; then
  echo "[4/5] SKIP bin.js already patched."
else
  echo "[4/5] Patching bin.js with doctor dispatcher..."
  # Backup
  if [[ ! -f "$TARGET/app/lib/bin.js.bak" ]]; then
    cp "$TARGET/app/lib/bin.js" "$TARGET/app/lib/bin.js.bak"
    echo "       Backup saved: bin.js.bak"
  fi

  DISPATCHER=$(cat <<'JSEOF'
// ============================================================================
// doctor dispatcher - runs BEFORE the normal DSH commander parser.
// Recognises `dsh doctor ...` and forwards to app/lib/doctor-engine.js.
// Remove this block if you switch to native Path B integration.
// ============================================================================
;(function doctorDispatch () {
  var first = process.argv[2]
  if (first !== 'doctor') return
  var childArgv = process.argv.slice(3)
  var spawnSync = require('node:child_process').spawnSync
  var resolve   = require('node:path').resolve
  var engine = resolve(__dirname, 'doctor-engine.js')
  var fs = require('node:fs')
  if (!fs.existsSync(engine)) {
    process.stderr.write('[dsh doctor] FATAL: doctor-engine.js not found at ' + engine + '\n')
    process.exit(97)
  }
  var r = spawnSync(process.execPath, [engine].concat(childArgv), {
    stdio: 'inherit', env: process.env,
  })
  process.exit(r.status === null ? 99 : r.status)
})()
// -------------------------- end doctor dispatcher --------------------------

JSEOF
)
  printf '%s\n' "$DISPATCHER" | cat - "$TARGET/app/lib/bin.js" > "$TARGET/app/lib/bin.js.new"
  mv "$TARGET/app/lib/bin.js.new" "$TARGET/app/lib/bin.js"
  echo "[4/5] OK   bin.js patched."
fi

# 5. Verify
echo "[5/5] Verifying deployment..."
NODE_BIN="$TARGET/node/node"
[[ ! -x "$NODE_BIN" ]] && NODE_BIN="$TARGET/node/node.exe"
ENGINE="$TARGET/app/lib/doctor-engine.js"

# Detect DSH_HOME
DSH_HOME_OUT=""
if [[ -d "$TARGET/../dsh-home" ]]; then
  DSH_HOME_OUT="$(cd "$TARGET/../dsh-home" && pwd)"
fi

export DSH_INSTALLER_ROOT="$TARGET"
[[ -n "$DSH_HOME_OUT" ]] && export DSH_HOME="$DSH_HOME_OUT"

"$NODE_BIN" "$ENGINE" --profile web
RC=$?

if [[ $RC -eq 0 ]]; then
  echo ""
  echo "============================================================"
  echo " DEPLOYMENT SUCCESSFUL"
  echo "============================================================"
  echo "  Try it:"
  echo "    $TARGET/dsh-doctor.cmd web"
  echo "    node $TARGET/app/lib/bin.js doctor web --fix"
  echo ""
elif [[ $RC -eq 2 ]]; then
  echo ""
  echo "============================================================"
  echo " DEPLOYMENT OK (doctor has warnings)"
  echo "============================================================"
fi
exit $RC
