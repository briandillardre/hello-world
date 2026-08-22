-- 071: stop the hourly rebuild from eating multi-day sessions.
--
-- rebuild_zone_usage deleted every session OVERLAPPING its window but
-- re-inserted only from pings INSIDE it. The hourly cron's fixed now-48h
-- window therefore walked entered_at forward every run: a machine parked on
-- site all week decayed into a ~1h stub after two days, and usage_daily
-- lost the older days the same way (ship-check P1, Aug 22 — surfaced in the
-- Friday digest's "Who was where", AskAI site_visits, zone invoices).
--
-- Fix: snap p_from back to the true start of any session the window
-- overlaps, so those sessions rebuild WHOLE from their original pings
-- (asset_locations retains them). Everything else is identical to 057.
-- The closing backfill re-banks the year to heal already-decayed rows.

CREATE OR REPLACE FUNCTION rebuild_zone_usage(p_geofence UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
  v_geom GEOMETRY;
BEGIN
  SELECT company_id, geometry INTO v_company, v_geom FROM geofences WHERE id = p_geofence;
  IF v_company IS NULL OR v_geom IS NULL THEN RETURN; END IF;

  -- Window snap (071): rebuild overlapped sessions from their true start.
  SELECT LEAST(p_from, COALESCE(MIN(entered_at), p_from)) INTO p_from
  FROM zone_sessions
  WHERE geofence_id = p_geofence AND entered_at < p_to AND exited_at > p_from;

  DELETE FROM zone_sessions
   WHERE geofence_id = p_geofence AND entered_at < p_to AND exited_at > p_from;
  DELETE FROM usage_daily
   WHERE geofence_id = p_geofence AND day BETWEEN p_from::date AND p_to::date;

  -- ── Pass 1: GPS-tracked assets (identical to 056) ─────────────────────────
  WITH pts AS (
    SELECT al.asset_id, al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed,
           ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(al.lng, al.lat), 4326)) AS inside
    FROM asset_locations al
    WHERE al.company_id = v_company AND al."timestamp" >= p_from AND al."timestamp" < p_to
  ),
  marked AS (
    SELECT *, CASE WHEN inside AND NOT COALESCE(LAG(inside) OVER (PARTITION BY asset_id ORDER BY ts), FALSE)
                   THEN 1 ELSE 0 END AS is_entry
    FROM pts
  ),
  grp AS (
    SELECT *, SUM(is_entry) OVER (PARTITION BY asset_id ORDER BY ts) AS g
    FROM marked WHERE inside
  ),
  sess AS (
    -- One session per continuous inside-run. Sub-3-minute drive-throughs
    -- don't bill. A device sleeping ON SITE overnight keeps its session open
    -- (hourly check-ins stay inside), which matches "on site" semantics.
    SELECT asset_id, MIN(ts) AS entered_at, MAX(ts) AS exited_at
    FROM grp GROUP BY asset_id, g
    HAVING MAX(ts) - MIN(ts) >= INTERVAL '3 minutes'
  ),
  ins AS (
    INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
    SELECT v_company, p_geofence, asset_id, entered_at, exited_at FROM sess
    RETURNING 1
  ),
  -- Sessions split across midnights so each day's ledger row is exact.
  by_day AS (
    SELECT s.asset_id, d::date AS day,
           SUM(EXTRACT(EPOCH FROM LEAST(s.exited_at, d + INTERVAL '1 day') - GREATEST(s.entered_at, d)))::int AS on_secs
    FROM sess s
    CROSS JOIN LATERAL generate_series(date_trunc('day', s.entered_at), date_trunc('day', s.exited_at), INTERVAL '1 day') d
    GROUP BY 1, 2
  ),
  -- Active = moving inside the zone: ping-to-ping deltas (capped at 10 min
  -- so a sleep gap never counts) where the arriving ping shows speed.
  act AS (
    SELECT asset_id, ts::date AS day,
           COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM ts - prev_ts), 600)) FILTER (WHERE speed > 2 AND prev_inside), 0)::int AS active_secs
    FROM (
      SELECT asset_id, ts, speed, inside,
             LAG(ts) OVER (PARTITION BY asset_id ORDER BY ts) AS prev_ts,
             LAG(inside) OVER (PARTITION BY asset_id ORDER BY ts) AS prev_inside
      FROM pts
    ) x
    WHERE inside AND prev_ts IS NOT NULL
    GROUP BY 1, 2
  )
  INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
  SELECT v_company, p_geofence, COALESCE(b.asset_id, a.asset_id), COALESCE(b.day, a.day),
         COALESCE(b.on_secs, 0), COALESCE(a.active_secs, 0)
  FROM by_day b
  FULL OUTER JOIN act a ON a.asset_id = b.asset_id AND a.day = b.day
  ON CONFLICT (geofence_id, asset_id, day)
  DO UPDATE SET on_site_secs = EXCLUDED.on_site_secs, active_secs = EXCLUDED.active_secs;

  -- ── Pass 2: TOOL PRESENCE (identical to 057) ──────────────────────────────
  WITH tool_iv AS (
    SELECT pl.member_asset_id AS asset_id,
           GREATEST(pl.started_at, s.entered_at, p_from) AS s_at,
           LEAST(COALESCE(pl.ended_at, pl.last_seen), s.exited_at, p_to) AS e_at
    FROM pairing_log pl
    JOIN zone_sessions s
      ON s.geofence_id = p_geofence
     AND s.asset_id = pl.carrier_asset_id
     AND s.entered_at < COALESCE(pl.ended_at, pl.last_seen)
     AND s.exited_at  > pl.started_at
    WHERE pl.company_id = v_company
      AND pl.kind = 'tool'
      AND pl.started_at < p_to
      AND COALESCE(pl.ended_at, pl.last_seen) > p_from
      -- A tool with its own fixes in the window (TAT141 upgrade) is GPS
      -- truth via pass 1 — never presence-counted on top.
      AND NOT EXISTS (
        SELECT 1 FROM asset_locations al
        WHERE al.asset_id = pl.member_asset_id
          AND al."timestamp" >= p_from AND al."timestamp" < p_to)
  ),
  -- Merge overlapping episodes per tool (re-pairs, double-hears).
  ordered AS (
    SELECT asset_id, s_at, e_at,
           COALESCE(MAX(e_at) OVER (PARTITION BY asset_id ORDER BY s_at, e_at
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), '-infinity'::timestamptz) AS prev_max
    FROM tool_iv WHERE e_at > s_at
  ),
  islands AS (
    SELECT asset_id, s_at, e_at,
           SUM(CASE WHEN s_at > prev_max THEN 1 ELSE 0 END)
             OVER (PARTITION BY asset_id ORDER BY s_at, e_at) AS grp
    FROM ordered
  ),
  merged AS (
    SELECT asset_id, MIN(s_at) AS entered_at, MAX(e_at) AS exited_at
    FROM islands GROUP BY asset_id, grp
    HAVING MAX(e_at) - MIN(s_at) >= INTERVAL '3 minutes'
  ),
  ins2 AS (
    INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
    SELECT v_company, p_geofence, asset_id, entered_at, exited_at FROM merged
    RETURNING 1
  )
  INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
  SELECT v_company, p_geofence, m.asset_id, d::date,
         SUM(EXTRACT(EPOCH FROM LEAST(m.exited_at, d + INTERVAL '1 day') - GREATEST(m.entered_at, d)))::int,
         0
  FROM merged m
  CROSS JOIN LATERAL generate_series(date_trunc('day', m.entered_at), date_trunc('day', m.exited_at), INTERVAL '1 day') d
  GROUP BY m.asset_id, d::date
  ON CONFLICT (geofence_id, asset_id, day)
  DO UPDATE SET on_site_secs = EXCLUDED.on_site_secs;
END $$;

-- Heal already-decayed history: re-bank the year from raw pings.
SELECT rebuild_all_usage(now() - INTERVAL '1 year', now());
