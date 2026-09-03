-- 090: ledger hardening — the ship-check pass on 087 found three holes.
--
-- P1  Two rebuilds of the SAME zone overlapping (a member saving a reshaped
--     zone twice within seconds, or the 088 deploy heal landing on the
--     hourly cron) each inserted a full session set. 074 left duplicate
--     rows too, but its usage_daily came from the fresh CTE; 087 sums the
--     zone_sessions TABLE, so duplicates doubled the hours — and the
--     cut/merge loop kept both duplicates forever. Fix: one rebuild per
--     zone at a time (transaction-scoped advisory lock), plus a guard that
--     drops exact duplicate rows before cutting.
-- P2  Pings arriving more than 48 h late (a TAT141 that buffered offline on
--     a site for days) were never banked by the day-aligned window; 074's
--     snap caught them by accident, for parked machines only. Fix:
--     rebuild_all_usage looks at rows that ARRIVED since its last run and
--     pulls the window back to the oldest such timestamp (≤ 30 days — the
--     ingest drops older fixes). Quiet hours stay at ≤ 3 days per zone.
-- P2  A tool-presence row cut at the edge (no fixes of its own) re-joined
--     any later GPS session of that tool because "no fix strictly between"
--     is vacuously true for an asset without fixes. Fix: an edge cut may
--     only re-join a continuation that starts exactly at the edge; a GPS
--     cut keeps the "next fix is inside" rule. Also fixed at the root
--     (074's P3): presence now ends where the tool's OWN fixes begin,
--     instead of vanishing for the whole window the moment the tool has
--     any fix in it — from-scratch and incremental builds agree for a tool
--     that gets a TAT141 mid-history.
--
-- 091 replays 90 days once more under the lock so any doubled zone from
-- the 088/cron overlap is clean. Harness: scripts/ledger-test/run.sh —
-- 40_ledger_hardening.sql covers late data (72 h), the hybrid tool, a
-- duplicate injection and a genuine two-session race.

CREATE TABLE IF NOT EXISTS ledger_recent_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  since TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ledger_recent_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ledger_recent_state FROM PUBLIC, anon, authenticated;

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

  -- One rebuild per zone at a time; released at commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext(p_geofence::text));
  -- Exact duplicates left by any earlier overlap: keep one.
  DELETE FROM zone_sessions a USING zone_sessions b
   WHERE a.geofence_id = p_geofence AND b.geofence_id = p_geofence
     AND a.asset_id = b.asset_id AND a.entered_at = b.entered_at AND a.exited_at = b.exited_at
     AND a.id > b.id;

  -- Day-align (usage_daily rows are whole days: ts::date, session tz).
  v_start := p_from::date::timestamptz;

  -- ── Cut straddlers at their last inside fix before the scan start ────────
  FOR r IN
    SELECT id, asset_id, entered_at FROM zone_sessions
    WHERE geofence_id = p_geofence AND entered_at < v_start AND exited_at > v_start
  LOOP
    -- Newest 50 rows first (an ordered index probe the planner cannot turn
    -- into anything else — LIMIT is a barrier), then containment.
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
  WITH win AS (
    SELECT al.asset_id, al."timestamp" AS ts, COALESCE(al.speed, 0) AS speed,
           ST_Contains(v_geom, ST_SetSRID(ST_MakePoint(al.lng, al.lat), 4326)) AS inside,
           FALSE AS seed
    FROM asset_locations al
    WHERE al.company_id = v_company AND al."timestamp" >= v_start AND al."timestamp" < p_to
  ),
  -- Each asset's last fix BEFORE the scan start feeds LAG() only.
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
  -- A cut straddler's continuation may be shorter than 3 minutes on its own:
  -- keep the run that starts at the asset's FIRST window fix when nothing
  -- lies between it and the cut — the merge re-joins it.
  bridge AS (
    SELECT f.asset_id, f.first_ts
    FROM (SELECT p.asset_id, MIN(p.ts) AS first_ts FROM win p GROUP BY p.asset_id) f
    JOIN zone_sessions c ON c.id = ANY(v_ids) AND c.asset_id = f.asset_id
    WHERE NOT EXISTS (
      SELECT 1 FROM asset_locations al
      WHERE al.asset_id = f.asset_id AND al."timestamp" > c.exited_at AND al."timestamp" < f.first_ts)
  ),
  sess AS (
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

  -- ── Re-join GPS straddlers (before pass 2: tool intervals see whole carrier sessions)
  PERFORM zone_usage_merge_cuts(p_geofence, v_start, p_to, v_ids);

  -- ── Pass 2: TOOL PRESENCE (057 math, window only) ────────────────────────
  WITH tool_iv AS (
    SELECT pl.member_asset_id AS asset_id,
           GREATEST(pl.started_at, s.entered_at, v_start) AS s_at,
           -- Presence ends where the tool's OWN fixes begin (TAT141 upgrade):
           -- from then on pass 1 is the truth, never both.
           LEAST(COALESCE(pl.ended_at, pl.last_seen), s.exited_at, p_to,
                 COALESCE((SELECT min(al."timestamp") FROM asset_locations al
                           WHERE al.asset_id = pl.member_asset_id), 'infinity'::timestamptz)) AS e_at
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
        OR (MIN(i.s_at) = v_start AND EXISTS (
              SELECT 1 FROM zone_sessions c WHERE c.id = ANY(v_ids) AND c.asset_id = i.asset_id))
  )
  INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
  SELECT v_company, p_geofence, asset_id, entered_at, exited_at FROM merged;

  -- ── Re-join tool straddlers ──────────────────────────────────────────────
  PERFORM zone_usage_merge_cuts(p_geofence, v_start, p_to, v_ids);

  -- ── on_site_secs for every day the window touches, from the FINAL sessions
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
-- asset. A GPS cut sits on a real fix: it re-joins when the asset's next
-- fix IS that session's start (nothing strictly between). An edge cut (tool
-- presence, no fixes of its own) re-joins only a continuation that starts
-- exactly at the edge. A row that already re-joined has exited_at past the
-- scan start and is skipped, so calling this twice is safe.
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
      AND (
        n.entered_at = s.exited_at
        OR (
          EXISTS (SELECT 1 FROM asset_locations al
                  WHERE al.asset_id = s.asset_id AND al."timestamp" = s.exited_at)
          AND NOT EXISTS (SELECT 1 FROM asset_locations al
                          WHERE al.asset_id = s.asset_id
                            AND al."timestamp" > s.exited_at AND al."timestamp" < n.entered_at)
        )
      )
  LOOP
    UPDATE zone_sessions SET exited_at = r.new_exit WHERE id = r.old_id;
    DELETE FROM zone_sessions WHERE id = r.new_id;
  END LOOP;
