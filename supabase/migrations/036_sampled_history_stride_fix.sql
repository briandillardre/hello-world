-- Fix: sampled_history returned ZERO rows whenever the window held <= p_max
-- rows, because a stride of 1 made `rn % 1 = 1` unsatisfiable (n % 1 is
-- always 0). `(rn - 1) % stride = 0` keeps every row at stride 1 and rows
-- 1, 1+s, 1+2s… at larger strides — the backfill now actually backfills.
-- (Found in the Jul 17 code review before any fleet outgrew the cap.)

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
  WHERE (w.rn - 1) % GREATEST(1, CEIL(w.total::numeric / GREATEST(1, p_max))::int) = 0
  ORDER BY w."timestamp"
$$;
