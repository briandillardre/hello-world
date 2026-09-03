\set ON_ERROR_STOP on
\echo '=== trail_daily: hourly build_trail_recent vs from-scratch per-day build ==='
TRUNCATE asset_locations, trail_daily, trail_recent_state;
DO $$
DECLARE h TIMESTAMPTZ := '2026-08-01 01:00Z'; n INT;
BEGIN
  WHILE h <= '2026-08-12 23:00Z' LOOP
    PERFORM advance_to(h);
    -- the cron's clock: build_trail_recent uses now(); emulate by shifting created_at relative to now
    PERFORM set_config('ht.fake_now', h::text, false);
    SELECT build_trail_recent_at(h) INTO n;
    h := h + INTERVAL '1 hour';
  END LOOP;
END $$;
DROP TABLE IF EXISTS inc_trail; CREATE TABLE inc_trail AS SELECT asset_id, day, pts, pts_lite, n_raw FROM trail_daily;
TRUNCATE trail_daily;
DO $$ DECLARE d DATE; BEGIN
  FOR d IN SELECT generate_series('2026-08-01'::date, '2026-08-12'::date, '1 day')::date LOOP PERFORM build_trail_daily(d); END LOOP;
END $$;
SELECT (SELECT count(*) FROM inc_trail) AS incremental_rows, (SELECT count(*) FROM trail_daily) AS scratch_rows;
SELECT 'only_incremental' AS side, count(*) FROM (SELECT asset_id, day, pts, pts_lite, n_raw FROM inc_trail EXCEPT SELECT asset_id, day, pts, pts_lite, n_raw FROM trail_daily) x
UNION ALL SELECT 'only_scratch', count(*) FROM (SELECT asset_id, day, pts, pts_lite, n_raw FROM trail_daily EXCEPT SELECT asset_id, day, pts, pts_lite, n_raw FROM inc_trail) y;
