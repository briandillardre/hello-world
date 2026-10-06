#!/bin/bash
# Migration 132 (location privacy) on a plain local PostgreSQL 16 — no
# Supabase, no PostGIS; 132 applies VERBATIM. Proves it applies twice
# (idempotent), appends privacy_zone to geofences_json even when another
# migration appended a column first, keeps the flag server-only, and that
# tool_sightings / asset_recovery read the way the roles need (company,
# 111's visibility ladder, the prospect lockdown) and write only from the
# service role.
#
#   PSQL="psql -h localhost -U postgres" scripts/privacy-sql-test/run.sh
#   (default: `su postgres -c psql`, i.e. a Debian/Ubuntu postgres service)
#
# Run it after ANY change to 132's SQL.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
MIG="$REPO/supabase/migrations/132_location_privacy.sql"
export PGOPTIONS='-c client_min_messages=warning'
if [ -n "$PSQL" ]; then
  q() { $PSQL -v ON_ERROR_STOP=1 -qAt -d "$1" < "$2"; }
  qa() { $PSQL -v ON_ERROR_STOP=1 -qAt -d "$1" -c "$2"; }
  mk() { $PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $1" && $PSQL -q -d postgres -c "CREATE DATABASE $1"; }
else
  q() { su postgres -c "PGOPTIONS='$PGOPTIONS' psql -v ON_ERROR_STOP=1 -qAt -d $1" < "$2"; }
  qa() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt -d $1 -c \"$2\""; }
  mk() { su postgres -c "dropdb --if-exists $1" && su postgres -c "createdb $1"; }
fi

# 1. The real order: 123's view, then 132 — twice.
DB=ht_privacy_test
mk $DB
q $DB setup.sql
q $DB "$MIG" > /dev/null
q $DB "$MIG" > /dev/null
OUT="$(q $DB checks.sql 2>&1 | grep -v '^$' || true)"
echo "$OUT" | grep -E '^(FAIL|privacy-sql)' || { echo "$OUT"; exit 1; }

# 2. A parallel branch appended its own column to the view first: 132 must
#    keep it (a hard-coded column list would try to drop it and fail, 42P16).
DB2=ht_privacy_test_b
mk $DB2
q $DB2 setup.sql
qa $DB2 "ALTER TABLE geofences ADD COLUMN imagery_note TEXT; CREATE OR REPLACE VIEW geofences_json WITH (security_invoker = true) AS SELECT id, company_id, owner_id, name, color, parent_id, kind, notes, folder_url, completed_at, qbo_customer_id, budget, active_from, active_until, created_at, ST_AsGeoJSON(geometry)::jsonb AS geometry, division_id, imagery_note FROM geofences;"
q $DB2 "$MIG" > /dev/null
COLS="$(qa $DB2 "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'geofences_json'")"
case "$COLS" in
  *,division_id,imagery_note,privacy_zone) echo "privacy-sql: view kept a sibling branch's column ($COLS)";;
  *) echo "FAIL view after a sibling branch's column: $COLS"; exit 1;;
esac

echo "$OUT" | grep -q '^FAIL' && exit 1
exit 0
