-- Expenses = card/bank charges that SHOULD have a receipt. Pairing these against
-- the `receipts` table is how we find MISSING receipts and chase them. Sources:
-- manual entry, pasted/CSV card statement, and (later) Plaid/QBO sync.

CREATE TABLE IF NOT EXISTS expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source            TEXT NOT NULL DEFAULT 'manual',   -- manual | csv | plaid | qbo
  merchant          TEXT,
  amount            NUMERIC(12,2) NOT NULL,
  txn_date          DATE NOT NULL,
  last4             TEXT,                              -- card last 4, for attribution
  cardholder_user_id UUID,                             -- who to chase (a team member)
  cardholder_name   TEXT,                              -- free-text holder when not a user
  category          TEXT,
  note              TEXT,
  -- Match state.
  receipt_id        UUID REFERENCES receipts(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'needs_receipt'
                      CHECK (status IN ('needs_receipt','matched','no_receipt_needed')),
  -- Import dedup key (statement line id / hash). NULL for manual entries.
  external_id       TEXT,
  chased_at         TIMESTAMPTZ,                       -- last nudge sent
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_company_status_idx ON expenses(company_id, status, txn_date DESC);
-- Re-importing a statement never duplicates a line.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_external_uidx ON expenses(company_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company expenses" ON expenses
  FOR ALL USING (company_id = current_company_id());
