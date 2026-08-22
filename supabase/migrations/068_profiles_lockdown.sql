-- 068: profiles privilege lockdown (sec-check P1, Aug 22).
-- "users see own profile" (001) was FOR ALL with no WITH CHECK: any signed-in
-- user could PATCH their own role / can_view_costs / company_id straight
-- through PostgREST with the public anon key — self-escalation to admin,
-- cost visibility, or a tenant hop. Every legitimate profile WRITE already
-- goes through the service role (auth-callback bootstrap, team role changes,
-- permission overrides, map-view saves) except signup's own-row INSERT — so
-- browser sessions keep SELECT plus a founder-shaped INSERT and lose the rest.

-- Grant-level: sessions can no longer UPDATE or DELETE profile rows at all.
-- (The register flow's upsert uses ignoreDuplicates = INSERT ON CONFLICT DO
-- NOTHING, so it never needs UPDATE.)
REVOKE UPDATE, DELETE ON profiles FROM authenticated;
REVOKE UPDATE, DELETE ON profiles FROM anon;

-- Policy-level belt: the own-row policy shrinks to SELECT so a future
-- re-GRANT can't quietly reopen writes without a deliberate policy. RLS
-- policies OR together — the 010 company-wide SELECT (Team page) still applies.
DROP POLICY IF EXISTS "users see own profile" ON profiles;
CREATE POLICY "users see own profile" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Signup INSERT tightens to the exact founder shape the register flow
-- creates (companies.id = profiles.id = auth.uid()) — an invitee can no
-- longer pre-insert themselves into a company_id they learned somewhere.
-- Invite acceptance runs on the service role and is unaffected.
DROP POLICY IF EXISTS "users create own profile" ON profiles;
CREATE POLICY "users create own profile" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid() AND company_id = auth.uid());
