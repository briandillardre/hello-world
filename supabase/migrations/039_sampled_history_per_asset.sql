-- sampled_history v3 — PER-ASSET even sampling (+ ignition passthrough).
--
-- v2 computed one stride from count(*) OVER () — the TOTAL row count across
-- every asset — then applied it to each asset's own row_number. A chatty OBD
-- truck therefore set the stride for everything, so a low-frequency asset
-- (an hourly KOMTRAX machine, a BLE tag's carrier) got decimated to a handful
-- of points and its trail effectively vanished on long ranges.
--
-- v3 gives every asset its own slice of the budget and strides within it, so
-- coverage is even ACROSS the window and FAIR across assets. An asset whose
-- row count already fits its slice gets stride 1 = every row, which is what
-- makes short windows full-resolution through the very same function. One
-- code path for every range is the point: Today / 7d / 30d / YTD / All can no
-- longer disagree because they no longer run different code (Jul 30).
--
-- Also returns `ignition` so the idle/engine math survives on long ranges.

DROP FUNCTION IF EXISTS sampled_history(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);

CREATE FUNCTION sampled_history(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ,
  p_max  INTEGER
) RETURNS TABLE (
  asset_id UUID,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  speed REAL,
  ignition BOOLEAN,
  "timestamp" TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH win AS (
    SELECT al.asset_id, al.lat, al.lng, al.speed, al.ignition, al."timestamp",
           row_number() OVER (PARTITION BY al.asset_id ORDER BY al."timestamp") AS rn,
           count(*)     OVER (PARTITION BY al.asset_id)                        AS asset_rows
    FROM asset_locations al
    WHERE al."timestamp" >= p_from AND al."timestamp" < p_to
  ),
  -- Per-asset budget: an equal share of p_max, floored at 500 so a big fleet
  -- never starves any single trail into invisibility.
  budget AS (
    SELECT GREATEST(500, GREATEST(1, p_max) / GREATEST(1, count(DISTINCT asset_id))) AS per_asset
    FROM win
  )
  SELECT w.asset_id, w.lat, w.lng, w.speed, w.ignition, w."timestamp"
  FROM win w CROSS JOIN budget b
  WHERE (w.rn - 1) % GREATEST(1, CEIL(w.asset_rows::numeric / b.per_asset)::int) = 0
     -- Always keep each asset's FIRST and LAST fix in the window, whatever the
     -- stride lands on: the first anchors the trail at the window's start, the
     -- last keeps the trail head at the asset's true latest position.
     OR w.rn = 1 OR w.rn = w.asset_rows
  ORDER BY w."timestamp"
$$;
