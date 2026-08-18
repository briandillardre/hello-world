-- 064: measurements UPDATE policy — 032 defined select/insert/delete only,
-- so every update failed closed and the map's tap-to-edit couldn't save.
-- Company members may edit shared measurements; personal ones only their
-- owner. WITH CHECK stops re-pointing company_id/owner_id on the way in.
DROP POLICY IF EXISTS "update measurements" ON measurements;
CREATE POLICY "update measurements" ON measurements
  FOR UPDATE USING (
    company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid())
  ) WITH CHECK (
    company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid())
  );
