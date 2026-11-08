-- 147 — The estimate (Plans & Takeoff phase 3; the plan doc's "Estimating:
-- the cost book, plants and margins").
--
--   MATERIAL   what DCG buys: #57 stone, ABC, surface asphalt, select fill…
--              with the unit it is sold by, tons per CY and waste.
--   PRICE      a material at a SOURCE (a Place on the map — a quarry, an
--              asphalt or concrete plant, a borrow pit, a landfill): $ per
--              ton / CY / load, picked up or delivered, minimum charge, fuel
--              surcharge, and the date it was quoted. Old quotes stay listed.
--   SETTINGS   one row per company: the haul truck (tons, CY, $/hr, load and
--              dump minutes), the lowboy, crews ($/hr) and the working day.
--   DISTANCE   road miles and minutes from a site to each source (no
--              traffic), cached; the fleet's own round trips replace them
--              where trucks have made the run.
--   ESTIMATE   a site's lines (from the takeoff, or added by hand) with the
--              choices made on each — material, pinned source, crew and
--              production, sub price. The numbers are computed from these
--              every time (lib/estimate/engine.ts), never stored stale.
--   MARKUPS    overhead, contingency, profit, bond, sales tax — per estimate,
--              with company defaults. ADMINS ONLY: "Margins stay behind Admin
--              by default. Managers see costs and Foremen see no dollars."
--
-- Reads: the company, AND the costs ability (ht_viewer_can_costs, 130) —
-- markups the Admin rank (ht_viewer_rank, 111). A personal zone's estimate
-- and distances are its owner's (the 144 rule). Writes: server actions on the
-- service role after the edit + plans + costs checks. Prospects: nothing.

CREATE TABLE IF NOT EXISTS public.cost_materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  unit        TEXT NOT NULL CHECK (unit IN ('TON', 'CY', 'SY', 'SF', 'LF', 'EA', 'LOAD')),
  tons_per_cy REAL CHECK (tons_per_cy IS NULL OR (tons_per_cy > 0 AND tons_per_cy <= 5)),
  waste_pct   REAL NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS cost_materials_name_uq
  ON public.cost_materials (company_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cost_prices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  material_id  UUID NOT NULL REFERENCES public.cost_materials(id) ON DELETE CASCADE,
  price        NUMERIC(14, 4) NOT NULL CHECK (price >= 0 AND price <= 1000000),
  unit         TEXT NOT NULL CHECK (unit IN ('TON', 'CY', 'SY', 'SF', 'LF', 'EA', 'LOAD')),
  basis        TEXT NOT NULL DEFAULT 'pickup' CHECK (basis IN ('pickup', 'delivered')),
  min_charge   NUMERIC(14, 2) CHECK (min_charge IS NULL OR (min_charge >= 0 AND min_charge <= 10000000)),
  fuel_pct     REAL CHECK (fuel_pct IS NULL OR (fuel_pct >= 0 AND fuel_pct <= 100)),
  quoted_on    DATE NOT NULL,
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cost_prices_material_idx ON public.cost_prices (material_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cost_prices_company_idx ON public.cost_prices (company_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cost_settings (
  company_id  UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}' CHECK (pg_column_size(data) < 64000),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cost_markup_defaults (
  company_id  UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}' CHECK (pg_column_size(data) < 4000),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_distances (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  miles        REAL NOT NULL CHECK (miles >= 0 AND miles < 1000),
  minutes      REAL NOT NULL CHECK (minutes >= 0 AND minutes < 1440),
  source       TEXT NOT NULL DEFAULT 'road' CHECK (source IN ('road', 'fleet')),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (geofence_id, place_id)
);
CREATE INDEX IF NOT EXISTS site_distances_company_idx ON public.site_distances (company_id);

CREATE TABLE IF NOT EXISTS public.estimates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'won', 'lost')),
  -- The takeoff snapshot the quantities came from, when frozen.
  snapshot_id  UUID REFERENCES public.takeoff_snapshots(id) ON DELETE SET NULL,
  -- [{id, section, code, name, unit, qty, depthIn, materialId, placeId, wastePct, crewKey, perDay, subUnit, lowboyTrips, note}]
  lines        JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array' AND pg_column_size(lines) < 500000),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS estimates_zone_idx ON public.estimates (geofence_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.estimate_markups (
  estimate_id  UUID PRIMARY KEY REFERENCES public.estimates(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data         JSONB NOT NULL DEFAULT '{}' CHECK (pg_column_size(data) < 4000),
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_markup_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_distances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_markups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "costs read" ON public.cost_materials;
CREATE POLICY "costs read" ON public.cost_materials
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.cost_prices;
CREATE POLICY "costs read" ON public.cost_prices
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.cost_settings;
CREATE POLICY "costs read" ON public.cost_settings
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "admins read" ON public.cost_markup_defaults;
CREATE POLICY "admins read" ON public.cost_markup_defaults
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_rank() >= 3);
DROP POLICY IF EXISTS "costs read" ON public.site_distances;
CREATE POLICY "costs read" ON public.site_distances
  FOR SELECT USING (
    company_id = current_company_id() AND ht_viewer_can_costs()
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = site_distances.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));
DROP POLICY IF EXISTS "costs read" ON public.estimates;
CREATE POLICY "costs read" ON public.estimates
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs()
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = estimates.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));
DROP POLICY IF EXISTS "admins read" ON public.estimate_markups;
CREATE POLICY "admins read" ON public.estimate_markups
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_rank() >= 3);

REVOKE ALL ON public.cost_materials, public.cost_prices, public.cost_settings, public.cost_markup_defaults,
  public.site_distances, public.estimates, public.estimate_markups FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cost_materials, public.cost_prices, public.cost_settings, public.cost_markup_defaults,
  public.site_distances, public.estimates, public.estimate_markups FROM authenticated;
GRANT SELECT ON public.cost_materials, public.cost_prices, public.cost_settings, public.cost_markup_defaults,
  public.site_distances, public.estimates, public.estimate_markups TO authenticated;

SELECT ht_prospect_lockdown('cost_materials', false);
SELECT ht_prospect_lockdown('cost_prices', false);
SELECT ht_prospect_lockdown('cost_settings', false);
SELECT ht_prospect_lockdown('cost_markup_defaults', false);
SELECT ht_prospect_lockdown('site_distances', false);
SELECT ht_prospect_lockdown('estimates', false);
SELECT ht_prospect_lockdown('estimate_markups', false);

NOTIFY pgrst, 'reload schema';
