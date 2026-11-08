-- 148 — Borings and test pits: the ground under the site (Plans & Takeoff
-- phase 4; the plan doc's "Borings and test pits").
--
-- One row per boring or test pit: where it is, the ground elevation its log
-- prints (when it does), how deep it went, and what it found — topsoil (in),
-- existing fill and unsuitable soil (each "down to N ft"), the depths to
-- partially weathered rock and auger refusal (rock), water at drilling and
-- after 24 hours. lib/borings/layers.ts spreads them across the site (depths
-- as depths, rock / PWR / water by ELEVATION, the nearest boring's value
-- beyond them) and the dirt takeoff measures the rock, the PWR, the undercut
-- and the unexplored ground in its cut (lib/borings/ground.ts).
--
-- "No rock found" is stored as NULL refusal with the depth the boring
-- reached: it means "soil down to this depth", never "rock-free" — the cut
-- below it is counted as unexplored.
--
-- Reads: the company, a personal zone's borings its owner's only (the 144
-- rule); not for prospects (bid data). Writes: server actions on the service
-- role after the edit + plans checks. A test pit's photo lives in the private
-- 'plans' bucket at <company>/pits/<id>.

CREATE TABLE IF NOT EXISTS public.borings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id    UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  kind           TEXT NOT NULL DEFAULT 'boring' CHECK (kind IN ('boring', 'pit')),
  lat            DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng            DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  ground_ft      REAL CHECK (ground_ft IS NULL OR ground_ft BETWEEN -500 AND 20000),
  depth_ft       REAL NOT NULL CHECK (depth_ft > 0 AND depth_ft <= 500),
  topsoil_in     REAL CHECK (topsoil_in IS NULL OR topsoil_in BETWEEN 0 AND 120),
  fill_ft        REAL CHECK (fill_ft IS NULL OR fill_ft BETWEEN 0 AND 200),
  pwr_ft         REAL CHECK (pwr_ft IS NULL OR (pwr_ft >= 0 AND pwr_ft <= depth_ft)),
  refusal_ft     REAL CHECK (refusal_ft IS NULL OR (refusal_ft >= 0 AND refusal_ft <= depth_ft)),
  water_ft       REAL CHECK (water_ft IS NULL OR (water_ft >= 0 AND water_ft <= depth_ft)),
  water_24h_ft   REAL CHECK (water_24h_ft IS NULL OR (water_24h_ft >= 0 AND water_24h_ft <= 500)),
  unsuitable_ft  REAL CHECK (unsuitable_ft IS NULL OR unsuitable_ft BETWEEN 0 AND 100),
  -- PWR sits above refusal (refusal ends the boring).
  CHECK (pwr_ft IS NULL OR refusal_ft IS NULL OR pwr_ft <= refusal_ft),
  source         TEXT NOT NULL DEFAULT 'log' CHECK (source IN ('log', 'sheet', 'pit', 'map')),
  source_ref     TEXT CHECK (source_ref IS NULL OR char_length(source_ref) <= 120),
  note           TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  photo_path     TEXT CHECK (photo_path IS NULL OR photo_path ~ '^[0-9a-f-]{36}/pits/[0-9a-f-]{36}$'),
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS borings_zone_idx ON public.borings (geofence_id) WHERE deleted_at IS NULL;
-- One live name per site (B-1 is B-1).
CREATE UNIQUE INDEX IF NOT EXISTS borings_name_uq ON public.borings (geofence_id, lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE public.borings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company borings read" ON public.borings;
CREATE POLICY "company borings read" ON public.borings
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = borings.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE ALL ON public.borings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.borings FROM authenticated;
GRANT SELECT ON public.borings TO authenticated;
SELECT ht_prospect_lockdown('borings', false);

NOTIFY pgrst, 'reload schema';
