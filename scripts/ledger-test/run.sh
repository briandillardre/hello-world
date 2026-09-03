#!/bin/bash
# Ledger equivalence harness — proves rebuild_zone_usage (087+) matches a
# from-scratch 056/074 build on a synthetic fleet: parked machines, daily site
# visits, midnight straddles, the exact-3-minute edge, late-arriving pings,
# tool presence with re-pairing. Also checks build_trail_recent against a
# per-day rebuild. Runs on ANY local PostgreSQL 16 (no PostGIS: zones are
# axis-aligned boxes behind stub ST_* functions; the ledger SQL runs verbatim).
#
#   PSQL="psql -h localhost -U postgres" scripts/ledger-test/run.sh
#   (default: `su postgres -c psql`, i.e. a Debian/Ubuntu postgres service)
#
# Every diff table must print 0 rows. Re-run after ANY change to the ledger
# functions — this is invoice-grade money.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
DB="${DB:-ht_ledger_test}"
if [ -n "$PSQL" ]; then
  q() { $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" < "$1"; }
  $PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $DB" && $PSQL -q -d postgres -c "CREATE DATABASE $DB"
else
  q() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$1"; }
  su postgres -c "dropdb --if-exists $DB" && su postgres -c "createdb $DB"
fi
TMP="$(mktemp -d)"
# The shipped 074 function (pre-087 semantics) under another name = the from-scratch reference.
sed -e 's/rebuild_zone_usage/rebuild_zone_usage_old/g' -e '/^REVOKE ALL/d' -e '/^SELECT rebuild_all_usage/d' \
  "$REPO/supabase/migrations/074_ledger_snap_fixpoint.sql" > "$TMP/old_fn.sql"
awk '/CREATE OR REPLACE FUNCTION build_trail_daily/,/^\$\$;/' "$REPO/supabase/migrations/077_trail_daily.sql" > "$TMP/trail_fn.sql"
# build_trail_recent twin that takes the clock as a parameter (the real one uses now()).
python3 - "$REPO/supabase/migrations/087_ledger_io_diet.sql" > "$TMP/trail_recent_at.sql" <<'PY'
import sys
s=open(sys.argv[1]).read()
i=s.index("CREATE OR REPLACE FUNCTION build_trail_recent()"); j=s.index("END $$;", i)+len("END $$;")
print(s[i:j].replace("build_trail_recent()","build_trail_recent_at(p_now TIMESTAMPTZ)").replace("v_now TIMESTAMPTZ := now();","v_now TIMESTAMPTZ := p_now;"))
PY
q setup.sql; q "$TMP/old_fn.sql"; q "$TMP/trail_fn.sql"
q "$REPO/supabase/migrations/087_ledger_io_diet.sql"
q "$REPO/supabase/migrations/090_ledger_hardening.sql"
q "$TMP/trail_recent_at.sql"; q drivers.sql; q scenario.sql
for t in 10_ledger_equivalence.sql 20_ledger_replays.sql 30_trails_equivalence.sql; do echo "── $t"; q "$t" 2>&1 | grep -v "does not exist, skipping"; done
# Hardening suite: late data, hybrid tool, duplicate injection, then a real two-session race.
q scenario2.sql
echo "── 40_ledger_hardening.sql"; q 40_ledger_hardening.sql 2>&1 | grep -v "does not exist, skipping"
echo "── 50_race.sh"
PSQL="$PSQL" ./50_race.sh "$DB"
rm -rf "$TMP"
