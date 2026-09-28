-- 125 — retention for the GPS spikes the ingest turns away (124).
--
-- asset_location_rejects kept every rejected fix forever: rows only left
-- when their asset was hard-deleted (sec-check, Sep 28). A reject is
-- evidence for a while — "where did the dump trailer's Gulf fix come from"
-- — and noise after that. purge_retention (the health cron's daily call,
-- keep_days 30) now also clears rejects older than keep_days × 3 = 90 days,
-- the same horizon tracker_moves keeps. Same signature and return shape as
-- 095, so the cron call is unchanged.
--
-- asset_fix_tail needs no purge: one row per asset at most (primary key),
-- gone with the asset, and cleared on every tracker change (forgetReadings).
CREATE OR REPLACE FUNCTION purge_retention(keep_days INT DEFAULT 30)
RETURNS TABLE (deleted_assets INT, buffered_pings INT, old_moves INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a INT := 0; b INT; m INT; n INT;
  v_id UUID;
BEGIN
  IF keep_days < 30 THEN
    RAISE EXCEPTION 'purge_retention: keep_days must be >= 30 (got %)', keep_days;
  END IF;

  FOR v_id IN
    SELECT id FROM assets
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => keep_days)
     ORDER BY deleted_at
     LIMIT 5
  LOOP
    LOOP
      DELETE FROM asset_locations
       WHERE id IN (SELECT id FROM asset_locations WHERE asset_id = v_id LIMIT 5000);
      GET DIAGNOSTICS n = ROW_COUNT;
      EXIT WHEN n = 0;
    END LOOP;
    DELETE FROM trail_daily WHERE asset_id = v_id;
    DELETE FROM assets WHERE id = v_id;
    a := a + 1;
  END LOOP;

  DELETE FROM unassigned_locations
   WHERE created_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS b = ROW_COUNT;

  DELETE FROM tracker_moves
   WHERE created_at < now() - make_interval(days => keep_days * 3);
  GET DIAGNOSTICS m = ROW_COUNT;

  DELETE FROM asset_location_rejects
   WHERE created_at < now() - make_interval(days => keep_days * 3);

  RETURN QUERY SELECT a, b, m;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_retention(INT) FROM PUBLIC, anon, authenticated;
