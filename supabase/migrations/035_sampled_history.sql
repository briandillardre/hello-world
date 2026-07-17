-- Even-coverage history sampling for long timeline windows (30d / YTD / All).
--
-- The /api/history fetch pages NEWEST-first up to a hard cap, and the shipped
-- map snapshot is also newest-biased — so once the fleet out-produces the cap,
-- any trip older than the cap horizon simply vanished from long ranges while
-- rendering fine on 7d (the Chesterfield run, Jul 17). This function returns
-- ONE uniform stride across the requested window in a single query, so every
-- day is represented no matter how much data the window holds.
--
-- SECURITY INVOKER: RLS on asset_locations still applies (company scoping),
-- so this is safe to expose through PostgREST rpc.
-- rn is partitioned per asset but the stride divisor is global (total/p_max):
-- every asset's trail thins by the SAME factor, keeping proportional coverage.

CREATE OR REPLACE FUNCTION sampled_history(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ,
  p_max  INTEGER
) RETURNS TABLE (
  asset_id UUID,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  speed REAL,
  "timestamp" TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH win AS (
    SELECT al.asset_id, al.lat, al.lng, al.speed, al."timestamp",
           row_number() OVER (PARTITION BY al.asset_id ORDER BY al."timestamp") AS rn,
           count(*) OVER () AS total
    FROM asset_locations al
    WHERE al."timestamp" >= p_from AND al."timestamp" < p_to
  )
  SELECT w.asset_id, w.lat, w.lng, w.speed, w."timestamp"
  FROM win w
  WHERE w.rn % GREATEST(1, CEIL(w.total::numeric / GREATEST(1, p_max))::int) = 1
  ORDER BY w."timestamp"
$$;
