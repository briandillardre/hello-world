-- Local harness for migration 132: just enough of Supabase (roles, auth.uid()
-- / auth.role() from the request settings, the company/visibility/prospect
-- helpers of 010/111/118/119) and of the schema (companies, profiles, assets,
-- geofences + 123's geofences_json) for 132 to apply VERBATIM on a plain
-- PostgreSQL 16 — no PostGIS: geometry is a jsonb domain and ST_AsGeoJSON
-- prints it.
SET client_min_messages = warning;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default privileges: every new public table is open to the API
-- roles until RLS / revokes close it — 132 must not rely on that being off.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE DOMAIN geometry AS jsonb;
CREATE FUNCTION ST_AsGeoJSON(g geometry) RETURNS TEXT LANGUAGE sql IMMUTABLE AS 'SELECT $1::text';

CREATE TABLE companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE profiles (id UUID PRIMARY KEY, company_id UUID, role TEXT);
CREATE TABLE assets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT, type TEXT, metadata JSONB);
CREATE TABLE geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, geometry geometry NOT NULL, color TEXT NOT NULL DEFAULT '#F59E0B',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), parent_id UUID, kind TEXT NOT NULL DEFAULT 'site', notes TEXT,
  owner_id UUID, active_from TIMESTAMPTZ, active_until TIMESTAMPTZ, folder_url TEXT, completed_at TIMESTAMPTZ,
  qbo_customer_id TEXT, budget NUMERIC, division_id UUID);

-- 010 / 111 / 118 / 119 helpers, as production has them.
CREATE FUNCTION current_company_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT company_id FROM profiles WHERE id = auth.uid() $$;
CREATE FUNCTION ht_viewer_rank() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN p.id = p.company_id THEN 4 WHEN p.role = 'admin' THEN 3 WHEN p.role = 'manager' THEN 2
                WHEN p.role = 'foreman' THEN 1 ELSE 0 END
    FROM profiles p WHERE p.id = auth.uid()), -1) $$;
CREATE FUNCTION ht_visibility_rank(meta jsonb) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE meta->>'visibility' WHEN 'master' THEN 4 WHEN 'admins' THEN 3 WHEN 'managers' THEN 2 ELSE 0 END $$;
CREATE FUNCTION ht_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN p.id = p.company_id THEN 'master' ELSE COALESCE(p.role, 'associate') END
    FROM profiles p WHERE p.id = auth.uid()), 'anon') $$;
CREATE FUNCTION ht_prospect_lockdown(tbl text, allow_read boolean)
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

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company assets" ON assets FOR ALL USING (company_id = current_company_id());
CREATE POLICY "asset visibility ladder" ON assets AS RESTRICTIVE FOR ALL
  USING (ht_visibility_rank(metadata) <= ht_viewer_rank()) WITH CHECK (ht_visibility_rank(metadata) <= ht_viewer_rank());
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company geofences" ON geofences FOR ALL
  USING (company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid()))
  WITH CHECK (company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid()));

-- 123's view, verbatim.
CREATE VIEW geofences_json WITH (security_invoker = true) AS
SELECT
  id, company_id, owner_id, name, color, parent_id, kind, notes,
  folder_url, completed_at, qbo_customer_id, budget, active_from, active_until, created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry,
  division_id
FROM geofences;
GRANT SELECT ON geofences_json TO authenticated, anon;
