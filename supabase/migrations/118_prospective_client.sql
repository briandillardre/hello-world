-- 118 — "Prospective Client" (Brian, Sep 21 2026): "add an option for a team
-- member to be a 'Prospective Client' — they can not see the other team
-- members and are hidden to everyone on teams except me."
--
-- A login that sees the PRODUCT and never the PEOPLE:
--   • a prospect reads only their own profile row — no roster, anywhere;
--   • a prospect's row is visible only to the Master (profile id == company
--     id) and to themselves — an Admin's /team never lists them, and neither
--     does any roster (share-view recipients, notify audiences…);
--   • a prospect never sees a person on the map: crew phones are `personnel`
--     assets, and everything keyed to an asset already follows it (111);
--   • a prospect writes NOTHING — a restrictive read-only policy on every
--     RLS-enabled table, so even a direct PostgREST call with their JWT
--     cannot add, change or delete a row.
-- The app mirrors each rule for "view app as" (RLS sees the real uid) in
-- lib/permissions.ts — canSeeAsset / outranks / assignableRolesFor.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate', 'prospect'));
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'foreman', 'associate', 'prospect'));

-- The caller's role for policies. SECURITY DEFINER like ht_viewer_rank (111):
-- profiles' own RLS would recurse otherwise. 'master' for the company
-- creator, the stored role for everyone else, 'anon' signed out.
CREATE OR REPLACE FUNCTION ht_viewer_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN p.id = p.company_id THEN 'master' ELSE COALESCE(p.role, 'associate') END
    FROM profiles p WHERE p.id = auth.uid()), 'anon')
$$;
REVOKE ALL ON FUNCTION ht_viewer_role() FROM public;
GRANT EXECUTE ON FUNCTION ht_viewer_role() TO authenticated, anon, service_role;

-- ── People ──────────────────────────────────────────────────────────────────
-- A prospect sees only themselves.
DROP POLICY IF EXISTS "prospects see only themselves" ON profiles;
CREATE POLICY "prospects see only themselves" ON profiles AS RESTRICTIVE FOR SELECT
  USING (ht_viewer_role() <> 'prospect' OR id = auth.uid());
-- A prospect is seen only by the Master (and themselves).
DROP POLICY IF EXISTS "prospects hidden below the owner" ON profiles;
CREATE POLICY "prospects hidden below the owner" ON profiles AS RESTRICTIVE FOR SELECT
  USING (role IS DISTINCT FROM 'prospect' OR id = auth.uid() OR ht_viewer_role() = 'master');
-- Their pending invite is the Master's business too.
DROP POLICY IF EXISTS "prospect invites hidden below the owner" ON invites;
CREATE POLICY "prospect invites hidden below the owner" ON invites AS RESTRICTIVE FOR SELECT
  USING (role IS DISTINCT FROM 'prospect' OR ht_viewer_role() = 'master');

-- ── Never a person on the map ───────────────────────────────────────────────
-- Crew phones are `personnel` assets; their fixes, trails and alerts follow
-- the asset through 111's "follows asset visibility" policies.
DROP POLICY IF EXISTS "prospects never see people" ON assets;
CREATE POLICY "prospects never see people" ON assets AS RESTRICTIVE FOR ALL
  USING (ht_viewer_role() <> 'prospect' OR type <> 'personnel')
  WITH CHECK (ht_viewer_role() <> 'prospect' OR type <> 'personnel');

-- The people-shaped tables a prospect has no page for and must not be able
-- to read through the API either: who clocked in where, whose card was run,
-- who wrote the daily log, whose phone is registered, who is being invited.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_entries', 'daily_logs', 'expenses', 'receipts', 'device_tokens', 'pairing_log', 'field_photos', 'invites']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "prospects see no people data" ON %I', t);
      EXECUTE format('CREATE POLICY "prospects see no people data" ON %I AS RESTRICTIVE FOR SELECT USING (ht_viewer_role() <> ''prospect'')', t);
    END IF;
  END LOOP;
END $$;

-- ── Read-only, everywhere ───────────────────────────────────────────────────
-- One restrictive policy per write verb on every RLS-enabled table we own.
-- Each table in its own block: an extension-owned table (spatial_ref_sys)
-- refuses CREATE POLICY and must not take the deploy down with it.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity AND tablename <> 'spatial_ref_sys'
    ORDER BY tablename
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS "prospects read only (insert)" ON %I', t);
      EXECUTE format('CREATE POLICY "prospects read only (insert)" ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (ht_viewer_role() <> ''prospect'')', t);
      EXECUTE format('DROP POLICY IF EXISTS "prospects read only (update)" ON %I', t);
      EXECUTE format('CREATE POLICY "prospects read only (update)" ON %I AS RESTRICTIVE FOR UPDATE USING (ht_viewer_role() <> ''prospect'')', t);
      EXECUTE format('DROP POLICY IF EXISTS "prospects read only (delete)" ON %I', t);
      EXECUTE format('CREATE POLICY "prospects read only (delete)" ON %I AS RESTRICTIVE FOR DELETE USING (ht_viewer_role() <> ''prospect'')', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '118: read-only policy skipped on % (%)', t, SQLERRM;
    END;
  END LOOP;
END $$;
