-- 153 — The project hub's punch list and milestones are written by the server
-- only (the 138 / 145 pattern).
--
-- 046 gave both tables a company FOR ALL policy, so any member's session —
-- an Associate's included, who the app never lets edit — could insert,
-- retitle, close or delete punch items and milestones straight through
-- PostgREST. lib/actions/projects.ts now writes on the service role after the
-- edit check, with the zone and the assignee checked as the caller's
-- company's (live since #239); this takes the member writes away (board #224).
-- Reads are unchanged.

DROP POLICY IF EXISTS "company project tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "company project tasks read" ON public.project_tasks;
CREATE POLICY "company project tasks read" ON public.project_tasks
  FOR SELECT USING (company_id = current_company_id());

DROP POLICY IF EXISTS "company project milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "company project milestones read" ON public.project_milestones;
CREATE POLICY "company project milestones read" ON public.project_milestones
  FOR SELECT USING (company_id = current_company_id());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_tasks FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_milestones FROM authenticated, anon;
GRANT SELECT ON public.project_tasks TO authenticated;
GRANT SELECT ON public.project_milestones TO authenticated;

NOTIFY pgrst, 'reload schema';
