-- 158 — Sheets that put themselves on the map (Brian, Nov 9: "I also thought
-- we were going to try to get these on the aerial automatically … Buildings,
-- property lines … zoomed out plan sets with zoomed in areas … need to be
-- accurate to each other").
--
-- 1. plan_versions.features — the page's corners (where two drawn lines meet:
--    building corners, property-line angle points, curb returns), read off the
--    PDF's linework on the device at upload (lib/plans/match.ts). Kept so the
--    server can match a sheet to the ground and to the set's other sheets
--    after the upload, PDF or not. Compact: flat numbers, ~15 KB a sheet.
--
-- 2. plan_links — how one sheet's page sits on another's (an overall plan and
--    its enlarged quadrant, two road sheets meeting at a matchline): a
--    similarity a-page → b-page measured from the corners they share. Once
--    either is placed, the other follows exactly (lib/actions/plans.ts).
--    Written only by the service role; read follows the versions' own policy
--    (a personal zone's links are its owner's).

ALTER TABLE public.plan_versions ADD COLUMN IF NOT EXISTS features JSONB;
ALTER TABLE public.plan_versions DROP CONSTRAINT IF EXISTS plan_versions_features_size;
ALTER TABLE public.plan_versions ADD CONSTRAINT plan_versions_features_size
  CHECK (features IS NULL OR octet_length(features::text) < 200000);

CREATE TABLE IF NOT EXISTS public.plan_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  a_version   UUID NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
  b_version   UUID NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
  -- b = s · R(th) · a + (tx, ty), page points (y up)
  s           DOUBLE PRECISION NOT NULL CHECK (s > 0 AND s < 100),
  th          DOUBLE PRECISION NOT NULL,
  tx          DOUBLE PRECISION NOT NULL,
  ty          DOUBLE PRECISION NOT NULL,
  n           INT NOT NULL CHECK (n >= 0),
  rms_ft      REAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (a_version <> b_version),
  UNIQUE (a_version, b_version)
);
CREATE INDEX IF NOT EXISTS plan_links_b_idx ON public.plan_links (b_version);
CREATE INDEX IF NOT EXISTS plan_links_company_idx ON public.plan_links (company_id);

ALTER TABLE public.plan_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company plan links read" ON public.plan_links;
CREATE POLICY "company plan links read" ON public.plan_links
  FOR SELECT USING (
    company_id = current_company_id()
    AND EXISTS (SELECT 1 FROM public.plan_versions v WHERE v.id = plan_links.a_version)
    AND EXISTS (SELECT 1 FROM public.plan_versions v WHERE v.id = plan_links.b_version));

REVOKE ALL ON public.plan_links FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.plan_links FROM authenticated;
GRANT SELECT ON public.plan_links TO authenticated;
SELECT ht_prospect_lockdown('plan_links', false);

NOTIFY pgrst, 'reload schema';
