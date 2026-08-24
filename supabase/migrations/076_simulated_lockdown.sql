-- 076: companies.simulated is SERVER-ONLY (sec-check P1 on 075). A tenant
-- who could flip simulated=true from the browser would point the platform's
-- simulator cron at their own company — sustained OSRM traffic and fake
-- telemetry writes at HammerTrack's expense, and cron-budget starvation for
-- the real showroom. Only the founder-gated seed route (service role) may
-- set it.

-- (1) UPDATE path: extend 072's deny-list trigger.
CREATE OR REPLACE FUNCTION guard_company_protected_cols()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.role(), 'postgres') NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF NEW.api_key                IS DISTINCT FROM OLD.api_key
       OR NEW.plan                   IS DISTINCT FROM OLD.plan
       OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
       OR NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end
       OR NEW.cancel_at_period_end   IS DISTINCT FROM OLD.cancel_at_period_end
       OR NEW.simulated              IS DISTINCT FROM OLD.simulated
    THEN
      RAISE EXCEPTION 'api_key, billing, and simulator columns can only be changed server-side';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- (2) INSERT path: fresh signups must start un-simulated.
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
    AND COALESCE(simulated, FALSE) = FALSE
  );
