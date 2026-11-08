-- 157 — The review pass on the job flow (#240–#244).
--
-- 1. A SITE THAT HOLDS A JOB CAN'T BE DELETED. jobs.geofence_id cascades, and
--    every job table cascades from jobs — so deleting the site (a Manager's,
--    from the zones list, the map's zone editor, or straight through
--    PostgREST) silently destroyed the job's sent pay applications, approved
--    change orders, budget, costs, issues and documents, and health step 13
--    then swept the document files (storage objects aren't in the database
--    backups). Everywhere else the rule is void, never delete. A whole
--    company's teardown still cascades (the company row is gone first).
--
-- 2. A PERSONAL ZONE'S PUNCH LIST AND MILESTONES ARE ITS OWNER'S (153 kept
--    046's company-wide reads; a personal zone's plan data is already
--    owner-only). lib/actions/projects.ts refuses someone else's personal
--    zone on every write since the same commit. Also takes TRIGGER and
--    REFERENCES off both tables (151 did the same elsewhere).

CREATE OR REPLACE FUNCTION public.ht_geofence_keep_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.jobs WHERE geofence_id = OLD.id)
     AND EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RAISE EXCEPTION 'This site holds a job on the project log — close the job instead of deleting the site.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.ht_geofence_keep_job() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS geofences_keep_job ON public.geofences;
CREATE TRIGGER geofences_keep_job BEFORE DELETE ON public.geofences
  FOR EACH ROW EXECUTE FUNCTION public.ht_geofence_keep_job();

DROP POLICY IF EXISTS "company project tasks read" ON public.project_tasks;
CREATE POLICY "company project tasks read" ON public.project_tasks
  FOR SELECT USING (
    company_id = current_company_id()
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = project_tasks.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

DROP POLICY IF EXISTS "company project milestones read" ON public.project_milestones;
CREATE POLICY "company project milestones read" ON public.project_milestones
  FOR SELECT USING (
    company_id = current_company_id()
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = project_milestones.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE TRIGGER, REFERENCES ON public.project_tasks, public.project_milestones FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
