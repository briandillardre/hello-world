-- Hardening scenario (ship-check on 087): applied ON TOP of scenario.sql.
--  • late-inside:  B's Aug 4 10:00–11:59 pings arrive 72 h late (engine time banked late)
--  • late-outside: B leaves Site1 Aug 6 10:00–11:59; those OUTSIDE pings arrive 72 h late
--                  (the session must split once they land)
--  • hybrid tool:  T2 (rides E) gets its own GPS fixes from Aug 10 01:00 — presence must
--                  end there and GPS sessions take over, with no double counting
DO $$
DECLARE b UUID; e UUID; t2 UUID; co UUID; t0 TIMESTAMPTZ := '2026-08-01 00:00Z';
BEGIN
  SELECT id, company_id INTO b, co FROM assets WHERE name = 'B excavator';
  SELECT id INTO e FROM assets WHERE name = 'E night';
  SELECT id INTO t2 FROM assets WHERE name = 'T2 tool';
  UPDATE pings_all SET created_at = ts + INTERVAL '72 hours'
   WHERE asset_id = b AND ts >= t0 + INTERVAL '3 days 10:00' AND ts < t0 + INTERVAL '3 days 12:00';
  UPDATE pings_all SET lat = 5, lng = 5, speed = 20, created_at = ts + INTERVAL '72 hours'
   WHERE asset_id = b AND ts >= t0 + INTERVAL '5 days 10:00' AND ts < t0 + INTERVAL '5 days 12:00';
  -- T2 mirrors E's positions from Aug 10 01:00 on (same cadence).
  INSERT INTO pings_all (asset_id, company_id, lat, lng, speed, ts, created_at)
  SELECT t2, co, lat, lng, speed, ts, created_at FROM pings_all
   WHERE asset_id = e AND ts >= t0 + INTERVAL '9 days 01:00';
END $$;
SELECT count(*) FILTER (WHERE created_at - ts >= INTERVAL '72 hours') AS very_late,
       count(*) FILTER (WHERE asset_id = (SELECT id FROM assets WHERE name='T2 tool')) AS t2_fixes FROM pings_all;
