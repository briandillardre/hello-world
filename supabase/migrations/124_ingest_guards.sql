-- 124 — two guards on the tracker stream (flespi ingest, lib/ingest-guard.ts).
--
-- asset_fix_tail — PARKED TAG CHATTER. A truck parked near tagged gear sends
-- a "tag scan" record every ~11 s all day and night: the OBD unit's Bluetooth
-- scan writes one on every change in what it hears, and a tag at the edge of
-- range flickers in and out. On Sep 28 that was 45% of every truck message
-- (the F650: 2,503 of 2,517 while it never moved). Each one is the parked
-- position again and nothing else. The ingest now keeps the first and last of
-- every parked run, one at least every 2.5 minutes and any that hears a new
-- tag; the rest still feed tool custody but are not stored as positions.
-- A run's newest skipped record waits here between webhook batches, so the
-- record that ends the run (engine on, moving, a new place) is stored right
-- after its true predecessor — every "time since the last fix" the hours
-- ledger, trips and idle math add up spans exactly what it did before.
--
-- asset_location_rejects — GPS SPIKES. On Sep 28 the Charleston dump
-- trailer's battery unit sent one fix it called valid from the Gulf of
-- Mexico, 6,000 mph out and back, and the day read 1,357.8 miles. A fix that
-- implies more than 300 mph over more than 20 km is logged here with the
-- reason instead of being stored; a second fix that agrees with it within
-- 30 minutes proves the move was real and both go in (restored_at set).
--
-- Both are written and read by the service role only: no policies, no grants.

CREATE TABLE IF NOT EXISTS asset_fix_tail (
  asset_id   UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  fix        JSONB NOT NULL,
  -- the tags the run has already stored (a new one is stored, not skipped)
  run_tags   TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE asset_fix_tail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asset_fix_tail FROM PUBLIC, anon, authenticated;
SELECT ht_prospect_lockdown('asset_fix_tail', false);

CREATE TABLE IF NOT EXISTS asset_location_rejects (
  id          BIGSERIAL PRIMARY KEY,
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  reason      TEXT NOT NULL,
  fix         JSONB NOT NULL,
  restored_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS asset_location_rejects_asset_ts
  ON asset_location_rejects (asset_id, "timestamp" DESC);
ALTER TABLE asset_location_rejects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asset_location_rejects FROM PUBLIC, anon, authenticated;
SELECT ht_prospect_lockdown('asset_location_rejects', false);

NOTIFY pgrst, 'reload schema';
