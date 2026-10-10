-- 136 — Stockpile volumes (inside the dirt takeoff add-on).
--
-- Brian, Oct 2026: a stockpile option like Propeller's — "point, click and
-- calculate from current drone survey data". Two tables:
--
--  dirt_surfaces   — a drone survey's elevation export (DSM GeoTIFF) for a
--                    site, with the date it was flown. The file lives in the
--                    private `dirt` bucket (signed direct-to-storage upload,
--                    the 113 pattern); the row records what the file's own
--                    GeoKeys said (CRS, units, footprint, resolution).
--  dirt_stockpiles — one measured pile: the toe drawn on the map, the base
--                    rule, the material + density, and the numbers the
--                    SERVER computed (lib/dirt/stockpile.ts). The same pile
--                    measured on a later survey is a NEW row with the same
--                    name, so the site page can show the change over time.
--
-- Members read their company's live rows; every write is a server action on
-- the service client after the edit + add-on checks (127's shape), so there
-- is no INSERT / UPDATE / DELETE policy. Prospects read neither (119).
-- Bounded and idempotent: CREATE IF NOT EXISTS, guarded policies, and the
-- bucket change only widens what the 127 bucket accepts.

CREATE TABLE IF NOT EXISTS public.dirt_surfaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID REFERENCES geofences(id) ON DELETE SET NULL,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  flown_on     DATE NOT NULL,
  path         TEXT NOT NULL CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/dsm-[0-9a-f-]{36}\.tif$'),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  z_units      TEXT NOT NULL DEFAULT 'auto' CHECK (z_units IN ('auto', 'm', 'ft', 'usft')),
  bytes        BIGINT,
  -- { crs, zScaleM, words, geo, bounds, resM } — lib/dirt/dsm.ts DsmInfo
  info         JSONB,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS dirt_surfaces_zone_idx ON public.dirt_surfaces (geofence_id, flown_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dirt_surfaces_company_idx ON public.dirt_surfaces (company_id, created_at DESC);

ALTER TABLE public.dirt_surfaces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dirt_surfaces' AND policyname = 'company dirt surfaces read') THEN
    CREATE POLICY "company dirt surfaces read" ON public.dirt_surfaces
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
END $$;

SELECT ht_prospect_lockdown('dirt_surfaces', false);

CREATE TABLE IF NOT EXISTS public.dirt_stockpiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id   UUID REFERENCES geofences(id) ON DELETE SET NULL,
  surface_id    UUID REFERENCES dirt_surfaces(id) ON DELETE SET NULL,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  material      TEXT NOT NULL DEFAULT 'other' CHECK (char_length(material) BETWEEN 1 AND 40),
  density_t_cy NUMERIC NOT NULL DEFAULT 1.3 CHECK (density_t_cy > 0 AND density_t_cy < 5),
  base          TEXT NOT NULL DEFAULT 'tin' CHECK (base IN ('tin', 'lowest')),
  source        TEXT NOT NULL CHECK (source IN ('dsm', 'lidar')),
  -- [[lng, lat], …] — the toe as drawn (open ring, 3–500 corners)
  toe           JSONB NOT NULL,
  measured_on   DATE NOT NULL,
  results       JSONB NOT NULL,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT dirt_stockpiles_toe_size CHECK (pg_column_size(toe) < 200000)
);

CREATE INDEX IF NOT EXISTS dirt_stockpiles_zone_idx ON public.dirt_stockpiles (geofence_id, measured_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dirt_stockpiles_company_idx ON public.dirt_stockpiles (company_id, created_at DESC);

ALTER TABLE public.dirt_stockpiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dirt_stockpiles' AND policyname = 'company dirt stockpiles read') THEN
    CREATE POLICY "company dirt stockpiles read" ON public.dirt_stockpiles
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
END $$;

SELECT ht_prospect_lockdown('dirt_stockpiles', false);

-- The `dirt` bucket now also takes survey GeoTIFFs, up to 50 MB (the zone
-- imagery cap; the project's global upload limit). Only ever widens 127.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/png', 'application/octet-stream', 'image/tiff'],
       file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 52428800)
 WHERE id = 'dirt';

NOTIFY pgrst, 'reload schema';
