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

-- 1) Demo assets = seeded tracker ids (obd-001 … gps-009 style), or anything
--    that isn't a real 15-digit IMEI. Everything they own goes with them.
DELETE FROM assets
WHERE tracker_id IS NULL
   OR tracker_id !~ '^[0-9]{15}$';

-- 2) All seeded demo zones (Riverfront Tower, Maple St Grading, Equipment Yard).
--    Redraw real zones around your actual yard/sites on the map afterward.
DELETE FROM geofences;

-- 3) Verify: should list ONLY your real tracker(s).
SELECT name, type, tracker_id, created_at FROM assets ORDER BY created_at;
