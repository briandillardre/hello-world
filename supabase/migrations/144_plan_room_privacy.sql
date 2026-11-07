-- 144 — Plan room privacy (the Nov 7 sec-check on 143).
--
-- 1. A plan room follows its zone: a PERSONAL zone's sets, files, sheets and
--    versions are readable only by the zone's owner (the 137 shape — the
--    dirt and site takeoffs already refuse personal zones). Before this any
--    member, and a prospect, could list a personal zone's plan files and ask
--    for a signed link to the PDF.
-- 2. The private 'plans' bucket takes the sheets' PICTURES too: a new upload
--    files its picture there and the map reads it through
--    /api/plans/image/<id> (a short signed link after an RLS read), never a
--    public URL that works forever once forwarded.
--
-- Read policies only: nothing that writes is touched, so this is safe ahead
-- of the code that uses it.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
WHERE id = 'plans';

DROP POLICY IF EXISTS "company plan sets read" ON public.plan_sets;
CREATE POLICY "company plan sets read" ON public.plan_sets
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = plan_sets.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

DROP POLICY IF EXISTS "company plan files read" ON public.plan_files;
CREATE POLICY "company plan files read" ON public.plan_files
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = plan_files.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

DROP POLICY IF EXISTS "company plan sheets read" ON public.plan_sheets;
CREATE POLICY "company plan sheets read" ON public.plan_sheets
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = plan_sheets.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

DROP POLICY IF EXISTS "company plan versions read" ON public.plan_versions;
CREATE POLICY "company plan versions read" ON public.plan_versions
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.plan_sheets s JOIN public.geofences g ON g.id = s.geofence_id
                WHERE s.id = plan_versions.sheet_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

NOTIFY pgrst, 'reload schema';
