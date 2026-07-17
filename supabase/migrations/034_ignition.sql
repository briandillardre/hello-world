-- Ignition state per fix, extracted at ingest from OBD telemetry (explicit
-- ignition flag → RPM → charging voltage — same ladder as vehiclePower).
-- Fixes the idle math: "idle" must mean ENGINE ON and not moving. Without
-- this column the heuristic counted any awake-but-parked device as idling
-- (Trey's Silverado showed 19h idle in a day, Jul 16). NULL = unknown
-- (no OBD data on that ping, e.g. battery equipment units).

ALTER TABLE asset_locations ADD COLUMN IF NOT EXISTS ignition BOOLEAN;
