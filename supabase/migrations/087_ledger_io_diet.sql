-- 087: stop the hourly ledger/trail rollups from rescanning history.
--
-- Supabase paged Brian at 1:28 AM Sep 3: project "Hammertrack 2026" is
-- depleting its Disk IO budget. The consumer is rebuild_zone_usage (074):
-- its fixpoint "window snap" widens the hourly cron's 48h window back to the
-- START of any session it overlaps, capped at 60 days. A machine that lives
-- on a site (or the showroom fleet parked at its yard) keeps ONE open
-- session that only grows, so every hour every site/yard zone re-read up to
-- 60 days of the company's raw pings — fat rows (full JSONB telemetry) —
-- and deleted + re-inserted 60 days of ledger rows. Roughly 20 GB/hour of
-- heap reads on a Micro instance = the budget burns in under a day.
--
-- Also fixes a real money bug the snap hid: the old code deleted usage_daily
-- for `p_from::date` and re-inserted it from window pings only, so a truck
-- that left a site at 4 PM lost that whole day's hours from usage_daily
-- (zone page, burn map, insights, MCP all read this ledger) once the hourly
-- window's start moved past 4 PM — unless a parked machine's straddling
-- session happened to snap the window back. zone_sessions kept the visit;
-- usage_daily forgot it.
--
-- New contract — same outputs, bounded work:
--   • The window is DAY-ALIGNED: scan starts at the midnight of p_from's
--     day, so every usage_daily row it touches is rebuilt from the WHOLE
--     day's pings. The hourly cron therefore reads ≤ 3 days per zone.
--   • Sessions that straddle the scan start are CUT at their last inside fix
--     before it (tool-presence rows, which have no fixes, at the edge), the
--     window part is rebuilt from pings exactly as before, and the two are
--     RE-JOINED when nothing lies between them (no fix of that asset falls
--     strictly between the cut and the rebuilt continuation). Same session
--     rows a from-scratch rebuild produces; no 60-day rescan.
--   • Indexes: (company_id, timestamp) makes the ledger scan, the map's
--     "earliest fix" lookup (was a full-history walk for every company
--     but the oldest, every 20 s per open map) and RLS-filtered range reads
--     exact; a partial (asset_id, timestamp DESC) WHERE speed > 2 makes the
--     map's per-asset "last moving fix" a one-row probe instead of a walk
--     back through every parked ping. The single-column company index is
--     subsumed by the composite and dropped (one less index per insert).
--
-- Verified against a from-scratch rebuild on synthetic fleets (parked
-- machines, daily site visits, midnight straddles, late-arriving pings,
-- tool presence with re-pairing) by scripts/ledger-test/run.sh — identical
-- zone_sessions and usage_daily.

CREATE INDEX IF NOT EXISTS asset_locations_company_time_idx
  ON asset_locations (company_id, "timestamp");

CREATE INDEX IF NOT EXISTS asset_locations_moving_idx
  ON asset_locations (asset_id, "timestamp" DESC)
  WHERE speed > 2;

DROP INDEX IF EXISTS asset_locations_company_idx;

