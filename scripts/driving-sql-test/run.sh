#!/bin/bash
# Driver safety scores, SQL side — applies migration 129 VERBATIM to a bare
# local PostgreSQL 16 (setup.sql stubs the Supabase bits) and proves:
#   • driving_day_fixes hands the engine the compact array lib/driving-score
#     decodeFix reads (same order, harsh keys only on the records that carry them);
#   • driving_put_day replaces a vehicle-day whole (twice = once), takes the
#     company from the asset, and drops a site or a person from another company;
#   • the backfill to-do list and the dirty list find the right days;
#   • reads follow the company, the per-asset visibility ladder (111) and the
#     prospect lockdown (119); no member can write; the builder functions are
#     the service role's alone.
#
#   PSQL="psql -h localhost -p 5432 -U postgres" bash scripts/driving-sql-test/run.sh
#   (default: `su postgres -c psql`, i.e. a Debian/Ubuntu postgres service)
#
# Run it after ANY change to 129's SQL or to decodeFix / analyzeDay.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
DB="${DB:-ht_driving_test}"
TMP="$(mktemp -d)"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
if [ -n "$PSQL" ]; then
  q() { $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" < "$1" > /dev/null; }
  qa() { $PSQL -v ON_ERROR_STOP=1 -qAt -d "$DB" -c "$1"; }
  $PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $DB" && $PSQL -q -d postgres -c "CREATE DATABASE $DB"
else
  chmod 755 "$TMP"
  q() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$1" > /dev/null; }
  qa() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt -d $DB -c \"$1\""; }
  su postgres -c "dropdb --if-exists $DB" && su postgres -c "createdb $DB"
fi
q setup.sql
q "$REPO/supabase/migrations/129_driving_scores.sql"
node gen.mjs data "$TMP"
q "$TMP/data.sql"

TRUCK=00000000-0000-4000-8000-0000000000c1
HIDDEN=00000000-0000-4000-8000-0000000000c2
COA=00000000-0000-4000-8000-00000000000a
COB=00000000-0000-4000-8000-00000000000b
qa "SELECT driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z')" > "$TMP/fixes.json"
node gen.mjs build "$TMP"
q "$TMP/put.sql"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $1 — got '$2', want '$3'"; fi; }
as() { qa "SET ROLE authenticated; SET request.jwt.claim.sub = '$1'; $2"; }
exp() { node -e "const e=require('$TMP/expected.json'); console.log($1)"; }

