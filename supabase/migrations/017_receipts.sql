-- 017: receipts inbox — every receipt photo captured in a daily log gets a
-- row here. AI fills vendor/amount/date; a HUMAN approves before anything
-- posts to QuickBooks (the GAAP screens/books boundary, permanently).

CREATE TABLE IF NOT EXISTS receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  user_id             UUID,
  daily_log_id        UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  project_geofence_id UUID,
  url                 TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  vendor              TEXT,
  amount              NUMERIC(12, 2),
  txn_date            DATE,
  category            TEXT,
  note                TEXT,
  qbo_purchase_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS receipts_company_status_idx ON receipts(company_id, status, created_at DESC);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company receipts" ON receipts;
CREATE POLICY "company receipts" ON receipts
  FOR ALL USING (company_id = current_company_id());
