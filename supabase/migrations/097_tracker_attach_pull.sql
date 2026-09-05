-- 097: an attach from the drawer brings the box's back-dated pings along.
--
-- Brian, Sep 4 2026 (phone, 10:4x PM): "I have reassigned the tat141 as of
-- yesterday to chevy 2500 but it is not showing correct location."
--
-- What happened: he took TAT141 …5392 OFF the placeholder record "tat141 - 6"
-- into the drawer "as of 9/3 8:00 PM", then put it ON the 2003 Silverado
-- 2500HD "as of" the same time. A detach leaves every ping on the old record
-- by design (the drawer is non-destructive), and an attach only pulled pings
-- from an ACTIVE holder or the drawer buffer — so the day the TAT141 had
-- already spent in the Silverado stayed on "tat141 - 6", which kept sitting
-- on the map at the truck's exact spot with "No tracker assigned".
--
-- Code (lib/db/trackers.ts putOn): from now on an attach also pulls, from the
-- machine the box was last taken off, its pings from the attach's "as of" up
-- to the real pull-off moment (the detach's created_at). Undo returns them.
-- This column records that window so the undo is exact.
ALTER TABLE tracker_moves ADD COLUMN IF NOT EXISTS pulled_since TIMESTAMPTZ;
ALTER TABLE tracker_moves ADD COLUMN IF NOT EXISTS pulled_until TIMESTAMPTZ;

-- One-off repair of the Sep 4 reassignment, expressed as the move the new
-- code would have made: pings on the placeholder from the chosen "as of"
-- (2026-09-03 20:00 EDT) up to the detach moment go to the Silverado, and a
-- tracker_moves row makes it visible + undoable on /trackers. Guarded on the
-- exact state observed (placeholder trackerless, Silverado wearing …5392,
-- same company) so it is a no-op anywhere else and on a fresh database.
DO $$
DECLARE
  v_from  UUID := '0b285248-5c10-45e1-b8ce-ad25680ae30f';  -- "tat141 - 6"
  v_to    UUID := '768f235a-d750-4c6e-8bdb-386c27d9d36f';  -- 2003 Chevrolet Silverado 2500HD
  v_since TIMESTAMPTZ := '2026-09-04 00:00:00+00';          -- 9/3/2026 8:00 PM EDT, Brian's "as of"
  v_company UUID;
  v_imei TEXT;
  v_until TIMESTAMPTZ;
  v_n INT;
BEGIN
  SELECT a_to.company_id, a_to.tracker_id INTO v_company, v_imei
  FROM assets a_to
  JOIN assets a_from ON a_from.id = v_from AND a_from.company_id = a_to.company_id
  WHERE a_to.id = v_to AND a_to.active AND a_to.tracker_id LIKE '%5392' AND a_from.tracker_id IS NULL;
  IF v_company IS NULL THEN
    RAISE NOTICE '097: repair skipped — state differs from Sep 4 (or fresh database)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM tracker_moves WHERE company_id = v_company AND note LIKE 'repair 097%') THEN
    RAISE NOTICE '097: repair already recorded';
    RETURN;
  END IF;
  -- The moment the box actually came off the placeholder.
  SELECT created_at INTO v_until FROM tracker_moves
  WHERE company_id = v_company AND kind = 'detach' AND tracker_id = v_imei AND from_asset_id = v_from AND undone_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  IF v_until IS NULL THEN v_until := now(); END IF;

  UPDATE asset_locations SET asset_id = v_to, created_at = now()
  WHERE asset_id = v_from AND company_id = v_company AND timestamp >= v_since AND timestamp < v_until;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO tracker_moves (company_id, kind, tracker_id, from_asset_id, to_asset_id, swap_at, moved_locations, pulled_since, pulled_until, note)
  VALUES (v_company, 'attach', v_imei, v_from, v_to, v_since, v_n, v_since, v_until,
          'repair 097: pings the placeholder kept after the Sep 4 drawer detach, moved with the tracker');
  RAISE NOTICE '097: moved % pings from tat141 - 6 to the Silverado (% → %)', v_n, v_since, v_until;
END $$;
