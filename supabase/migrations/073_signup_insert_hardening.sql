-- 073: close the INSERT route around 072's UPDATE-only trigger, and stop
-- exposing the ledger rebuild functions to client sessions.
--
-- (1) sec-check P1: the signup policy (003) checked only id = auth.uid(),
-- so a fresh email signup could POST its own companies row with
-- plan='founding25' + billing fields before the app's ignoreDuplicates
-- upsert ran — plan escalation via INSERT while the 072 trigger only
-- guards UPDATE. New rows must start clean; the app's own signup insert
-- (register page: id/name/api_key/plan='starter') passes unchanged.
DROP POLICY IF EXISTS "users create own company" ON companies;
CREATE POLICY "users create own company" ON companies
  FOR INSERT WITH CHECK (
    id = auth.uid()
    AND plan = 'starter'
    AND stripe_customer_id IS NULL
    AND stripe_subscription_id IS NULL
    AND subscription_status IS NULL
    AND current_period_end IS NULL
    AND COALESCE(cancel_at_period_end, FALSE) = FALSE
  );

-- (2) sec-check P2: SECURITY DEFINER + default PUBLIC EXECUTE meant any
-- authenticated session could rpc() a full-year, all-tenant ledger rebuild
-- (cheap CPU amplification). Only the service role calls these
-- (zones actions + the usage cron).
REVOKE ALL ON FUNCTION rebuild_zone_usage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rebuild_all_usage(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
