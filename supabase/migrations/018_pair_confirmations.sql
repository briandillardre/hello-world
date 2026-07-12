-- Who-ran-what confirmations: the foreman's word on top of the GPS guess.
-- The pairing engine (lib/pairing) proposes person↔machine runs from
-- co-movement; a human confirms or rejects each day's pair. Confirmed pairs
-- become payroll/job-cost grade; rejected ones stop showing up.

CREATE TABLE IF NOT EXISTS pair_confirmations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  person_asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  machine_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  decided_by       UUID,
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, day, person_asset_id, machine_asset_id)
);
ALTER TABLE pair_confirmations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS pair_confirmations_day_idx ON pair_confirmations(company_id, day);

DROP POLICY IF EXISTS "company pair confirmations" ON pair_confirmations;
CREATE POLICY "company pair confirmations" ON pair_confirmations
  FOR ALL USING (company_id = current_company_id());
