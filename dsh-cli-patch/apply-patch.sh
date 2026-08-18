#!/usr/bin/env bash
# =============================================================================
#  apply-patch.sh  —  One-step DSH source-tree patcher for macOS / Linux
#  Usage:
#    cd dsh-doctor/dsh-cli-patch
#    ./apply-patch.sh  /path/to/your/DeepSeek/staging
#
#  Steps:
#    1. Copy src/doctor.ts + src/doctor-engine.js → apps/cli/src/
#    2. Overwrite apps/cli/src/{args,bin}.ts with the reference/ versions
#       (backups saved as .bak first)
#    3. Print the build commands the user needs to run next.
# =============================================================================
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "USAGE: $0 <path-to-dsh-staging>"
  echo "  staging = folder containing apps/cli/src/args.ts"
  echo "  Example: $0 ~/repos/DeepSeek/staging"
  exit 2
fi

STAGING="$1"
if [[ ! -f "$STAGING/apps/cli/src/args.ts" ]]; then
  echo "[apply-patch] ERROR: cannot find $STAGING/apps/cli/src/args.ts"
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
TARGET_SRC="$STAGING/apps/cli/src"

echo "[apply-patch] Target: $TARGET_SRC"
echo "[apply-patch] Source: $SCRIPT_DIR"

# 1. Copy source files
cp "$SCRIPT_DIR/src/doctor.ts"       "$TARGET_SRC/doctor.ts"
cp "$SCRIPT_DIR/src/doctor-engine.js" "$TARGET_SRC/doctor-engine.js"
echo "  - copied doctor.ts / doctor-engine.js -> apps/cli/src/"

# 2. Overwrite args/bin (with backup)
for f in args.ts bin.ts; do
  if [[ ! -f "$TARGET_SRC/$f.bak" ]]; then
    cp "$TARGET_SRC/$f" "$TARGET_SRC/$f.bak"
  fi
  cp "$SCRIPT_DIR/reference/$f" "$TARGET_SRC/$f"
done
echo "  - backed up + overwritten args.ts and bin.ts with reference/ versions"

# 3. Report + next steps
cat <<EOF

[apply-patch] DONE.

Backups: $TARGET_SRC/{args.ts,bin.ts}.bak

Verify (optional):
  git diff --no-index apps/cli/src/args.ts.bak apps/cli/src/args.ts

Build DSH (from the repo root — not staging root, consult your project docs):
  pnpm install
  pnpm build

After build, copy the contents of apps/cli/lib/ into:
  your-release/DeepSeekHarness/app/lib/

and for the standalone companion entry point also copy:
  dsh-doctor/standalone/DeepSeekHarness/dsh-doctor.cmd -> your-release/DeepSeekHarness/
EOF
