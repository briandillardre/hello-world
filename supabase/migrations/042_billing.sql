-- Subscription state, mirrored from Stripe onto the company.
--
-- Stripe is the source of truth for billing; these columns are a local CACHE
-- so every page can ask "is this company paid up?" without a network call on
-- render. The webhook keeps them fresh. If they ever disagree with Stripe,
-- Stripe wins and the next webhook corrects us.
--
-- `plan` already existed (001, default 'starter') and stays the field the app
-- reads for entitlements — Stripe just becomes what sets it.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
-- Stripe's own vocabulary, stored verbatim rather than mapped to a local
-- enum: trialing | active | past_due | canceled | incomplete | unpaid.
-- Inventing our own words here is how billing bugs get subtle.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;
-- Set when the owner cancels but the period hasn't run out — they keep
-- access until current_period_end, and the UI can say so instead of
-- pretending nothing happened.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS companies_stripe_customer_idx ON companies(stripe_customer_id);

COMMENT ON COLUMN companies.subscription_status IS
  'Stripe subscription status verbatim. Cache of Stripe state; Stripe wins on conflict.';
