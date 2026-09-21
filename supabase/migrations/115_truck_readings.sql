-- 115 — Truck readings (Brian, Sep 21: "make sure every data point that is
-- being sent is captured … dials on the asset pop-up and the asset page …
-- a master list of what the OBD device CAN do, then what each truck sends").
--
-- Every fix already keeps the tracker's whole parameter bag in
-- asset_locations.raw (since Jul 7). What was missing is a cheap way to
-- answer "what does THIS truck report, and what did it last say" without
-- scanning a week of rows: ONE row per asset here, `readings` =
-- { "<flespi key>": { v, t, n, since } } — newest value, when, how many
-- reports carried it, first seen. Ingest folds each webhook batch and calls
-- telemetry_merge; lib/telemetry-catalog.ts turns the keys into contractor
-- words (RPM, coolant °F, truck battery V, check-engine codes…).
--
-- Reads: the company's members, under the same per-asset visibility ladder
-- as asset_locations (111 — a hidden truck's readings are hidden with it).
-- Writes: service role only. telemetry_daily reads the raw history for the
-- asset page's 7-day trend under the CALLER's row-level security.
--
-- Frozen once pushed (CLAUDE.md) — fix-ups go in a new file.

CREATE TABLE IF NOT EXISTS public.asset_telemetry_latest (
  asset_id   UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  readings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_telemetry_latest_company_idx
  ON public.asset_telemetry_latest (company_id);

ALTER TABLE public.asset_telemetry_latest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company reads truck readings" ON public.asset_telemetry_latest;
CREATE POLICY "company reads truck readings" ON public.asset_telemetry_latest
  FOR SELECT USING (company_id = current_company_id());

-- Same shape 111 gave every asset-keyed table: the EXISTS runs against assets
-- under the caller's own RLS, so the ladder is decided in exactly one place.
DROP POLICY IF EXISTS "follows asset visibility" ON public.asset_telemetry_latest;
CREATE POLICY "follows asset visibility" ON public.asset_telemetry_latest AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = asset_telemetry_latest.asset_id));

-- ── Merge one batch's readings into the asset's row ─────────────────────────
-- p_new = { key: { v, t, n, since } } (lib/telemetry-catalog foldReadings).
-- Newer `t` wins the value, counts add, `since` keeps the earliest. Service
-- role only: ingest is the one writer.
CREATE OR REPLACE FUNCTION public.telemetry_merge(p_asset UUID, p_company UUID, p_new JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cur    JSONB;
  merged JSONB;
BEGIN
  IF p_new IS NULL OR jsonb_typeof(p_new) <> 'object' THEN
    RETURN;
  END IF;
  SELECT readings INTO cur FROM public.asset_telemetry_latest WHERE asset_id = p_asset FOR UPDATE;
  IF cur IS NULL THEN cur := '{}'::jsonb; END IF;

  SELECT coalesce(jsonb_object_agg(s.k, s.val), '{}'::jsonb) INTO merged
  FROM (
    SELECT keys.k,
      CASE
        WHEN o.value IS NULL THEN n.value
        WHEN n.value IS NULL THEN o.value
        WHEN jsonb_typeof(o.value) <> 'object' OR jsonb_typeof(n.value) <> 'object' THEN n.value
        ELSE jsonb_build_object(
          'v', CASE WHEN (n.value->>'t')::timestamptz >= (o.value->>'t')::timestamptz THEN n.value->'v' ELSE o.value->'v' END,
          't', CASE WHEN (n.value->>'t')::timestamptz >= (o.value->>'t')::timestamptz THEN n.value->'t' ELSE o.value->'t' END,
          'n', coalesce((o.value->>'n')::bigint, 1) + coalesce((n.value->>'n')::bigint, 1),
          'since', to_jsonb(to_char(
            least(coalesce((o.value->>'since')::timestamptz, (o.value->>'t')::timestamptz),
                  coalesce((n.value->>'since')::timestamptz, (n.value->>'t')::timestamptz)) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      END AS val
    FROM (
      SELECT DISTINCT u.key AS k
      FROM (SELECT jsonb_object_keys(cur) AS key UNION ALL SELECT jsonb_object_keys(p_new)) u
    ) keys
    LEFT JOIN jsonb_each(cur)   o ON o.key = keys.k
    LEFT JOIN jsonb_each(p_new) n ON n.key = keys.k
  ) s;

  INSERT INTO public.asset_telemetry_latest (asset_id, company_id, readings, updated_at)
  VALUES (p_asset, p_company, merged, now())
  ON CONFLICT (asset_id) DO UPDATE
    SET readings = EXCLUDED.readings, company_id = EXCLUDED.company_id, updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) FROM public;
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) FROM anon, authenticated;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE '115: telemetry_merge grants left as-is (%)', SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) TO service_role;

-- ── A time zone that is guaranteed to parse ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.ht_safe_tz(p_tz TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM now() AT TIME ZONE p_tz;
  RETURN p_tz;
EXCEPTION WHEN OTHERS THEN
  RETURN 'America/New_York';
END $$;

-- ── Per-day min / max / avg of numeric readings, for the trend strip ────────
-- Runs under the caller's RLS (asset_locations already carries the company +
-- visibility policies). Bounded: ≤ 31 days, ≤ 12 keys, one asset.
CREATE OR REPLACE FUNCTION public.telemetry_daily(p_asset UUID, p_keys TEXT[], p_days INT DEFAULT 7, p_tz TEXT DEFAULT 'America/New_York')
RETURNS TABLE (day DATE, key TEXT, n INT, vmin DOUBLE PRECISION, vmax DOUBLE PRECISION, vavg DOUBLE PRECISION, vlast DOUBLE PRECISION, last_ts TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH params AS (
    SELECT least(greatest(coalesce(p_days, 7), 1), 31) AS days,
           public.ht_safe_tz(coalesce(p_tz, 'America/New_York')) AS tz,
           (SELECT array_agg(u.k)
              FROM unnest(coalesce(p_keys, ARRAY[]::text[])) WITH ORDINALITY AS u(k, i)
             WHERE u.i <= 12 AND u.k ~ '^[A-Za-z0-9_.-]{1,64}$') AS keys
  ),
  fixes AS (
    SELECT al."timestamp" AS ts, al.raw
    FROM public.asset_locations al, params p
    WHERE al.asset_id = p_asset
      AND al."timestamp" >= now() - make_interval(days => p.days)
      AND al.raw IS NOT NULL
  )
  SELECT (f.ts AT TIME ZONE p.tz)::date            AS day,
         k.key                                      AS key,
         count(*)::int                              AS n,
         min(v.val)                                 AS vmin,
         max(v.val)                                 AS vmax,
         avg(v.val)                                 AS vavg,
         (array_agg(v.val ORDER BY f.ts DESC))[1]   AS vlast,
         max(f.ts)                                  AS last_ts
  FROM fixes f
  CROSS JOIN params p
  CROSS JOIN LATERAL unnest(p.keys) AS k(key)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(f.raw -> k.key) = 'number' THEN (f.raw ->> k.key)::double precision END AS val
  ) v
  WHERE v.val IS NOT NULL
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION public.telemetry_daily(UUID, TEXT[], INT, TEXT) TO authenticated, service_role;

-- ── Seed: what every active asset has said lately ───────────────────────────
-- Bounded to the newest 400 fixes per asset (a few seconds of work); ingest
-- keeps it current from here. `since` is "since at least" — the window's
-- oldest row, not the tracker's first day.
INSERT INTO public.asset_telemetry_latest (asset_id, company_id, readings, updated_at)
SELECT a.id, a.company_id, r.readings, now()
FROM public.assets a
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(s.key, jsonb_build_object('v', s.v, 't', s.t, 'n', s.n, 'since', s.since)) AS readings
  FROM (
    SELECT e.key,
           (array_agg(e.value ORDER BY w.ts DESC))[1] AS v,
           to_char(max(w.ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t,
           count(*) AS n,
           to_char(min(w.ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS since
    FROM (
      SELECT al."timestamp" AS ts, al.raw
      FROM public.asset_locations al
      WHERE al.asset_id = a.id AND al.raw IS NOT NULL
      ORDER BY al."timestamp" DESC
      LIMIT 400
    ) w
    CROSS JOIN LATERAL jsonb_each(w.raw) e
    WHERE e.key NOT IN ('ident', 'device.id', 'timestamp', 'position.latitude', 'position.longitude', 'position.speed', 'position.direction', 'position.altitude', 'ble.beacons')
      AND jsonb_typeof(e.value) IN ('number', 'string', 'boolean')
    GROUP BY e.key
  ) s
) r
WHERE a.active AND r.readings IS NOT NULL
ON CONFLICT (asset_id) DO NOTHING;
