-- Measure tool + document folders.
--
-- 1) folder_url on assets and zones — a link to the record's document folder
--    (Dropbox, Drive, etc.). Just a URL; we don't touch the provider.
-- 2) measurements — saved map measurements (point / line / area), personal or
--    global, mirroring the personal-zone visibility model (migration 027).

ALTER TABLE assets     ADD COLUMN IF NOT EXISTS folder_url TEXT;
ALTER TABLE geofences  ADD COLUMN IF NOT EXISTS folder_url TEXT;

-- Rebuild the GeoJSON view so folder_url reaches the zone panel/detail page.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id, company_id, owner_id, name, color, parent_id, kind, notes,
  folder_url, active_from, active_until, created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;

CREATE TABLE IF NOT EXISTS measurements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- NULL = shared with the whole company; else visible only to this user.
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('point','line','area')),
  geometry    JSONB NOT NULL,          -- GeoJSON (Point / LineString / Polygon)
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- units, takeoff, computed totals
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS measurements_company_idx ON measurements(company_id);

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;

-- Read: company-scoped, and personal ones only for their owner.
DROP POLICY IF EXISTS "read measurements" ON measurements;
CREATE POLICY "read measurements" ON measurements
  FOR SELECT USING (
    company_id = current_company_id()
    AND (owner_id IS NULL OR owner_id = auth.uid())
  );

-- Write: same visibility gate; a user can only insert within their company.
DROP POLICY IF EXISTS "insert measurements" ON measurements;
CREATE POLICY "insert measurements" ON measurements
  FOR INSERT WITH CHECK (
    company_id = current_company_id()
    AND (owner_id IS NULL OR owner_id = auth.uid())
  );

-- Delete: your own personal ones, or any company (global) one.
DROP POLICY IF EXISTS "delete measurements" ON measurements;
CREATE POLICY "delete measurements" ON measurements
  FOR DELETE USING (
    company_id = current_company_id()
    AND (owner_id IS NULL OR owner_id = auth.uid())
  );
