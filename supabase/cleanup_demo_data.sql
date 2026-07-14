-- ============================================================================
-- Remove the seeded Nashville demo data from the PRODUCTION database.
-- ============================================================================
-- seed_dillard.sql / seed_history.sql planted 10 placeholder assets, 24h of
-- fake history, and 3 Nashville geofences into the real company so the map
-- wasn't empty before hardware arrived. Hardware is live now — clear them out.
--
-- KEEPS: any asset wired to a real T1 tracker (15-digit IMEI tracker_id),
-- e.g. "Chevy 1500 - Brian" (868996068802222), and all of its history.
-- The marketing /demo page is unaffected — its data lives in code
-- (lib/mock-data.ts), not in this database.
--
-- Cascades handle the rest: deleting an asset removes its asset_locations,
-- tool_associations, maintenance_schedules, service_records, and alert_events;
-- deleting a geofence removes its alert_rules.
--
-- Safe to re-run.

-- 1) Demo assets = the exact seeded tracker ids. Everything they own goes
--    with them. (An earlier draft deleted anything that wasn't a 15-digit
--    IMEI — that would now also delete real BLE tool tags, whose tracker_id
--    is a beacon identity like "FDA50693-…:10065:1", and phone-tracked
--    personnel. Only the seed list is safe to match on.)
DELETE FROM assets
WHERE tracker_id IN (
  'obd-001','gps-002','bt-003','bt-004','gps-005',
  'obd-006','bt-007','bt-008','gps-009','obd-010'
);

-- 1b) Stale seeded fixes attached to assets that were RENAMED into real ones
--     (e.g. a seeded tool repurposed as a live BLE tag keeps its old Nashville
--     row, which pins it to TN on the map). Tools have no GPS of their own —
--     any tool-owned location row is seed residue.
DELETE FROM asset_locations
WHERE asset_id IN (SELECT id FROM assets WHERE type = 'tool');

-- 2) All seeded demo zones (Riverfront Tower, Maple St Grading, Equipment Yard).
--    Redraw real zones around your actual yard/sites on the map afterward.
DELETE FROM geofences;

-- 3) Verify: should list ONLY your real tracker(s).
SELECT name, type, tracker_id, created_at FROM assets ORDER BY created_at;
