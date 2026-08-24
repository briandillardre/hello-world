-- 077: pre-rolled daily trails (Brian, Aug 25: "30 days / YTD / All time is
-- not working on trails... we're going to have to save this data in a
-- different way — this is not going to work once we have 500 devices").
--
-- The live sampler (039/063) window-scans every raw ping in the range; on
-- YTD/All that blows the statement budget, the RPC dies, and /api/history
-- silently fell back to a newest-first page fetch — which is why long
-- ranges only showed the last couple of days. The durable shape: each
-- asset's day is compressed ONCE (hourly cron) into ≤288 evenly-strided
-- points (~5-min resolution) plus a 36-point lite version for very long
-- spans. A YTD map read then touches hundreds of tiny rows instead of
-- scanning millions of raw pings — flat cost at any fleet size.

CREATE TABLE IF NOT EXISTS trail_daily (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  -- [[lng, lat, epoch_sec, mph|null], ...] evenly strided, first+last kept
  pts JSONB NOT NULL,
  -- Same shape, ≤36 points — the >45-day-span resolution.
  pts_lite JSONB NOT NULL,
  n_raw INTEGER NOT NULL DEFAULT 0,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, day)
);
CREATE INDEX IF NOT EXISTS trail_daily_company_day_idx ON trail_daily(company_id, day);

ALTER TABLE trail_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company trail_daily" ON trail_daily;
CREATE POLICY "company trail_daily" ON trail_daily
  FOR SELECT USING (company_id = current_company_id());

-- Build (or rebuild) one UTC day for every asset that pinged that day.
-- One indexed range scan of that day only — safe to re-run any time
-- (today is rebuilt hourly while it's still accumulating).
CREATE OR REPLACE FUNCTION build_trail_daily(p_day DATE)
RETURNS INTEGER
LANGUAGE sql SECURITY INVOKER AS $$
  WITH day_rows AS (
    SELECT al.company_id, al.asset_id, al.lat, al.lng, al.speed, al."timestamp",
           row_number() OVER (PARTITION BY al.asset_id ORDER BY al."timestamp") AS rn,
           count(*)     OVER (PARTITION BY al.asset_id)                        AS n
    FROM asset_locations al
    WHERE al."timestamp" >= p_day::timestamptz
      AND al."timestamp" <  (p_day + 1)::timestamptz
  ),
  packed AS (
    SELECT company_id, asset_id,
      jsonb_agg(
        jsonb_build_array(round(lng::numeric, 6), round(lat::numeric, 6), extract(epoch FROM "timestamp")::bigint, speed)
        ORDER BY "timestamp"
      ) FILTER (WHERE (rn - 1) % GREATEST(1, CEIL(n / 288.0)::int) = 0 OR rn = 1 OR rn = n) AS pts,
      jsonb_agg(
        jsonb_build_array(round(lng::numeric, 6), round(lat::numeric, 6), extract(epoch FROM "timestamp")::bigint, speed)
        ORDER BY "timestamp"
      ) FILTER (WHERE (rn - 1) % GREATEST(1, CEIL(n / 36.0)::int) = 0 OR rn = 1 OR rn = n) AS pts_lite,
      max(n)::int AS n_raw
    FROM day_rows
    GROUP BY company_id, asset_id
  ),
  upserted AS (
    INSERT INTO trail_daily (company_id, asset_id, day, pts, pts_lite, n_raw)
    SELECT company_id, asset_id, p_day, COALESCE(pts, '[]'::jsonb), COALESCE(pts_lite, '[]'::jsonb), n_raw
    FROM packed
    ON CONFLICT (asset_id, day) DO UPDATE
      SET pts = EXCLUDED.pts, pts_lite = EXCLUDED.pts_lite,
          n_raw = EXCLUDED.n_raw, company_id = EXCLUDED.company_id, built_at = now()
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upserted
$$;

-- Backfill driver: builds up to p_days MISSING days (oldest first) per call.
-- The hourly cron drains history incrementally instead of one giant
-- build-time scan blocking a deploy.
CREATE OR REPLACE FUNCTION trail_backfill(p_days INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_day DATE;
  v_built INTEGER := 0;
  v_min DATE;
BEGIN
  SELECT min("timestamp")::date INTO v_min FROM asset_locations;
  IF v_min IS NULL THEN RETURN 0; END IF;
  FOR v_day IN
    SELECT d::date FROM generate_series(v_min, current_date - 1, interval '1 day') d
    WHERE NOT EXISTS (SELECT 1 FROM trail_daily t WHERE t.day = d::date)
      AND EXISTS (
        SELECT 1 FROM asset_locations al
        WHERE al."timestamp" >= d AND al."timestamp" < d + interval '1 day'
      )
    ORDER BY d
    LIMIT GREATEST(1, p_days)
  LOOP
    PERFORM build_trail_daily(v_day);
    v_built := v_built + 1;
  END LOOP;
  RETURN v_built;
END $$;

-- Cron/service-role only — same hygiene as the ledger rebuild fns (073).
REVOKE ALL ON FUNCTION build_trail_daily(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trail_backfill(INTEGER) FROM PUBLIC, anon, authenticated;
