-- 091: heal the usage_daily decay 087 fixed — without a long statement.
--
-- Before 087, the hourly rebuild deleted usage_daily for the first day of
-- its window and re-inserted only what the window's own pings produced, so
-- a day lost every site visit that ended before the window start on that
-- day. zone_sessions kept the visits (074 fixed session decay), so:
--
--   1. on_site_secs for EVERY (zone, asset, day) is restored from
--      zone_sessions right here — a few thousand small rows, sub-second.
--      Exact duplicates left by pre-090 overlapping rebuilds go first.
--   2. active_secs (moving time inside the zone) needs the pings. That is
--      the expensive part, and it must not run at deploy: the migration
--      connection has a 2-minute statement_timeout and the instance is IO-
--      throttled (the very alert this work answers). heal_active_day(day)
--      recomputes ONE day for every zone of every company in a single pass
--      over that day's pings (each ping tested against its company's zones),
--      and ledger_heal_step(n) walks a cursor from today back to the oldest
--      ping, n days per call. The hourly usage cron calls it until done —
--      the whole history in under a day, ~20 MB of reads per healed day.
--
-- Equivalence: scripts/ledger-test 60_heal.sql corrupts a proven ledger and
-- shows the heal restoring it to the from-scratch truth exactly.

DELETE FROM zone_sessions a USING zone_sessions b
 WHERE a.geofence_id = b.geofence_id AND a.asset_id = b.asset_id
   AND a.entered_at = b.entered_at AND a.exited_at = b.exited_at AND a.id > b.id;

CREATE OR REPLACE FUNCTION heal_on_site_from_sessions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  WITH up AS (
    INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
    SELECT s.company_id, s.geofence_id, s.asset_id, d::date,
           SUM(EXTRACT(EPOCH FROM LEAST(s.exited_at, d + INTERVAL '1 day') - GREATEST(s.entered_at, d)))::int, 0
    FROM zone_sessions s
    CROSS JOIN LATERAL generate_series(date_trunc('day', s.entered_at), date_trunc('day', s.exited_at), INTERVAL '1 day') d
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (geofence_id, asset_id, day)
    DO UPDATE SET on_site_secs = EXCLUDED.on_site_secs
    WHERE usage_daily.on_site_secs IS DISTINCT FROM EXCLUDED.on_site_secs
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM up;
  -- A day row with hours but no session left to back it: presence is 0.
  UPDATE usage_daily u SET on_site_secs = 0
   WHERE u.on_site_secs <> 0
     AND NOT EXISTS (
       SELECT 1 FROM zone_sessions s
       WHERE s.geofence_id = u.geofence_id AND s.asset_id = u.asset_id
         AND s.entered_at < (u.day + 1)::timestamptz AND s.exited_at > u.day::timestamptz);
  RETURN v_n;
END $$;

-- Recompute active_secs for every (billing zone, asset) on ONE day, all
-- companies at once, from that day's pings. Same math as rebuild_zone_usage
-- (ping-to-ping deltas capped at 10 min where the arriving ping is inside
-- and moving, seeded with each asset's last fix before the day).
CREATE OR REPLACE FUNCTION heal_active_day(p_day DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  WITH zs AS (
    SELECT id, company_id, geometry FROM geofences
    WHERE COALESCE(kind, 'site') IN ('site', 'yard') AND geometry IS NOT NULL
  ),
  win AS (
    SELECT al.company_id, al.asset_id, al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed, al.lng, al.lat, FALSE AS seed
    FROM asset_locations al
    WHERE al."timestamp" >= p_day::timestamptz AND al."timestamp" < (p_day + 1)::timestamptz
  ),
  seeds AS (
    SELECT a.company_id, a.id AS asset_id, s.ts, s.speed, s.lng, s.lat, TRUE AS seed
    FROM assets a
    CROSS JOIN LATERAL (
      SELECT al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed, al.lng, al.lat
      FROM asset_locations al
      WHERE al.asset_id = a.id AND al."timestamp" < p_day::timestamptz
      ORDER BY al."timestamp" DESC LIMIT 1
    ) s
    WHERE EXISTS (SELECT 1 FROM win w WHERE w.asset_id = a.id)
  ),
  pts AS (SELECT * FROM win UNION ALL SELECT * FROM seeds),
  marked AS (
    SELECT z.id AS zone_id, p.company_id, p.asset_id, p.ts, p.speed, p.seed,
           ST_Contains(z.geometry, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)) AS inside
    FROM pts p JOIN zs z ON z.company_id = p.company_id
  ),
  lagged AS (
    SELECT *,
           LAG(ts) OVER (PARTITION BY zone_id, asset_id ORDER BY ts) AS prev_ts,
           LAG(inside) OVER (PARTITION BY zone_id, asset_id ORDER BY ts) AS prev_inside
    FROM marked
  ),
  act AS (
    SELECT zone_id, company_id, asset_id,
           COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM ts - prev_ts), 600)) FILTER (WHERE speed > 2 AND prev_inside), 0)::int AS active_secs
    FROM lagged
    WHERE inside AND prev_ts IS NOT NULL AND NOT seed
    GROUP BY 1, 2, 3
  ),
  up AS (
    INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
    SELECT company_id, zone_id, asset_id, p_day, 0, active_secs FROM act
    ON CONFLICT (geofence_id, asset_id, day)
    DO UPDATE SET active_secs = EXCLUDED.active_secs
    RETURNING 1
  ),
  zeroed AS (
    UPDATE usage_daily u SET active_secs = 0
    WHERE u.day = p_day AND u.active_secs <> 0
      AND NOT EXISTS (SELECT 1 FROM act a WHERE a.zone_id = u.geofence_id AND a.asset_id = u.asset_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up) + (SELECT count(*) FROM zeroed) INTO v_n;
  RETURN v_n;
END $$;

CREATE TABLE IF NOT EXISTS ledger_heal_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  next_day DATE NOT NULL,
  oldest DATE NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ledger_heal_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ledger_heal_state FROM PUBLIC, anon, authenticated;

-- Walk the heal cursor from today back to the oldest ping, p_days per call.
-- Returns days healed this call; 0 once done. Delete the state row to redo.
CREATE OR REPLACE FUNCTION ledger_heal_step(p_days INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next DATE; v_oldest DATE; v_done BOOLEAN; v_n INTEGER := 0;
BEGIN
  SELECT next_day, oldest, done INTO v_next, v_oldest, v_done FROM ledger_heal_state WHERE id;
  IF NOT FOUND THEN
    SELECT min("timestamp")::date INTO v_oldest FROM asset_locations;
    IF v_oldest IS NULL THEN RETURN 0; END IF;
    v_next := current_date;
    INSERT INTO ledger_heal_state (id, next_day, oldest) VALUES (TRUE, v_next, v_oldest);
  END IF;
  IF v_done THEN RETURN 0; END IF;
  WHILE v_next >= v_oldest AND v_n < GREATEST(1, p_days) LOOP
    PERFORM heal_active_day(v_next);
    v_next := v_next - 1;
    v_n := v_n + 1;
  END LOOP;
  UPDATE ledger_heal_state SET next_day = v_next, done = (v_next < v_oldest), updated_at = now() WHERE id;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION heal_on_site_from_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION heal_active_day(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ledger_heal_step(INTEGER) FROM PUBLIC, anon, authenticated;

-- Step 1 now (sub-second). Step 2 starts on the next hourly cron run.
SELECT heal_on_site_from_sessions();
