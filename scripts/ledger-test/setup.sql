-- Local harness: production tables (minus PostGIS) + stub geometry so the
-- ledger functions run verbatim. Zones are axis-aligned boxes.
SET client_min_messages = warning;
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE DOMAIN geometry AS float8[];
CREATE FUNCTION ST_MakePoint(x float8, y float8) RETURNS point LANGUAGE sql IMMUTABLE AS 'SELECT point($1,$2)';
CREATE FUNCTION ST_SetSRID(p point, s int) RETURNS point LANGUAGE sql IMMUTABLE AS 'SELECT $1';
CREATE FUNCTION ST_Contains(g geometry, p point) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  'SELECT ($2)[0] >= ($1)[1] AND ($2)[0] <= ($1)[3] AND ($2)[1] >= ($1)[2] AND ($2)[1] <= ($1)[4]';

CREATE TABLE companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE assets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL, name TEXT, type TEXT);
CREATE TABLE geofences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL, name TEXT,
  kind TEXT, geometry geometry, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE asset_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL,
  speed REAL, "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(), raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX asset_locations_asset_time_idx ON asset_locations(asset_id, "timestamp" DESC);
CREATE INDEX asset_locations_company_idx ON asset_locations(company_id);
CREATE INDEX asset_locations_created_idx ON asset_locations(created_at DESC);
CREATE INDEX asset_locations_timestamp_idx ON asset_locations("timestamp");
CREATE TABLE zone_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL,
  geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ NOT NULL, exited_at TIMESTAMPTZ NOT NULL);
CREATE INDEX zone_sessions_zone_idx ON zone_sessions(geofence_id, entered_at DESC);
CREATE INDEX zone_sessions_asset_idx ON zone_sessions(asset_id, entered_at DESC);
CREATE TABLE usage_daily (company_id UUID NOT NULL, geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE, day DATE NOT NULL,
  on_site_secs INTEGER NOT NULL DEFAULT 0, active_secs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (geofence_id, asset_id, day));
CREATE TABLE pairing_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL, kind TEXT,
  member_asset_id UUID NOT NULL, carrier_asset_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, last_seen TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ);
CREATE TABLE trail_daily (company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE, day DATE NOT NULL,
  pts JSONB NOT NULL, pts_lite JSONB NOT NULL, n_raw INTEGER NOT NULL DEFAULT 0,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (asset_id, day));
