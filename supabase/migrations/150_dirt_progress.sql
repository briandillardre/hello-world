-- 150 — Progress by drone flight (Plans & Takeoff phase 5; the plan doc's
-- "drone flights on the timeline").
--
-- One row per (takeoff, flight): the site's dirt takeoff design run against a
-- drone survey (dirt_surfaces, 136) as the existing ground on the day it was
-- flown — the cut and fill left to move, how much of the design is done, how
-- the flight was levelled (lib/dirt/progress.ts), and the cut / fill-to-grade
-- picture for that day (private 'dirt' bucket at
-- <company>/<takeoff>/progress-<flight>-<ms>.png, read through signed links).
--
-- Reads: the company, a personal zone's rows its owner's only (the 144 rule);
-- never a prospect's. Writes: server actions on the service role.

CREATE TABLE IF NOT EXISTS public.dirt_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  takeoff_id   UUID NOT NULL REFERENCES dirt_takeoffs(id) ON DELETE CASCADE,
  surface_id   UUID NOT NULL REFERENCES dirt_surfaces(id) ON DELETE CASCADE,
  flown_on     DATE NOT NULL,
  results      JSONB NOT NULL,
  heat_path    TEXT CHECK (heat_path IS NULL OR heat_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/progress-[0-9a-f-]{36}-[0-9]+\.png$'),
  heat_corners JSONB,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS dirt_progress_one ON public.dirt_progress (takeoff_id, surface_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dirt_progress_zone_idx ON public.dirt_progress (geofence_id, flown_on DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.dirt_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company dirt progress read" ON public.dirt_progress;
CREATE POLICY "company dirt progress read" ON public.dirt_progress
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = dirt_progress.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE ALL ON public.dirt_progress FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dirt_progress FROM authenticated;
GRANT SELECT ON public.dirt_progress TO authenticated;
SELECT ht_prospect_lockdown('dirt_progress', false);

NOTIFY pgrst, 'reload schema';
