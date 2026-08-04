-- 051: vendor zones ↔ receipt chase handshake.
--
-- ('vendor' zone kind itself needs no schema change — geofences.kind is
-- unconstrained TEXT since 013; app code carries the semantics.)
--
-- When a card alert arrives, the ingest checks which vehicle was sitting
-- inside a vendor zone (TEC, Gossett, Northern Tool…) at swipe time:
--   vendor_geofence_id — the vendor the card was physically at
--   suggested_job_id   — the site zone that truck came from / returns to,
--                        i.e. the job this purchase was probably FOR.
-- The magic capture page pre-selects that job; the office sees the hint.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_geofence_id UUID REFERENCES geofences(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS suggested_job_id  UUID REFERENCES geofences(id) ON DELETE SET NULL;
