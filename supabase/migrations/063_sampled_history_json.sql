-- 063: cap-immune sampled history.
--
-- PostgREST's API "Max Rows" setting silently LIMITed the sampled_history
-- (039) row set to ~1000 rows — and the function orders ASC, so wide
-- timeline ranges kept the OLDEST 1000 rows of the window and lost today's
-- tracks entirely ("7 day / 30 day / ytd not showing Bryson's track from
-- today", Aug 12). Today/Yesterday escaped only because their window IS the
-- day. A single jsonb value is not a row set, so the cap can't touch it.
CREATE OR REPLACE FUNCTION sampled_history_json(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_max INTEGER
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."timestamp"), '[]'::jsonb)
  FROM sampled_history(p_from, p_to, p_max) s
$$;