# ── the read the builder runs ───────────────────────────────────────────────
check "fixes: one array element per record in the window" "$(qa "SELECT jsonb_array_length(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z'))")" "$(qa "SELECT count(*) FROM asset_locations WHERE asset_id = '$TRUCK' AND \"timestamp\" >= '2026-10-06T03:50:00Z' AND \"timestamp\" < '2026-10-07T04:10:00Z'")"
check "fixes: the engine decoded every one" "$(exp 'e.fixes')" "$(qa "SELECT jsonb_array_length(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z'))")"
check "fixes: harsh keys ride only on the record that carries them" "$(qa "SELECT count(*) FROM jsonb_array_elements(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z')) e WHERE e->10 <> 'null'::jsonb")" "1"
check "fixes: the device's g comes through" "$(qa "SELECT e->10->>'absolute.acceleration' FROM jsonb_array_elements(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z')) e WHERE e->10 <> 'null'::jsonb")" "0.47"
check "fixes: the tag-scan record keeps its event id" "$(qa "SELECT count(*) FROM jsonb_array_elements(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z')) e WHERE (e->>8) = '385'")" "1"
check "fixes: the speedometer (km/h) rides on the records that carry it" "$(qa "SELECT count(*) FROM jsonb_array_elements(driving_day_fixes('$TRUCK', '2026-10-06T03:50:00Z', '2026-10-07T04:10:00Z')) e WHERE e->12 <> 'null'::jsonb")" "13"
check "fixes: …and the engine reads it as mph" "$(exp 'e.obd')" "13"
check "fixes: heading comes through" "$(exp 'e.headings')" "$(exp 'e.fixes')"
check "engine: the device hard brake, confirmed by the speed, no GPS duplicate" "$(exp "e.kinds.join(',')")" "harsh_brake:device:confirmed"

# ── the write ───────────────────────────────────────────────────────────────
check "put twice = one row" "$(qa "SELECT count(*) FROM driving_daily WHERE asset_id = '$TRUCK'")" "1"
check "put twice = the events once" "$(qa "SELECT count(*) FROM driving_events WHERE asset_id = '$TRUCK'")" "$(exp 'e.events')"
check "company comes from the asset, not the payload" "$(qa "SELECT company_id FROM driving_daily WHERE asset_id = '$TRUCK'")" "$COA"
check "row: miles as the engine counted" "$(qa "SELECT round(miles::numeric, 2) FROM driving_daily WHERE asset_id = '$TRUCK'")" "$(exp 'e.row.miles.toFixed(2)')"
check "row: moving seconds" "$(qa "SELECT moving_s FROM driving_daily WHERE asset_id = '$TRUCK'")" "$(exp 'e.row.moving_s')"
check "row: confirmed hard brakes" "$(qa "SELECT brake_mod + brake_sev FROM driving_daily WHERE asset_id = '$TRUCK'")" "$(exp 'e.row.brake_mod + e.row.brake_sev')"
check "row: …one of them" "$(exp 'e.row.brake_mod + e.row.brake_sev')" "1"
check "row: speedometer seconds" "$(qa "SELECT obd_s FROM driving_daily WHERE asset_id = '$TRUCK'")" "$(exp 'e.row.obd_s')"
check "row: vehicle class" "$(qa "SELECT vclass FROM driving_daily WHERE asset_id = '$TRUCK'")" "light"
check "row: a heavy truck stays heavy" "$(qa "SELECT vclass FROM driving_daily WHERE asset_id = '$HIDDEN'")" "heavy"
check "row: an unknown class is read as light" "$(qa "SELECT vclass FROM driving_daily WHERE asset_id = '00000000-0000-4000-8000-0000000000c3'")" "light"
check "event: confirmed flag stored" "$(qa "SELECT string_agg(confirmed::text, ',') FROM driving_events WHERE asset_id = '$TRUCK'")" "true"
check "row: accelerometer on" "$(qa "SELECT accel_on FROM driving_daily WHERE asset_id = '$TRUCK'")" "t"
check "row: …and seen on the day itself" "$(qa "SELECT accel_seen FROM driving_daily WHERE asset_id = '$TRUCK'")" "t"
check "row: version" "$(qa "SELECT version FROM driving_daily WHERE asset_id = '$TRUCK'")" "1"
check "another company's site is dropped from an event" "$(qa "SELECT count(*) FROM driving_events WHERE zone_id IS NOT NULL")" "0"
check "another company's person is dropped from an event" "$(qa "SELECT count(*) FROM driving_events WHERE person_id = '$COB'")" "0"

# ── what to build ───────────────────────────────────────────────────────────
check "backfill: days with fixes and no row, oldest first" "$(qa "SELECT string_agg(day::text, ',' ORDER BY day) FROM driving_backfill_todo(ARRAY['$TRUCK']::uuid[], '2026-10-01', '2026-10-07', 'America/New_York', 1, 50)")" "2026-10-04,2026-10-05"
check "backfill: a version bump re-banks built days" "$(qa "SELECT string_agg(day::text, ',' ORDER BY day) FROM driving_backfill_todo(ARRAY['$TRUCK']::uuid[], '2026-10-01', '2026-10-07', 'America/New_York', 2, 50)")" "2026-10-04,2026-10-05,2026-10-06"
check "backfill: the limit holds" "$(qa "SELECT count(*) FROM driving_backfill_todo(ARRAY['$TRUCK']::uuid[], '2026-10-01', '2026-10-07', 'America/New_York', 2, 1)")" "1"
check "backfill: a bad zone name falls back to Eastern" "$(qa "SELECT count(*) FROM driving_backfill_todo(ARRAY['$TRUCK']::uuid[], '2026-10-01', '2026-10-07', 'Not/AZone', 1, 50)")" "2"
check "dirty: rows that arrived since the watermark, per vehicle" "$(qa "SELECT count(*) FROM driving_dirty(now() - interval '1 hour', ARRAY['$TRUCK','$HIDDEN']::uuid[])")" "2"

# ── the readers' sums ───────────────────────────────────────────────────────
TRUCK2=00000000-0000-4000-8000-0000000000c4
qa "SELECT json_agg(d ORDER BY d.day) FROM driving_daily d WHERE asset_id = '$TRUCK2'" > "$TMP/days.json"
qa "SELECT json_agg(r) FROM driving_rollup('$COA', ARRAY['$TRUCK2']::uuid[], '2026-08-01', '2026-10-31') r" > "$TMP/rollup.json"
check "rollup: one row per vehicle-month, summed = the TS fold of its days (totals, riders, score)" "$(node gen.mjs sums "$TMP")" "ok"
check "rollup: the window's edges hold" "$(qa "SELECT string_agg(month || ':' || n_days, ',' ORDER BY month) FROM driving_rollup('$COA', ARRAY['$TRUCK2']::uuid[], '2026-09-01', '2026-09-29')")" "2026-09:2"
check "rollup: another company's id filters to nothing" "$(qa "SELECT count(*) FROM driving_rollup('$COB', ARRAY['$TRUCK2']::uuid[], '2026-08-01', '2026-10-31')")" "0"
check "person events: counted by person and kind" "$(qa "SELECT string_agg(severity || ':' || n, ',' ORDER BY severity) FROM driving_person_events('$COA', ARRAY['$TRUCK2']::uuid[], '2026-09-01', '2026-10-01') WHERE person_id = '00000000-0000-4000-8000-0000000000a1'")" "moderate:1,severe:1"
check "a crew member's sums skip the owner-only truck" "$(as 00000000-0000-4000-8000-0000000000a1 "SELECT count(*) FROM driving_rollup('$COA', ARRAY['$HIDDEN']::uuid[], '2026-01-01', '2026-12-31')")" "0"
check "…but see their own company's" "$(as 00000000-0000-4000-8000-0000000000a1 "SELECT sum(n_days) FROM driving_rollup('$COA', ARRAY['$TRUCK2']::uuid[], '2026-01-01', '2026-12-31')")" "4"
check "a Prospective Client's sums are empty" "$(as 00000000-0000-4000-8000-0000000000e1 "SELECT count(*) FROM driving_rollup('$COA', ARRAY['$TRUCK2']::uuid[], '2026-01-01', '2026-12-31')")" "0"
check "…and so are their event counts" "$(as 00000000-0000-4000-8000-0000000000e1 "SELECT count(*) FROM driving_person_events('$COA', ARRAY['$TRUCK2']::uuid[], '2026-01-01', '2027-01-01')")" "0"
check "anon cannot run the sums" "$(qa "SET ROLE anon; SELECT count(*) FROM driving_rollup('$COA', ARRAY['$TRUCK2']::uuid[], '2026-01-01', '2026-12-31')" 2>&1 | grep -c 'permission denied')" "1"

# ── who reads ───────────────────────────────────────────────────────────────
check "a crew member reads their company's scores" "$(as 00000000-0000-4000-8000-0000000000a1 "SELECT count(DISTINCT asset_id) FROM driving_daily")" "2"
check "…but not the owner-only truck's" "$(as 00000000-0000-4000-8000-0000000000a1 "SELECT count(*) FROM driving_daily WHERE asset_id = '$HIDDEN'")" "0"
check "…nor its events" "$(as 00000000-0000-4000-8000-0000000000f1 "SELECT count(*) FROM driving_events WHERE asset_id = '$HIDDEN'")" "0"
check "the owner reads every truck, the owner-only one too" "$(as $COA "SELECT count(DISTINCT asset_id) FROM driving_daily")" "3"
check "nobody reads another company's" "$(as $COB "SELECT count(*) FROM driving_daily WHERE company_id = '$COA'")" "0"
check "a Prospective Client reads no scores" "$(as 00000000-0000-4000-8000-0000000000e1 "SELECT count(*) FROM driving_daily")" "0"
check "…and no events" "$(as 00000000-0000-4000-8000-0000000000e1 "SELECT count(*) FROM driving_events")" "0"
check "no member can write a score" "$(as $COA "INSERT INTO driving_daily (asset_id, day, company_id) VALUES ('$TRUCK', '2026-01-01', '$COA')" 2>&1 | grep -c 'permission denied')" "1"
check "no member can run the builder's read" "$(as $COA "SELECT driving_day_fixes('$TRUCK', now() - interval '9 days', now())" 2>&1 | grep -c 'permission denied')" "1"
check "no member can run the builder's write" "$(as $COA "SELECT driving_put_day('$TRUCK', '2026-10-06', '{}'::jsonb, '[]'::jsonb)" 2>&1 | grep -c 'permission denied')" "1"
check "anon reads nothing" "$(qa "SET ROLE anon; SELECT count(*) FROM driving_daily" 2>&1 | grep -c 'permission denied')" "1"

echo "driving-sql: $pass passed, $fail failed"
if [ -n "$PSQL" ]; then $PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $DB" > /dev/null 2>&1 || true; fi
rm -rf "$TMP"
[ "$fail" = "0" ]
