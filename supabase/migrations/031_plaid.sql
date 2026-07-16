-- Plaid connections — link a company's card/bank so charges import themselves
-- into `expenses` (source 'plaid'), replacing the CSV paste. One row per linked
-- institution ("Item" in Plaid terms). access_token is server-only; the sync
-- cron walks the cursor so we only ever pull new transactions.

CREATE TABLE IF NOT EXISTS plaid_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL UNIQUE,
  access_token  TEXT NOT NULL,           -- server-only; never sent to the browser
  institution   TEXT,
  cursor        TEXT,                     -- /transactions/sync incremental cursor
  last_sync     TIMESTAMPTZ,
  last_status   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plaid_items_company_idx ON plaid_items(company_id);

ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company plaid items" ON plaid_items
  FOR ALL USING (company_id = current_company_id());
