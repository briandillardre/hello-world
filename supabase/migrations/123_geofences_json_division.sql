-- 123 — zones carry their division again.
--
-- 106 added geofences.division_id but never rebuilt geofences_json, whose
-- column list is explicit (046). Every zone read goes through that view
-- (getGeofences / getGeofence), so no zone ever came back with its division:
-- picking a division on the map hid EVERY zone, the zones list's division
-- filter showed none, and the zone page's Division card read "Unassigned"
-- right after a save. Found by the Sep 28 ship-check.
--
-- CREATE OR REPLACE keeps the view's grants; Postgres allows a new column
-- only at the END, so the 046 list is repeated as-is and division_id follows.
CREATE OR REPLACE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id, company_id, owner_id, name, color, parent_id, kind, notes,
  folder_url, completed_at, qbo_customer_id, budget, active_from, active_until, created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry,
  division_id
FROM geofences;

-- PostgREST caches each view's columns; make it read the new one now.
NOTIFY pgrst, 'reload schema';
