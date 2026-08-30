-- 085: Places — saved destinations crews navigate to.
--
-- Brian, Aug 29: "I'd like to have places, for example, pins with an actual
-- destination, routing, traffic, etc., just like Google Maps. I want this to
-- be an app that all my guys stay in all day and not have to use Google Maps."
--
-- Distinct from geofence zones on purpose. A zone is an AREA the alerts
-- engine and the hours ledger reason about — entering one starts billing
-- time. A place is a POINT you drive to: the supply house, the dump, the
-- shop, a customer's driveway. Filing "Lowe's on Woodruff Rd" as a geofence
-- would put it in the burn map and the utilization math, which is wrong.

CREATE TABLE IF NOT EXISTS places (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Drives the pin glyph + colour. Free text rather than an enum so adding a
  -- category later is a UI change, not a migration.
  kind        TEXT NOT NULL DEFAULT 'other',
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  -- What the geocoder called it when the pin was dropped; shown under the
  -- name so "Back gate" still tells you which road it's on.
  address     TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- The map loads every active place for the company on each open.
CREATE INDEX IF NOT EXISTS places_company_idx ON places (company_id) WHERE active;

ALTER TABLE places ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'places' AND policyname = 'company places') THEN
    CREATE POLICY "company places" ON places
      FOR ALL USING (company_id = current_company_id());
  END IF;
END $$;