CREATE OR REPLACE FUNCTION rebuild_zone_usage(p_geofence UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
  v_geom GEOMETRY;
  v_start TIMESTAMPTZ;
  v_ids UUID[] := '{}';
  v_last TIMESTAMPTZ;
  r RECORD;
BEGIN
  SELECT company_id, geometry INTO v_company, v_geom FROM geofences WHERE id = p_geofence;
  IF v_company IS NULL OR v_geom IS NULL OR p_to <= p_from THEN RETURN; END IF;

  -- Day-align (usage_daily rows are whole days: ts::date, session tz).
  v_start := p_from::date::timestamptz;

  -- ── Cut straddlers at their last inside fix before the scan start ────────
  FOR r IN
    SELECT id, asset_id, entered_at FROM zone_sessions
    WHERE geofence_id = p_geofence AND entered_at < v_start AND exited_at > v_start
  LOOP
    -- The straddler's last fix before the edge is inside by construction, so
    -- the answer is (almost always) the newest of a handful of rows. Fetch
    -- those rows FIRST (an ordered index probe the planner cannot turn into
    -- anything else — LIMIT is a barrier), then test containment: with the
    -- ST_Contains filter inside the probe the planner guessed "1 row after
    -- the filter" and bitmap-scanned the asset's whole session range
    -- (45 days × 3 machines = 260 MB per zone in the harness).
    SELECT x.ts INTO v_last
    FROM (
      SELECT al."timestamp" AS ts, al.lng, al.lat
      FROM asset_locations al
      WHERE al.asset_id = r.asset_id
        AND al."timestamp" < v_start AND al."timestamp" >= r.entered_at
      ORDER BY al."timestamp" DESC
      LIMIT 50
    ) x
    WHERE ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326))
    ORDER BY x.ts DESC
    LIMIT 1;
    IF v_last IS NULL THEN
      -- Rare: 50+ late-arriving outside fixes landed just before the edge.
      -- Walk the whole session range once; correctness over speed here.
      SELECT al."timestamp" INTO v_last
      FROM asset_locations al
      WHERE al.asset_id = r.asset_id
        AND al."timestamp" < v_start AND al."timestamp" >= r.entered_at
        AND ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(al.lng, al.lat), 4326))
      ORDER BY al."timestamp" DESC
      LIMIT 1;
    END IF;
    -- No fix of its own (tool presence) → cut at the edge; the continuation
    -- rebuilt below starts exactly there and the merge re-joins them.
    UPDATE zone_sessions SET exited_at = COALESCE(v_last, v_start) WHERE id = r.id;
    v_ids := v_ids || r.id;
  END LOOP;

  DELETE FROM zone_sessions
   WHERE geofence_id = p_geofence AND entered_at >= v_start AND entered_at < p_to;
  DELETE FROM usage_daily
   WHERE geofence_id = p_geofence AND day BETWEEN v_start::date AND p_to::date;

  -- ── Pass 1: GPS-tracked assets (056 math, window pings only) ─────────────
  -- Sessions + the per-day ACTIVE seconds in one scan; on_site_secs is
  -- filled from the final (merged) session set at the end.
  WITH win AS (
    SELECT al.asset_id, al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed,
           ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(al.lng, al.lat), 4326)) AS inside,
           FALSE AS seed
    FROM asset_locations al
    WHERE al.company_id = v_company AND al."timestamp" >= v_start AND al."timestamp" < p_to
  ),
  -- Each asset's last fix BEFORE the scan start, so the first window ping's
  -- ping-to-ping delta (active seconds) is measured from its real
  -- predecessor exactly as a from-scratch build measures it. Seeds never
  -- start sessions or bank their own day — they only feed LAG().
  seeds AS (
    SELECT a.id AS asset_id, s.ts, s.speed, s.inside, TRUE AS seed
    FROM assets a
    CROSS JOIN LATERAL (
      SELECT al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed,
             ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(al.lng, al.lat), 4326)) AS inside
      FROM asset_locations al
      WHERE al.asset_id = a.id AND al."timestamp" < v_start
      ORDER BY al."timestamp" DESC LIMIT 1
    ) s
    WHERE a.company_id = v_company
  ),
  pts AS (SELECT * FROM win UNION ALL SELECT * FROM seeds),
  marked AS (
    SELECT *, CASE WHEN inside AND NOT COALESCE(LAG(inside) OVER (PARTITION BY asset_id ORDER BY ts), FALSE)
                   THEN 1 ELSE 0 END AS is_entry
    FROM win
  ),
  grp AS (
    SELECT *, SUM(is_entry) OVER (PARTITION BY asset_id ORDER BY ts) AS g
    FROM marked WHERE inside
  ),
  -- A cut straddler's continuation may be shorter than 3 minutes on its own
  -- (the machine left just after midnight): keep the run that starts at the
  -- asset's FIRST window fix when nothing lies between it and the cut — the
  -- merge below re-joins it, exactly as a from-scratch build would see it.
  bridge AS (
    SELECT f.asset_id, f.first_ts
    FROM (SELECT p.asset_id, MIN(p.ts) AS first_ts FROM win p GROUP BY p.asset_id) f
    JOIN zone_sessions c ON c.id = ANY(v_ids) AND c.asset_id = f.asset_id
    WHERE NOT EXISTS (
      SELECT 1 FROM asset_locations al
      WHERE al.asset_id = f.asset_id AND al."timestamp" > c.exited_at AND al."timestamp" < f.first_ts)
  ),
  sess AS (
    -- One session per continuous inside-run. Sub-3-minute drive-throughs
    -- don't bill. A device sleeping ON SITE overnight keeps its session open
    -- (hourly check-ins stay inside), which matches "on site" semantics.
    SELECT g.asset_id, MIN(g.ts) AS entered_at, MAX(g.ts) AS exited_at
    FROM grp g GROUP BY g.asset_id, g.g
    HAVING MAX(g.ts) - MIN(g.ts) >= INTERVAL '3 minutes'
        OR MIN(g.ts) IN (SELECT b.first_ts FROM bridge b WHERE b.asset_id = g.asset_id)
  ),
  ins AS (
    INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
    SELECT v_company, p_geofence, asset_id, entered_at, exited_at FROM sess
    RETURNING 1
  ),
  -- Active = moving inside the zone: ping-to-ping deltas (capped at 10 min
  -- so a sleep gap never counts) where the arriving ping shows speed.
  act AS (
    SELECT asset_id, ts::date AS day,
           COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM ts - prev_ts), 600)) FILTER (WHERE speed > 2 AND prev_inside), 0)::int AS active_secs
    FROM (
      SELECT asset_id, ts, speed, inside, seed,
             LAG(ts) OVER (PARTITION BY asset_id ORDER BY ts) AS prev_ts,
             LAG(inside) OVER (PARTITION BY asset_id ORDER BY ts) AS prev_inside
      FROM pts
    ) x
    WHERE inside AND prev_ts IS NOT NULL AND NOT seed
    GROUP BY 1, 2
  )
  INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
  SELECT v_company, p_geofence, asset_id, day, 0, active_secs FROM act
  ON CONFLICT (geofence_id, asset_id, day)
  DO UPDATE SET active_secs = EXCLUDED.active_secs;

  -- ── Re-join GPS straddlers with their rebuilt continuation ───────────────
  -- (before pass 2, so tool intervals see whole carrier sessions)
  PERFORM zone_usage_merge_cuts(p_geofence, v_start, p_to, v_ids);

  -- ── Pass 2: TOOL PRESENCE (057 math, window only) ────────────────────────
  WITH tool_iv AS (
    SELECT pl.member_asset_id AS asset_id,
           GREATEST(pl.started_at, s.entered_at, v_start) AS s_at,
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
      AND COALESCE(pl.ended_at, pl.last_seen) > v_start
      -- A tool with its own fixes in the window (TAT141 upgrade) is GPS
      -- truth via pass 1 — never presence-counted on top.
      AND NOT EXISTS (
        SELECT 1 FROM asset_locations al
        WHERE al.asset_id = pl.member_asset_id
          AND al."timestamp" >= v_start AND al."timestamp" < p_to)
  ),
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
    SELECT i.asset_id, MIN(i.s_at) AS entered_at, MAX(i.e_at) AS exited_at
    FROM islands i GROUP BY i.asset_id, i.grp
    HAVING MAX(i.e_at) - MIN(i.s_at) >= INTERVAL '3 minutes'
        -- Same bridge rule for a cut presence row: its continuation starts
        -- exactly at the scan start and always re-joins.
        OR (MIN(i.s_at) = v_start AND EXISTS (
              SELECT 1 FROM zone_sessions c WHERE c.id = ANY(v_ids) AND c.asset_id = i.asset_id))
  )
  INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
  SELECT v_company, p_geofence, asset_id, entered_at, exited_at FROM merged;

  -- ── Re-join tool straddlers ──────────────────────────────────────────────
  PERFORM zone_usage_merge_cuts(p_geofence, v_start, p_to, v_ids);

  -- ── on_site_secs for every day the window touches, from the FINAL sessions
  -- (rebuilt, re-joined and untouched-but-overlapping alike) — sessions split
  -- across midnights so each day's ledger row is exact.
  INSERT INTO usage_daily (company_id, geofence_id, asset_id, day, on_site_secs, active_secs)
  SELECT v_company, p_geofence, s.asset_id, d::date,
         SUM(EXTRACT(EPOCH FROM LEAST(s.exited_at, d + INTERVAL '1 day') - GREATEST(s.entered_at, d)))::int,
         0
  FROM zone_sessions s
  CROSS JOIN LATERAL generate_series(GREATEST(date_trunc('day', s.entered_at), v_start),
                                     date_trunc('day', s.exited_at), INTERVAL '1 day') d
  WHERE s.geofence_id = p_geofence AND s.exited_at > v_start AND s.entered_at < p_to
    AND d::date <= p_to::date
  GROUP BY s.asset_id, d::date
  ON CONFLICT (geofence_id, asset_id, day)
  DO UPDATE SET on_site_secs = EXCLUDED.on_site_secs;
