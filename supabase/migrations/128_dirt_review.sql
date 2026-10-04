-- 128 — Dirt takeoffs: the review pass on 127 (Oct 4 2026, sec-check).
--
-- 1. A deleted takeoff is gone for members too. 127's read policy returned
--    soft-deleted rows to anyone calling PostgREST directly (the app filtered
--    them; the API didn't). The health cron purges them after 30 days.
-- 2. company_addons is read only by the service role (lib/db/dirt.ts →
--    dirtAddonActive), so the member read policy goes: it showed the
--    founder's note and the billing source to every crew login.

DROP POLICY IF EXISTS "company dirt takeoffs read" ON public.dirt_takeoffs;
CREATE POLICY "company dirt takeoffs read" ON public.dirt_takeoffs
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "company addons read" ON public.company_addons;

NOTIFY pgrst, 'reload schema';
