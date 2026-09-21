-- 117 — Truck readings hardening (sec-check + ship-check on 115, Sep 21 2026)
--
-- Three things the reviewers proved against the real function:
--   1. A reading whose `t` is not a time (an epoch number, "not-a-date") was
--      stored verbatim the first time a key appeared, and every later merge
--      for that key died on the timestamptz cast — for good. Now: a `t` that
--      does not parse never gets in, and one already stored is dropped on
--      the next merge (self-heal), plus one bounded pass here.
--   2. Two first batches for a brand-new asset raced: SELECT … FOR UPDATE
--      locks nothing when the row does not exist, so the second INSERT … ON
--      CONFLICT overwrote the first's keys. Now: one advisory lock per asset
--      for the transaction.
--   3. Prototype keys (`__proto__` …) and the seed's `device.name` /
--      `device.type.id` (which the ingest filter never lets through) are
--      refused on both sides, and a batch with more than 500 keys is not a
--      tracker's, so it is ignored whole.
-- Also: `telemetry_daily` and `ht_safe_tz` were executable by anon (grants
-- given, PUBLIC never revoked). RLS returned zero rows either way; this
-- closes the unauthenticated scan trigger.
--
-- 115 is frozen (applied), so the function is replaced here.

-- A timestamp or NULL, never an error — a stored `t` decides nothing until
-- it has passed through here.
CREATE OR REPLACE FUNCTION public.ht_try_ts(p TEXT)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN p::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ht_try_ts(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ht_try_ts(TEXT) TO service_role;

-- One readings object, kept to what a tracker can legitimately have said:
-- a parameter-shaped key, an object value, a `t` that is a time.
CREATE OR REPLACE FUNCTION public.ht_clean_readings(p JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  FROM jsonb_each(coalesce(CASE WHEN jsonb_typeof(p) = 'object' THEN p END, '{}'::jsonb)) e
  WHERE e.key ~ '^[A-Za-z0-9_.-]{1,64}$'
    AND e.key NOT IN ('__proto__', 'constructor', 'prototype', 'device.name', 'device.type.id')
    AND jsonb_typeof(e.value) = 'object'
    AND public.ht_try_ts(e.value ->> 't') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.ht_clean_readings(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ht_clean_readings(JSONB) TO service_role;

-- The count, or NULL — the same tolerance for `n` as for `t`.
CREATE OR REPLACE FUNCTION public.ht_try_count(p TEXT)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{1,15}$' THEN RETURN NULL; END IF;
  RETURN p::bigint;
END $$;
REVOKE ALL ON FUNCTION public.ht_try_count(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ht_try_count(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.telemetry_merge(p_asset UUID, p_company UUID, p_new JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cur    JSONB;
  newc   JSONB;
  merged JSONB;
BEGIN
  IF p_new IS NULL OR jsonb_typeof(p_new) <> 'object' THEN
    RETURN;
  END IF;
  -- A tracker sends a few dozen keys. Thousands is somebody's payload, and
  -- it would sit in this row and tax every later merge.
  IF (SELECT count(*) FROM jsonb_object_keys(p_new)) > 500 THEN
    RETURN;
  END IF;
  newc := public.ht_clean_readings(p_new);
  IF newc = '{}'::jsonb THEN
    RETURN;
  END IF;
  -- One merge per asset at a time, row or no row yet (the first-row race).
  PERFORM pg_advisory_xact_lock(hashtext('telemetry_merge:' || p_asset::text));
  SELECT readings INTO cur FROM public.asset_telemetry_latest WHERE asset_id = p_asset FOR UPDATE;
  cur := public.ht_clean_readings(cur);

  SELECT coalesce(jsonb_object_agg(s.k, s.val), '{}'::jsonb) INTO merged
  FROM (
    SELECT keys.k,
      CASE
        WHEN o.value IS NULL THEN n.value
        WHEN n.value IS NULL THEN o.value
        ELSE jsonb_build_object(
          'v', CASE WHEN public.ht_try_ts(n.value->>'t') >= public.ht_try_ts(o.value->>'t') THEN n.value->'v' ELSE o.value->'v' END,
          't', CASE WHEN public.ht_try_ts(n.value->>'t') >= public.ht_try_ts(o.value->>'t') THEN n.value->'t' ELSE o.value->'t' END,
          'n', coalesce(public.ht_try_count(o.value->>'n'), 1) + coalesce(public.ht_try_count(n.value->>'n'), 1),
          'since', to_jsonb(to_char(
            least(coalesce(public.ht_try_ts(o.value->>'since'), public.ht_try_ts(o.value->>'t')),
                  coalesce(public.ht_try_ts(n.value->>'since'), public.ht_try_ts(n.value->>'t'))) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      END AS val
    FROM (
      SELECT DISTINCT u.key AS k
      FROM (SELECT jsonb_object_keys(cur) AS key UNION ALL SELECT jsonb_object_keys(newc)) u
    ) keys
    LEFT JOIN jsonb_each(cur)  o ON o.key = keys.k
    LEFT JOIN jsonb_each(newc) n ON n.key = keys.k
  ) s;

  INSERT INTO public.asset_telemetry_latest (asset_id, company_id, readings, updated_at)
  VALUES (p_asset, p_company, merged, now())
  ON CONFLICT (asset_id) DO UPDATE
    SET readings = EXCLUDED.readings, company_id = EXCLUDED.company_id, updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) FROM PUBLIC;
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.ht_try_ts(TEXT) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.ht_try_count(TEXT) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.ht_clean_readings(JSONB) FROM anon, authenticated;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE '117: merge helper grants left as-is (%)', SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.telemetry_merge(UUID, UUID, JSONB) TO service_role;

-- ── The trend RPC: signed-in callers only ────────────────────────────────────
REVOKE ALL ON FUNCTION public.telemetry_daily(UUID, TEXT[], INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ht_safe_tz(TEXT) FROM PUBLIC;
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.telemetry_daily(UUID, TEXT[], INT, TEXT) FROM anon;
  REVOKE ALL ON FUNCTION public.ht_safe_tz(TEXT) FROM anon;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE '117: telemetry_daily grants left as-is (%)', SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.telemetry_daily(UUID, TEXT[], INT, TEXT) TO authenticated, service_role;
-- telemetry_daily is SECURITY INVOKER and calls ht_safe_tz, so its callers
-- keep EXECUTE on the helper.
GRANT EXECUTE ON FUNCTION public.ht_safe_tz(TEXT) TO authenticated, service_role;

-- ── One bounded pass over what 115/116 seeded ────────────────────────────────
-- One row per asset, so this is a few dozen rows: drop the keys the ingest
-- filter would refuse and any entry whose `t` is not a time.
UPDATE public.asset_telemetry_latest
   SET readings = public.ht_clean_readings(readings),
       updated_at = now()
 WHERE readings <> public.ht_clean_readings(readings);