END $$;

-- Re-join a cut straddler with the earliest rebuilt session of the same
-- asset when no fix of that asset falls strictly between the cut and that
-- session's start (the continuation IS the asset's next fix, or — for
-- tool-presence rows with no fixes — starts at the cut itself). A cut row
-- that already re-joined has exited_at past the scan start and is skipped,
-- so calling this twice is safe.
CREATE OR REPLACE FUNCTION zone_usage_merge_cuts(p_geofence UUID, p_start TIMESTAMPTZ, p_to TIMESTAMPTZ, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  FOR r IN
    SELECT s.id AS old_id, n.id AS new_id, n.exited_at AS new_exit
    FROM zone_sessions s
    JOIN LATERAL (
      SELECT z.id, z.entered_at, z.exited_at FROM zone_sessions z
      WHERE z.geofence_id = p_geofence AND z.asset_id = s.asset_id
        AND z.entered_at >= p_start AND z.entered_at < p_to
      ORDER BY z.entered_at LIMIT 1
    ) n ON TRUE
    WHERE s.id = ANY(p_ids) AND s.exited_at <= p_start
      AND NOT EXISTS (
        SELECT 1 FROM asset_locations al
        WHERE al.asset_id = s.asset_id
          AND al."timestamp" > s.exited_at AND al."timestamp" < n.entered_at)
  LOOP
    UPDATE zone_sessions SET exited_at = r.new_exit WHERE id = r.old_id;
    DELETE FROM zone_sessions WHERE id = r.new_id;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION rebuild_zone_usage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION zone_usage_merge_cuts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;

-- ── Trail rollups: rebuild only the days that received rows ──────────────
-- The hourly cron rebuilt today + 7 trailing days every run (8 full-day
-- scans + 8 days of trail_daily rows rewritten) to catch late tracker
-- uploads. created_at (049) says exactly which days got new rows since the
-- last run — usually just today. Days older than the 7-day cap are still
-- rebuilt when a late upload lands in them (ingest drops fixes >30 days old).
CREATE TABLE IF NOT EXISTS trail_recent_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  since TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trail_recent_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trail_recent_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION build_trail_recent()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_since TIMESTAMPTZ;
  v_day DATE;
  v_built INTEGER := 0;
BEGIN
  SELECT since INTO v_since FROM trail_recent_state WHERE id;
  -- First run / long stall: bound the arrival scan to the old trailing week.
  v_since := GREATEST(COALESCE(v_since, v_now - INTERVAL '7 days'), v_now - INTERVAL '7 days')
             - INTERVAL '5 minutes';
  FOR v_day IN
    SELECT DISTINCT al."timestamp"::date FROM asset_locations al
    WHERE al.created_at >= v_since AND al."timestamp" < v_now + INTERVAL '1 day'
    ORDER BY 1
  LOOP
    PERFORM build_trail_daily(v_day);
    v_built := v_built + 1;
  END LOOP;
  INSERT INTO trail_recent_state (id, since) VALUES (TRUE, v_now)
  ON CONFLICT (id) DO UPDATE SET since = EXCLUDED.since, updated_at = now();
  RETURN v_built;
END $$;

REVOKE ALL ON FUNCTION build_trail_recent() FROM PUBLIC, anon, authenticated;
