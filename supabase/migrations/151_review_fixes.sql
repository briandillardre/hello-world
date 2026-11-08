-- 151 — From the Nov 8 sec-check over the Plans & Takeoff phases (#233–#238).
--
-- 1. A company site is deleted by a Manager or above (a personal zone by its
--    owner). 027's FOR ALL policy let any member — an Associate's session
--    straight through PostgREST included — delete a site, and the cascade
--    takes its plan room, takeoff, estimate, borings, machine files and drone
--    progress with it; the health sweeps then remove the files as orphans.
--    lib/actions/zones.ts checks the same rank and says so.
-- 2. A site that holds plans or bid data can't be made personal. Every read
--    policy since 144 is "owner_id IS NULL OR owner_id = auth.uid()", so a
--    flip hid all of it from everyone else — the Master included.
-- 3. 146 left TRUNCATE (and TRIGGER, REFERENCES) granted on its tables.
-- 4. Margins need the costs ability as well as the Admin rank, and an
--    estimate's markups follow its site's personal-zone rule.

DROP POLICY IF EXISTS "zone delete is a manager's" ON public.geofences;
CREATE POLICY "zone delete is a manager's" ON public.geofences
  AS RESTRICTIVE FOR DELETE
  USING (ht_viewer_rank() >= 2 OR owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ht_geofence_keep_shared() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.owner_id IS NULL AND NEW.owner_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.plan_sets x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.takeoff_snapshots x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.bid_memos x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.estimates x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.borings x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.machine_files x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.dirt_takeoffs x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.zone_imagery x WHERE x.geofence_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'This site holds plans or bid data, so it stays a company site.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ht_geofence_keep_shared() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS geofences_keep_shared ON public.geofences;
CREATE TRIGGER geofences_keep_shared BEFORE UPDATE OF owner_id ON public.geofences
  FOR EACH ROW EXECUTE FUNCTION public.ht_geofence_keep_shared();

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.takeoff_items, public.plan_marks,
  public.takeoff_snapshots, public.bid_memos FROM authenticated;

DROP POLICY IF EXISTS "admins read" ON public.cost_markup_defaults;
CREATE POLICY "admins read" ON public.cost_markup_defaults
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_rank() >= 3 AND ht_viewer_can_costs());

DROP POLICY IF EXISTS "admins read" ON public.estimate_markups;
CREATE POLICY "admins read" ON public.estimate_markups
  FOR SELECT USING (
    company_id = current_company_id() AND ht_viewer_rank() >= 3 AND ht_viewer_can_costs()
    AND EXISTS (SELECT 1 FROM public.estimates e JOIN public.geofences g ON g.id = e.geofence_id
                WHERE e.id = estimate_markups.estimate_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

NOTIFY pgrst, 'reload schema';
