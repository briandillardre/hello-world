-- Just enough of the schema for migration 122 (pairing places) to apply
-- verbatim on a bare local PostgreSQL 16 — no Supabase, no PostGIS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE companies (id uuid PRIMARY KEY);
CREATE TABLE assets (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id),
  name text, type text, tracker_id text, active boolean DEFAULT true, metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE asset_locations (
  id bigserial PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id), company_id uuid,
  lat double precision, lng double precision, speed real, "timestamp" timestamptz NOT NULL, raw jsonb
);
CREATE INDEX asset_locations_asset_time_idx ON asset_locations(asset_id, "timestamp" DESC);
CREATE FUNCTION current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
-- 021 as shipped.
CREATE TABLE pairing_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'tool' CHECK (kind IN ('tool', 'crew')),
  member_asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  carrier_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ
);
ALTER TABLE pairing_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company pairing log" ON pairing_log FOR ALL USING (company_id = current_company_id());