END $$;

-- Replay every billing zone (site/yard). Late-data widening: rows that
-- ARRIVED since the last run but carry timestamps older than the window
-- pull the window back to the oldest of them (≤ 30 days).
CREATE OR REPLACE FUNCTION rebuild_all_usage(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  z RECORD;
  v_since TIMESTAMPTZ;
  v_late TIMESTAMPTZ;
BEGIN
  -- "Since" is the END of the last window this ran for (p_to, which every
  -- caller passes as now — the cron, the deploy heals, the harness's
  -- simulated clock alike); the 5-minute overlap covers clock skew between
  -- the caller's now and the rows' arrival stamps.
  SELECT since INTO v_since FROM ledger_recent_state WHERE id;
  v_since := GREATEST(COALESCE(v_since, p_to - INTERVAL '7 days'), p_to - INTERVAL '7 days')
             - INTERVAL '5 minutes';
  -- OFFSET 0 keeps the timestamp test out of the scan, so the arrival
  -- index (created_at, 049) is the only way in — never the whole table.
  SELECT min(x.ts) INTO v_late
  FROM (SELECT al."timestamp" AS ts FROM asset_locations al WHERE al.created_at >= v_since OFFSET 0) x
  WHERE x.ts < p_from;
  IF v_late IS NOT NULL THEN
    p_from := GREATEST(v_late, p_to - INTERVAL '30 days');
  END IF;

  FOR z IN SELECT id FROM geofences WHERE COALESCE(kind, 'site') IN ('site', 'yard') LOOP
    PERFORM rebuild_zone_usage(z.id, p_from, p_to);
  END LOOP;

  INSERT INTO ledger_recent_state (id, since) VALUES (TRUE, p_to)
  ON CONFLICT (id) DO UPDATE SET since = GREATEST(ledger_recent_state.since, EXCLUDED.since), updated_at = now();
END $$;

REVOKE ALL ON FUNCTION rebuild_zone_usage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION zone_usage_merge_cuts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rebuild_all_usage(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
