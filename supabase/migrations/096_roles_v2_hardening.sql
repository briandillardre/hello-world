-- 096: roles v2 hardening — the three findings from the review pass (Sep 4).
--
-- 1. invites was FOR ALL (010) with no WITH CHECK, so ANY member could insert
--    an invite row for their own company with role 'admin' straight through
--    PostgREST and accept it — a self-promotion that every rung of the new
--    ladder hangs on (sec-check P0). Every write path already runs on the
--    service role (create / email / revoke / accept); members only ever read.
DROP POLICY IF EXISTS "company invites" ON invites;
CREATE POLICY "company invites read" ON invites
  FOR SELECT USING (company_id = current_company_id());
REVOKE INSERT, UPDATE, DELETE ON invites FROM authenticated, anon;

-- 2. invites.role still defaulted to the retired 'viewer', which 094's CHECK
--    now rejects on any insert that omits role.
ALTER TABLE invites ALTER COLUMN role SET DEFAULT 'associate';

-- 3. Admins may UPDATE their companies row from the client (008), and the
--    072 deny-list trigger did not know about role_policy — so an Admin the
--    Master had restricted could wipe the view-levels table with one PATCH
--    and never pass rolesEditableBy. role_policy joins the server-side-only
--    columns; the team actions write it on the service role.
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
       OR NEW.role_policy            IS DISTINCT FROM OLD.role_policy
    THEN
      RAISE EXCEPTION 'api_key, billing and role_policy columns can only be changed server-side';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS companies_protected_cols ON companies;
CREATE TRIGGER companies_protected_cols
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION guard_company_protected_cols();
