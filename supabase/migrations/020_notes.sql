-- Open-ended notes on zones — the things only the owner knows ("gate code
-- 4188", "septic line along the east fence", "GC is picky about the
-- entrance"). Assets already carry notes in metadata; zones get a column.
-- The AI reads both, so tribal knowledge becomes answerable.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS notes TEXT;

-- Recreate the view WITH the new column. DROP first — CREATE OR REPLACE
-- cannot add a column mid-list (the 42P16 lesson from migration 013).
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  name,
  color,
  parent_id,
  kind,
  notes,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;
