-- 095: two follow-ups to 092 from the ship-check pass (Sep 4).
--
-- 1. 001's UNIQUE (company_id, tracker_id) on assets is not partial on
--    active, so a deactivated or soft-deleted asset kept its IMEI locked
--    inside the company — "deactivate to release" only ever worked across
--    companies (084 is partial; this one was not). Replace it with the same
--    shape scoped to ACTIVE rows. softDeleteAsset also clears tracker_id
--    (stashed in metadata.deleted_tracker_id) so the drawer is truthful.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_company_id_tracker_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS assets_company_tracker_active
  ON assets (company_id, tracker_id)
  WHERE tracker_id IS NOT NULL AND active = true;

-- 2. purge_retention deleted whole assets in one statement, and the FK
--    cascade took a machine's entire location history with it — a two-year
--    truck on Micro can blow the statement timeout, and because the function
--    aborts, the same row then blocks all three purges every hour. Now: at
--    most 5 assets per call, their locations removed in bounded chunks
--    FIRST, then the asset rows (the remaining cascades are small tables).
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

  RETURN QUERY SELECT a, b, m;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_retention(INT) FROM PUBLIC, anon, authenticated;
