-- 163 — Site survey (Beta, Nov 19; Brian: "Build the comparison into beta.
-- This needs to be able to be seen on map like everything else … Takeoff
-- changes revisions etc dated versioned … Legends per version, earthwork,
-- assumptions … Drone / lidar overlay for topo map tying in to timeline
-- slider … Asbuilt / subgrade / stone with functionality to export").
--
-- DIRT_TAKEOFF_VERSIONS: a dated, numbered snapshot of a dirt takeoff — the
--   design, the server's numbers, the LEGEND (earthwork + every assumption
--   that made them: existing ground source and datum, shrink, topsoil,
--   sections, pads, the plan sheets and revisions it was traced from) and a
--   copy of its cut/fill picture, so the map's timeline shows the version
--   that stood on the day you scrub to. Version 1, 2, 3 … per takeoff.
-- SURVEY_SHOTS: a set of rover / total-station shots on a site (gutter lip,
--   flowline, back of curb, control points, spots) as [lng, lat, z ft, code].
-- SURVEY_CHECKS: a drone flight's surface checked against a shot set — every
--   shot's difference, the bias and the spread, by code. The map draws the
--   shots coloured by how far the drone was off.
--
-- Members read their company's live rows (prospects nothing, 119); every write
-- is a server action on the service client after the session checks.

CREATE TABLE IF NOT EXISTS public.dirt_takeoff_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  takeoff_id   UUID NOT NULL REFERENCES public.dirt_takeoffs(id) ON DELETE CASCADE,
  geofence_id  UUID REFERENCES public.geofences(id) ON DELETE SET NULL,
  version_no   INTEGER NOT NULL CHECK (version_no BETWEEN 1 AND 10000),
  label        TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  design       JSONB NOT NULL,
  results      JSONB,
  legend       JSONB NOT NULL DEFAULT '{}'::jsonb,
  heat_path    TEXT CHECK (heat_path IS NULL OR heat_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/version-[0-9]+-[0-9]+\.png$'),
  heat_corners JSONB,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT dirt_takeoff_versions_size CHECK (pg_column_size(design) < 3000000),
  UNIQUE (takeoff_id, version_no)
);
CREATE INDEX IF NOT EXISTS dirt_takeoff_versions_zone_idx ON public.dirt_takeoff_versions (geofence_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dirt_takeoff_versions_takeoff_idx ON public.dirt_takeoff_versions (takeoff_id, version_no DESC);

CREATE TABLE IF NOT EXISTS public.survey_shots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES public.geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  taken_on     DATE NOT NULL,
  source       TEXT NOT NULL DEFAULT 'rover' CHECK (source IN ('rover', 'total_station', 'level', 'other')),
  -- what the paste was in: 'sc_ft' (SC State Plane, international ft) or 'lnglat'
  coords       TEXT NOT NULL DEFAULT 'sc_ft' CHECK (coords IN ('sc_ft', 'lnglat')),
  -- [{ id, lng, lat, z (ft), code, kind }] — lib/survey/shots.ts
  points       JSONB NOT NULL CHECK (jsonb_typeof(points) = 'array' AND pg_column_size(points) < 1500000),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS survey_shots_zone_idx ON public.survey_shots (geofence_id, taken_on DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.survey_checks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES public.geofences(id) ON DELETE CASCADE,
  shots_id     UUID NOT NULL REFERENCES public.survey_shots(id) ON DELETE CASCADE,
  surface_id   UUID NOT NULL REFERENCES public.dirt_surfaces(id) ON DELETE CASCADE,
  -- lib/survey/check.ts CheckResults
  results      JSONB NOT NULL CHECK (pg_column_size(results) < 1500000),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS survey_checks_zone_idx ON public.survey_checks (geofence_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS survey_checks_pair_uq ON public.survey_checks (shots_id, surface_id) WHERE deleted_at IS NULL;

ALTER TABLE public.dirt_takeoff_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read" ON public.dirt_takeoff_versions;
CREATE POLICY "members read" ON public.dirt_takeoff_versions FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "members read" ON public.survey_shots;
CREATE POLICY "members read" ON public.survey_shots FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "members read" ON public.survey_checks;
CREATE POLICY "members read" ON public.survey_checks FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);

REVOKE ALL ON public.dirt_takeoff_versions, public.survey_shots, public.survey_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.dirt_takeoff_versions, public.survey_shots, public.survey_checks FROM authenticated;
GRANT SELECT ON public.dirt_takeoff_versions, public.survey_shots, public.survey_checks TO authenticated;
SELECT ht_prospect_lockdown('dirt_takeoff_versions', false);
SELECT ht_prospect_lockdown('survey_shots', false);
SELECT ht_prospect_lockdown('survey_checks', false);
