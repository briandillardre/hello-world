-- Permissions v2: four role presets + per-user sensitive-info overrides.
--
-- Model (deliberately NOT a per-feature matrix — roles cover 90%, three
-- targeted toggles cover the person-specific exceptions):
--   admin    — everything, incl. billing, team, settings
--   manager  — full operations + costs; no billing/team by default
--   foreman  — day-to-day ops; NO dollar figures by default
--   viewer   — read-only, no costs
--
-- Overrides are NULLABLE booleans: NULL = inherit the role default,
-- true/false = admin explicitly granted/revoked for that person.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'viewer'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_view_costs     BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_manage_billing BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_manage_team    BOOLEAN;

-- Invites can carry the new role too.
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'viewer'));
