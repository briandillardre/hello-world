-- BLE truth-telling (owner ask, Jul 16):
-- 1) last_lat/last_lng — the GATEWAY'S position at the moment of the last BLE
--    sighting. A stale tag renders THERE (its true last-seen spot), not at
--    wherever its old carrier drove afterwards.
-- 2) attached_since — when this tool started riding its current gateway. The
--    map's "2 tools" badge only counts tags that have been with the asset a
--    little while, so a drive-by ping doesn't instantly re-tag a truck.

ALTER TABLE tool_associations ADD COLUMN IF NOT EXISTS last_lat  DOUBLE PRECISION;
ALTER TABLE tool_associations ADD COLUMN IF NOT EXISTS last_lng  DOUBLE PRECISION;
ALTER TABLE tool_associations ADD COLUMN IF NOT EXISTS attached_since TIMESTAMPTZ;
