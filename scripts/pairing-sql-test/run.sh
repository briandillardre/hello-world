#!/bin/bash
# Pairing places, SQL vs TypeScript — proves migration 122's
# ht_pairing_summarize (which backfilled every episode recorded before the
# ingest learned to fold sightings) walks the SAME places as the live ingest
# (lib/ble-sightings.ts → lib/pairing-ride.ts `foldSighting`), matching tags
# the same way (ht_beacon_keys vs beaconCandidates). Runs on any local
# PostgreSQL 16 — no Supabase, no PostGIS; 122 applies verbatim.
#
#   PSQL="psql -h localhost -U postgres" scripts/pairing-sql-test/run.sh
#   (default: `su postgres -c psql`, i.e. a Debian/Ubuntu postgres service)
#
# Run it after ANY change to the fold, the matcher, or 122's SQL.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
DB="${DB:-ht_pairing_test}"
TMP="$(mktemp -d)"
if [ -n "$PSQL" ]; then
  q() { $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" < "$1"; }
  qa() { $PSQL -v ON_ERROR_STOP=1 -qAt -d "$DB" -c "$1"; }
  $PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $DB" && $PSQL -q -d postgres -c "CREATE DATABASE $DB"
else
  chmod 755 "$TMP"
  q() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$1"; }
  qa() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt -d $DB -c \"$1\""; }
  su postgres -c "dropdb --if-exists $DB" && su postgres -c "createdb $DB"
fi
node gen.mjs "$TMP"
q setup.sql
q "$REPO/supabase/migrations/122_pairing_places.sql"
q "$TMP/data.sql"
qa "SELECT count(*) FROM (SELECT ht_pairing_summarize(id) FROM pairing_log) x" > /dev/null
qa "SELECT json_agg(json_build_object('id', id, 'heard_n', heard_n, 'span_m', span_m, 'moved_m', moved_m, 'first_lat', first_lat, 'anchor_lat', anchor_lat) ORDER BY id) FROM pairing_log" > "$TMP/got.json"
node - "$TMP/expected.json" "$TMP/got.json" <<'JS'
const fs = require('fs')
const exp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const got = new Map(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).map((r) => [r.id, r]))
let pass = 0, fail = 0
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol)
for (const e of exp) {
  const g = got.get(e.id)
  const checks = [
    ['heard_n', g && g.heard_n === e.heard_n],
    ['span_m', g && near(g.span_m, e.span_m, 0.5)],     // real columns: float4
    ['moved_m', g && near(g.moved_m, e.moved_m, 0.5)],
    ['first place', g && near(g.first_lat, e.first_lat, 1e-9)],
    ['anchor', g && near(g.anchor_lat, e.anchor_lat, 1e-9)],
  ]
  for (const [what, okd] of checks) {
    if (okd) pass++
    else { fail++; console.log(`  FAIL ${e.name}: ${what} — SQL ${JSON.stringify(g && g[what === 'first place' ? 'first_lat' : what === 'anchor' ? 'anchor_lat' : what])} vs TS ${JSON.stringify(e[what === 'first place' ? 'first_lat' : what === 'anchor' ? 'anchor_lat' : what])}`) }
  }
  console.log(`  ${e.name}: ${e.kind === 'rode' ? 'rode with' : 'seen by'} · heard ${e.heard_n} · span ${Math.round(e.span_m)} m · moved ${Math.round(e.moved_m)} m`)
}
console.log(`pairing-sql: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
JS
rm -rf "$TMP"
