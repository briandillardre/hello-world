-- Just enough of the Supabase schema for migrations 129 + 134 (driving
-- scores) to apply verbatim on a bare local PostgreSQL 16: the API roles with
-- Supabase's default grants, auth.uid() / auth.role() from session settings,
-- the company helper, 111's visibility ladder on assets, 118/119's prospect
-- helpers and 115's ht_safe_tz.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
-- Supabase's service role bypasses RLS. Roles are cluster-wide, and another
-- harness on the same server may have made this one first without it.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Supabase's own definition (134 reads it to tell the service role from a member).
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE companies (id uuid PRIMARY KEY, name text, digest_prefs jsonb);
CREATE TABLE profiles (id uuid PRIMARY KEY, company_id uuid REFERENCES companies(id), role text, name text);
CREATE TABLE assets (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id),
  name text, type text, tracker_id text, active boolean DEFAULT true, metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE geofences (id uuid PRIMARY KEY, company_id uuid REFERENCES companies(id), name text);
CREATE TABLE asset_locations (
  id bigserial PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id), company_id uuid,
  lat double precision, lng double precision, speed real, heading real, ignition boolean,
  "timestamp" timestamptz NOT NULL, raw jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_locations_asset_time_idx ON asset_locations(asset_id, "timestamp" DESC);
CREATE INDEX asset_locations_created_idx ON asset_locations(created_at DESC);

CREATE FUNCTION current_company_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid()
$$;
CREATE FUNCTION ht_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN p.id = p.company_id THEN 'master' ELSE COALESCE(p.role, 'associate') END FROM profiles p WHERE p.id = auth.uid()
$$;
CREATE FUNCTION ht_viewer_rank() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT CASE WHEN p.id = p.company_id THEN 4 WHEN p.role = 'admin' THEN 3 WHEN p.role = 'manager' THEN 2
                               WHEN p.role = 'foreman' THEN 1 ELSE 0 END FROM profiles p WHERE p.id = auth.uid()), -1)
$$;
CREATE FUNCTION ht_visibility_rank(meta jsonb) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE meta->>'visibility' WHEN 'master' THEN 4 WHEN 'admins' THEN 3 WHEN 'managers' THEN 2 ELSE 0 END
$$;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company assets" ON assets FOR SELECT USING (company_id = current_company_id());
CREATE POLICY "asset visibility ladder" ON assets AS RESTRICTIVE FOR ALL
  USING (ht_visibility_rank(metadata) <= ht_viewer_rank()) WITH CHECK (ht_visibility_rank(metadata) <= ht_viewer_rank());

-- 115
CREATE OR REPLACE FUNCTION ht_safe_tz(p_tz TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM now() AT TIME ZONE p_tz;
  RETURN p_tz;
EXCEPTION WHEN OTHERS THEN
  RETURN 'America/New_York';
END $$;

-- 119, verbatim
CREATE OR REPLACE FUNCTION ht_prospect_lockdown(tbl text, allow_read boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (insert)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (insert)" ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (update)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (update)" ON %I AS RESTRICTIVE FOR UPDATE USING (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (delete)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (delete)" ON %I AS RESTRICTIVE FOR DELETE USING (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects see nothing here" ON %I', tbl);
  IF NOT allow_read THEN
    EXECUTE format('CREATE POLICY "prospects see nothing here" ON %I AS RESTRICTIVE FOR SELECT USING (ht_viewer_role() <> ''prospect'')', tbl);
  END IF;
END $$;
