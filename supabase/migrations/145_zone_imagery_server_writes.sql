-- 145 — Site pictures are written by the server only (sec-check Nov 7, P1).
--
-- 052's "company zone imagery" policy was FOR ALL: any member's session could
-- insert, re-place, re-point or delete any of the company's site pictures —
-- drone shots, satellite frames and plan sheets alike — straight through
-- PostgREST, with a url pointing anywhere. Since #232 every write runs on the
-- service role after the action's own checks (lib/actions/imagery.ts,
-- lib/actions/plans.ts, the satellite cron), so a member keeps READ only.
--
-- The read follows the zone: a personal zone's pictures are its owner's —
-- the geofences rule, and 144's for the plan room.

DROP POLICY IF EXISTS "company zone imagery" ON public.zone_imagery;
DROP POLICY IF EXISTS "company zone imagery read" ON public.zone_imagery;
CREATE POLICY "company zone imagery read" ON public.zone_imagery
  FOR SELECT USING (
    company_id = current_company_id()
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = zone_imagery.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.zone_imagery FROM anon, authenticated;
REVOKE ALL ON public.zone_imagery FROM anon;

-- A picture's address is a storage URL or one of our own routes (every row
-- on the database matched at the time of writing).
ALTER TABLE public.zone_imagery DROP CONSTRAINT IF EXISTS zone_imagery_url_shape;
ALTER TABLE public.zone_imagery ADD CONSTRAINT zone_imagery_url_shape
  CHECK (length(url) <= 2048 AND url ~ '^(https://|/api/)') NOT VALID;
ALTER TABLE public.zone_imagery VALIDATE CONSTRAINT zone_imagery_url_shape;

NOTIFY pgrst, 'reload schema';
