-- 049: server arrival time on location rows.
--
-- `timestamp` is the DEVICE's GPS time — a tracker replaying a buffered
-- backlog (or with a skewed clock) writes rows all afternoon that carry old
-- timestamps, and the health watchdog cried "trackers silent for 17h" while
-- theft alerts were firing off live data two minutes earlier (Aug 3).
-- created_at records when the row actually REACHED us, so the watchdog can
-- tell "pipeline down" from "device clock behind".

ALTER TABLE asset_locations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS asset_locations_created_idx ON asset_locations(created_at DESC);
