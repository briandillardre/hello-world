#!/usr/bin/env bash
# Flight-log math harness — run it after ANY change to lib/aircraft-log.ts.
#
# The ledger harness exists because hours are money and the nav harness
# exists because a missed turn is dangerous; this one exists because a flight
# log that invents a takeoff, welds two trips together, or cuts a red-eye in
# half is worse than having no log. It drives REAL adsb.lol archive files
# (baked in, so this needs no network) and asserts what a pilot reading their
# own log would notice.
#
#   ./scripts/flightlog-test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
npx tsc lib/aircraft-log.ts --target es2020 --module esnext --moduleResolution bundler \
  --outDir "$OUT" --skipLibCheck
echo '{"type":"module"}' > "$OUT/package.json"
FL_JS="$OUT/aircraft-log.js" node scripts/flightlog-test/run.mjs
