-- Teams & roles: multiple users per company, invite flow, role-based access.
--
-- Role model: admin (full), foreman (operate — edit assets/zones/alerts, no
-- billing/team/settings), viewer (read-only). 001 only allowed admin/viewer.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'foreman', 'viewer'));

-- Store email on the profile so the Team page can show who's who without the
-- auth admin API (auth.users isn't readable via anon).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- current_company_id() is called from RLS policies; make it SECURITY DEFINER so
-- it bypasses RLS on its own lookup and can never recurse through the new
-- "see company members" policy below.
CREATE OR REPLACE FUNCTION current_company_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$;

-- Teammates can see each other (for the Team page). Own-profile ALL policy from
-- 001 still applies; this adds company-wide SELECT (policies are OR'd).
CREATE POLICY "see company members" ON profiles
  FOR SELECT USING (company_id = current_company_id());

-- Invitations. A token-bearing link lets someone join a specific company at a
-- specific role — the accept flow (service role) validates the token, so a user
-- can never self-assign into a company by guessing a company_id.
CREATE TABLE IF NOT EXISTS invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'foreman', 'viewer')),
  token       TEXT NOT NULL UNIQUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ
);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS invites_company_idx ON invites(company_id);

-- Company members can view/manage their company's invites (creation is further
-- gated to admins in the server action).
CREATE POLICY "company invites" ON invites
  FOR ALL USING (company_id = current_company_id());
