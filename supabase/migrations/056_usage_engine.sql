-- 056: exact hours engine — zone sessions + daily rollups (invoice-grade).
--
-- Sampling is for drawing trails; MONEY reads this ledger instead. Sessions
-- are rebuilt from RAW pings (full resolution) by SQL that runs entirely in
-- Postgres — nothing ships to the app server. Idempotent by design: every
-- rebuild deletes + recomputes its zone/window, so the hourly cron, the
-- zone-created backfill, and a manual replay all converge on identical rows.
--
-- RETROACTIVE ZONES ARE A REQUIREMENT (Brian, Aug 6): a zone drawn in week 3
-- of a job replays weeks 1-3 through the same code path — raw pings are the
-- source of truth and are never discarded.

CREATE TABLE IF NOT EXISTS zone_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  entered_at  TIMESTAMPTZ NOT NULL,
  exited_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS zone_sessions_zone_idx ON zone_sessions(geofence_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS zone_sessions_asset_idx ON zone_sessions(asset_id, entered_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily (
  company_id   UUID NOT NULL,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  asset_id     UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  on_site_secs INTEGER NOT NULL DEFAULT 0,
  active_secs  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (geofence_id, asset_id, day)
);
CREATE INDEX IF NOT EXISTS usage_daily_zone_idx ON usage_daily(geofence_id, day DESC);

ALTER TABLE zone_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company zone sessions" ON zone_sessions;
CREATE POLICY "company zone sessions" ON zone_sessions
  FOR SELECT USING (company_id = current_company_id());
DROP POLICY IF EXISTS "company usage daily" ON usage_daily;
CREATE POLICY "company usage daily" ON usage_daily
  FOR SELECT USING (company_id = current_company_id());

-- Replay one zone's window from raw pings. SECURITY DEFINER: writes bypass
-- RLS; called by the hourly cron (service role) and by the zone create/
-- reshape actions (user session) — reads of asset_locations stay inside the
-- function, scoped to the zone's own company.
CREATE OR REPLACE FUNCTION rebuild_zone_usage(p_geofence UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
  v_geom GEOMETRY;
BEGIN
  SELECT company_id, geometry INTO v_company, v_geom FROM geofences WHERE id = p_geofence;
  IF v_company IS NULL OR v_geom IS NULL THEN RETURN; END IF;

  DELETE FROM zone_sessions
   WHERE geofence_id = p_geofence AND entered_at < p_to AND exited_at > p_from;
  DELETE FROM usage_daily
   WHERE geofence_id = p_geofence AND day BETWEEN p_from::date AND p_to::date;

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
END $$;

-- Replay every zone (site/yard kinds bill; boundaries and vendors don't).
CREATE OR REPLACE FUNCTION rebuild_all_usage(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE z RECORD;
BEGIN
  FOR z IN SELECT id FROM geofences WHERE COALESCE(kind, 'site') IN ('site', 'yard') LOOP
    PERFORM rebuild_zone_usage(z.id, p_from, p_to);
  END LOOP;
END $$;

-- ONE-TIME BACKFILL (auto-migrate runs this on deploy; ~90 days of history):
SELECT rebuild_all_usage(now() - INTERVAL '90 days', now());
