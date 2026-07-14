-- Pairing history: who/what rode with which carrier, and when.
-- tool_associations is a CURRENT-STATE table (one upserted row per tool), so
-- "which truck had the laser level last Tuesday?" was unanswerable. This log
-- keeps one row per pairing EPISODE (started_at → ended_at, ended NULL while
-- ongoing); the flespi ingest opens/extends/closes rows as beacons move
-- between gateways. `kind` is 'tool' today; crew clock-in ↔ equipment
-- pairing will reuse the same table with kind 'crew'.

CREATE TABLE IF NOT EXISTS pairing_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'tool' CHECK (kind IN ('tool', 'crew')),
  member_asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,  -- the tool / worker
  carrier_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,  -- the truck / machine
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ  -- NULL = pairing still live
);

CREATE INDEX IF NOT EXISTS pairing_log_company_idx ON pairing_log(company_id);
CREATE INDEX IF NOT EXISTS pairing_log_member_idx  ON pairing_log(member_asset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS pairing_log_carrier_idx ON pairing_log(carrier_asset_id, started_at DESC);
-- Fast "find the open episode" lookup for the ingest hot path.
CREATE INDEX IF NOT EXISTS pairing_log_open_idx ON pairing_log(member_asset_id) WHERE ended_at IS NULL;

ALTER TABLE pairing_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company pairing log" ON pairing_log
  FOR ALL USING (company_id = current_company_id());
