-- Jobs: make the zone THE canonical job record (DCG convention, Jul 19).
--
-- DCG runs QuickBooks "customers" as jobs — "26-088 Asphalt- HLC TR Driveway"
-- — renamed with a leading Z when the job completes (marks it done AND sinks
-- it to the bottom of the crews' Workforce pick list). The same identity must
-- exist ONCE and flow everywhere: zone name = project = costing = folder =
-- QBO customer. These columns let a zone carry job state + its QBO twin:
--
--   completed_at     — set when the job is marked complete (the Z flip)
--   qbo_customer_id  — the QuickBooks customer this zone mirrors, so a
--                      complete/reopen renames BOTH systems in one tap
--
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;

-- Rebuild the GeoJSON view so the new fields reach the zone pages/panels.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id, company_id, owner_id, name, color, parent_id, kind, notes,
  folder_url, completed_at, qbo_customer_id, active_from, active_until, created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;
