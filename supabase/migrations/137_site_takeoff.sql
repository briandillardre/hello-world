-- 137 — Site takeoffs (paving + landscaping quantities off the customer's own
-- placed drone pictures) + the 'site_takeoff' add-on key.
--
-- A site takeoff is ONE design document (line items with unit prices, and the
-- marks traced on a zone's placed drone shot or, for hand tracing only, the
-- Esri basemap — lib/site-takeoff/items.ts) plus the quantities the server
-- last computed from it (lib/site-takeoff/measure.ts). Saved whole and
-- validated server-side (lib/site-takeoff/schema.ts), like dirt_takeoffs (127).
--
-- Every write is a server action on the service client after the edit +
-- add-on checks, so there is no INSERT / UPDATE / DELETE policy. Members read
-- their own company's rows; prospects read nothing (119 lockdown).
--
-- Small statements only: a CHECK swap on a handful of add-on rows and a new,
-- empty table. No backfill. Idempotent.

-- ── company_addons: allow 'site_takeoff' without dropping any other key ───
-- Rebuilt from the CURRENT constraint's own list (131's pattern), so a key
-- another migration added meanwhile survives this one.
DO $$
DECLARE
  def  text;
  vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.company_addons'::regclass AND c.conname = 'company_addons_addon_check';
  IF def IS NULL THEN
    vals := ARRAY['dirt', 'satellite'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(def, '''([^'']+)''', 'g') AS m;
  END IF;
  IF NOT ('site_takeoff' = ANY (vals)) THEN
    vals := vals || 'site_takeoff'::text;
    ALTER TABLE public.company_addons DROP CONSTRAINT IF EXISTS company_addons_addon_check;
    EXECUTE format('ALTER TABLE public.company_addons ADD CONSTRAINT company_addons_addon_check CHECK (addon IN (%s))',
      (SELECT string_agg(quote_literal(v), ', ' ORDER BY v) FROM unnest(vals) AS v));
  END IF;
END $$;

-- ── site_takeoffs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_takeoffs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  zone_id      UUID REFERENCES geofences(id) ON DELETE SET NULL,
  -- The placed drone shot it is traced on; NULL = the Esri basemap (hand tracing only).
  imagery_id   UUID REFERENCES zone_imagery(id) ON DELETE SET NULL,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  design       JSONB NOT NULL DEFAULT '{}'::jsonb,
  results      JSONB,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT site_takeoffs_design_size CHECK (pg_column_size(design) < 3000000)
);

CREATE INDEX IF NOT EXISTS site_takeoffs_company_idx ON public.site_takeoffs (company_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS site_takeoffs_zone_idx ON public.site_takeoffs (zone_id) WHERE deleted_at IS NULL;

ALTER TABLE public.site_takeoffs ENABLE ROW LEVEL SECURITY;

-- Members read their company's live takeoffs. A takeoff is never on a
-- personal zone (the create action refuses one); if a zone is later made
-- personal, its takeoffs follow the zone and stay with its owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'site_takeoffs' AND policyname = 'company site takeoffs read') THEN
    CREATE POLICY "company site takeoffs read" ON public.site_takeoffs
      FOR SELECT USING (
        company_id = current_company_id()
        AND deleted_at IS NULL
        AND (zone_id IS NULL OR EXISTS (
          SELECT 1 FROM geofences g
          WHERE g.id = site_takeoffs.zone_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())
        ))
      );
  END IF;
END $$;

REVOKE ALL ON public.site_takeoffs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.site_takeoffs FROM authenticated;
GRANT SELECT ON public.site_takeoffs TO authenticated;

SELECT ht_prospect_lockdown('site_takeoffs', false);

NOTIFY pgrst, 'reload schema';
