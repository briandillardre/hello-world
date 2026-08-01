-- 045: real-time receipt chase via card-alert email forwarding.
--
-- Plaid quoted $1,000/mo (Aug 1 2026 — declined). Instead we ride the card
-- issuer's OWN instant alerts: the customer points their Chase / Capital One
-- per-transaction alert emails at a per-company inbound address
-- (receipts-{slug}@hammertrack.ai, Resend inbound → /api/inbound/receipts).
-- We parse merchant/amount/last-4, create the expense within seconds of the
-- swipe, and push "snap the receipt?" to whoever holds that card. The photo
-- lands via a magic capture link (/r/{token}) — the link IS the auth, scoped
-- to that one charge.

-- Where the alert emails land. NULL until the company turns the feature on.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS inbound_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS companies_inbound_slug_uidx
  ON companies(inbound_slug) WHERE inbound_slug IS NOT NULL;

-- "…4821 = Miguel" — admin sets once, every alert on that card chases Miguel.
CREATE TABLE IF NOT EXISTS company_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  last4       TEXT NOT NULL,
  label       TEXT,                 -- "Chase Ink — blue card"
  user_id     UUID,                 -- team member who carries it (chase target)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, last4)
);

ALTER TABLE company_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company cards" ON company_cards;
CREATE POLICY "company cards" ON company_cards
  FOR ALL USING (company_id = current_company_id());

-- Chase state on the charge itself. capture_token drives the magic link;
-- nag_level tracks the escalation ladder (1 = instant ping sent, 2 = +1 h,
-- 3 = +4 h, then the nightly digest takes over).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS capture_token TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS nag_level INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_capture_token_uidx
  ON expenses(capture_token) WHERE capture_token IS NOT NULL;
