#!/bin/bash
# Two rebuilds of the same zone at once (double-save of a reshaped zone / deploy heal vs cron).
# With 090's advisory lock the second waits; sessions must NOT double.
set -e
DB="$1"
pq() {  # pq <psql flags> <sql>
  if [ -n "$PSQL" ]; then $PSQL $1 -d "$DB" -c "$2"; else su postgres -c "psql $1 -d $DB -c \"$2\""; fi
}
ZONE=$(pq -At "SELECT id FROM geofences WHERE name='Site1'")
BEFORE=$(pq -At "SELECT count(*) FROM zone_sessions WHERE geofence_id='$ZONE'")
REPLAY="SELECT rebuild_zone_usage('$ZONE', '2026-08-12 23:00Z'::timestamptz - INTERVAL '365 days', '2026-08-12 23:00Z')"
pq -q "BEGIN; $REPLAY; SELECT pg_sleep(2); COMMIT;" &
sleep 0.5
pq -q "$REPLAY;"
wait
AFTER=$(pq -At "SELECT count(*) FROM zone_sessions WHERE geofence_id='$ZONE'")
DUPS=$(pq -At "SELECT count(*) - count(DISTINCT (asset_id, entered_at, exited_at)) FROM zone_sessions WHERE geofence_id='$ZONE'")
echo "race: Site1 sessions before=$BEFORE after=$AFTER duplicates=$DUPS (expect after=before, duplicates=0)"
[ "$DUPS" = "0" ] && [ "$AFTER" = "$BEFORE" ] || { echo "RACE TEST FAILED"; exit 1; }
