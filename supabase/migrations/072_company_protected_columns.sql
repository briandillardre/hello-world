-- 072: lock the company's credential + billing columns at the DB layer
-- (task #22). Migration 008 lets admins UPDATE their own companies row from
-- the browser client — which also meant an admin session (or anything that
-- stole its JWT) could rewrite api_key (the MCP/ingest credential), or set
-- plan/subscription columns and bypass billing. Those columns are now
-- server-only: key rotation already goes through the service role
-- (rotateApiKeyAction), Stripe webhooks own the billing fields, and the
-- ingest key can no longer be silently swapped client-side.
--
-- Trigger (not column-level GRANTs): the editable-column list changes with
-- every settings feature, so allow-listing edits would break future saves;
-- deny-listing the protected few is stable.

CREATE OR REPLACE FUNCTION guard_company_protected_cols()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Service role and direct (postgres / migration) connections pass; any
  -- JWT-authenticated client role does not. auth.role() is NULL on direct
  -- connections, 'service_role' for the service key.
  IF COALESCE(auth.role(), 'postgres') NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF NEW.api_key                IS DISTINCT FROM OLD.api_key
       OR NEW.plan                   IS DISTINCT FROM OLD.plan
       OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
       OR NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end
       OR NEW.cancel_at_period_end   IS DISTINCT FROM OLD.cancel_at_period_end
    THEN
      RAISE EXCEPTION 'api_key and billing columns can only be changed server-side';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS companies_protected_cols ON companies;
CREATE TRIGGER companies_protected_cols
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION guard_company_protected_cols();
