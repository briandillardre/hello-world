-- Catch-up: migrations 010 (teams & invites) + 011 (permissions v2) in one
-- idempotent paste. Safe to run more than once. Run in Supabase SQL Editor.
-- (These two showed "false" in the migration checker on Jul 12 2026.)

-- ── 010: teams, invite flow, company-visible profiles ──────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

CREATE OR REPLACE FUNCTION current_company_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "see company members" ON profiles;
CREATE POLICY "see company members" ON profiles
  FOR SELECT USING (company_id = current_company_id());

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

DROP POLICY IF EXISTS "company invites" ON invites;
CREATE POLICY "company invites" ON invites
  FOR ALL USING (company_id = current_company_id());

-- ── 011: four role presets + per-user sensitive-info overrides ─────────────

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'viewer'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_view_costs     BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_manage_billing BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_manage_team    BOOLEAN;

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'viewer'));

-- ── verify: both rows must say true ─────────────────────────────────────────
SELECT * FROM (VALUES
  ('010 teams / invites', to_regclass('public.invites') IS NOT NULL),
  ('011 permissions',     EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_name = 'profiles' AND column_name = 'can_view_costs'))
) AS t(migration, applied);
