-- 127 — Dirt takeoffs (the earthwork add-on) + per-company add-ons.
--
-- Brian, Oct 4 2026: "Can we do the dirt takeoff similar to kubla as a
-- separate dirtwork plugin with additional cost in hammertrack" … "Ideal world
-- a project comes in, pdf plans show up on the map in actual location, dirt
-- takeoff gets run, cut fill visible on map."
--
-- A takeoff is ONE design document (traced contours, spot grades, demo /
-- topsoil / construction-thickness areas, building pads — lib/dirt/takeoff.ts)
-- plus the numbers it last produced and the cut/fill picture drawn on the map.
-- Saved whole, validated server-side (lib/dirt/schema.ts) — a takeoff is
-- edited by one estimator at a time and an atomic save is the honest model.
--
-- company_addons is the first paid add-on switch. Rows are written by the
-- service role only (the founder, and later the Stripe webhook); members read
-- their own company's rows so the app can show the tab open or locked.

CREATE TABLE IF NOT EXISTS public.company_addons (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  addon       TEXT NOT NULL CHECK (addon IN ('dirt')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  source      TEXT NOT NULL DEFAULT 'founder' CHECK (source IN ('founder', 'stripe', 'trial')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, addon)
);

ALTER TABLE public.company_addons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_addons' AND policyname = 'company addons read') THEN
    CREATE POLICY "company addons read" ON public.company_addons
      FOR SELECT USING (company_id = current_company_id());
  END IF;
END $$;

SELECT ht_prospect_lockdown('company_addons', false);

CREATE TABLE IF NOT EXISTS public.dirt_takeoffs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id   UUID REFERENCES geofences(id) ON DELETE SET NULL,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  design        JSONB NOT NULL DEFAULT '{}'::jsonb,
  results       JSONB,
  -- The cut/fill picture: a PNG in the private `dirt` bucket and its four
  -- [lng, lat] corners (TL, TR, BR, BL — a MapLibre image source).
  heat_path     TEXT CHECK (heat_path IS NULL OR heat_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/heat-[0-9]+\.png$'),
  heat_corners  JSONB,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at   TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT dirt_takeoffs_design_size CHECK (pg_column_size(design) < 3000000)
);

CREATE INDEX IF NOT EXISTS dirt_takeoffs_company_idx ON public.dirt_takeoffs (company_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dirt_takeoffs_zone_idx ON public.dirt_takeoffs (geofence_id) WHERE deleted_at IS NULL;

ALTER TABLE public.dirt_takeoffs ENABLE ROW LEVEL SECURITY;

-- Members read their company's takeoffs; every write goes through a server
-- action on the service client after the edit + add-on checks, so there is no
-- INSERT / UPDATE / DELETE policy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dirt_takeoffs' AND policyname = 'company dirt takeoffs read') THEN
    CREATE POLICY "company dirt takeoffs read" ON public.dirt_takeoffs
      FOR SELECT USING (company_id = current_company_id());
  END IF;
END $$;

SELECT ht_prospect_lockdown('dirt_takeoffs', false);

-- Private bucket: cut/fill PNGs and cached lidar grids. No storage.objects
-- policies on purpose — uploads ride service-role signed upload URLs and
-- reads signed URLs (the 113 pattern).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dirt', 'dirt', false, 20971520, ARRAY['image/png', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
