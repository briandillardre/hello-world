#!/usr/bin/env bash
# Guidance-math harness — run it after ANY change to lib/navigation.ts.
#
# The ledger harness exists because hours are money; this one exists because a
# wrong turn call at 45 mph is worse than no call. It drives a REAL OSRM route
# (scripts/nav-test/route.json, baked in so this needs no network) fix by fix
# with GPS noise, and asserts the things a driver would notice.
#
#   ./scripts/nav-test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
npx tsc lib/navigation.ts --target es2020 --module esnext --moduleResolution bundler \
  --outDir "$OUT" --skipLibCheck
echo '{"type":"module"}' > "$OUT/package.json"
NAV_JS="$OUT/navigation.js" node scripts/nav-test/run.mjs
