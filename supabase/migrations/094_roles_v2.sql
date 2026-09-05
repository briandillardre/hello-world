-- 094: roles v2 — Associate replaces Viewer, and the company view-levels table.
--
-- Brian, Sep 4 2026: "Master Admin (shows to everyone else as just simple
-- admin) only 1 login … Admin sees everything unless master admin sets
-- otherwise, can set view levels for everyone below admin … Manager …
-- Foreman … Viewer — rename this to something better, maybe associate."
--
-- The Master is not a stored role: it is the profile whose id IS the company
-- id (the account that created the company) — one login by construction.
-- What this migration adds is the per-company VIEW LEVELS table (a sparse
-- role → feature → on/off override on the defaults in lib/permissions.ts)
-- and the Viewer → Associate rename.

-- ── Viewer becomes Associate ────────────────────────────────────────────────
-- Widen the CHECKs first (both values allowed during the rewrite), move the
-- rows, then narrow. Same on invites.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate', 'viewer'));
UPDATE profiles SET role = 'associate' WHERE role = 'viewer';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate'));
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'associate';

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate', 'viewer'));
UPDATE invites SET role = 'associate' WHERE role = 'viewer';
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate'));

-- ── The view-levels table ───────────────────────────────────────────────────
-- { "manager": { "finance": false, "accounting": true }, "foreman": {...} }
-- Absent key = the default. Written only through the service role from the
-- team actions (companies UPDATE is already owner/admin-gated by RLS, but the
-- rank rules — Master edits Admin's row, Admins edit below Admin — live in
-- code, so the column takes no member write policy of its own).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS role_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
