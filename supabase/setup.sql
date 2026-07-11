-- ============================================================================
-- HammerTrack — one-time database setup
-- ============================================================================
-- Paste this WHOLE file into the Supabase SQL Editor on a FRESH project → Run.
-- It is the 10 migrations in supabase/migrations/ concatenated in order.
-- Supabase already provides PostGIS, auth, auth.uid(), storage, and the
-- supabase_realtime publication, so no shims are needed. Run ONCE.
-- ============================================================================


-- ==================== 001_initial.sql ====================

-- Enable PostGIS for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Companies (one per paying customer / team)
CREATE TABLE companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  api_key    TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL DEFAULT 'starter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles linked to auth.users
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assets (vehicles, equipment, personnel, tools)
CREATE TABLE assets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('vehicle', 'equipment', 'personnel', 'tool')),
  tracker_id TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, tracker_id)
);

CREATE INDEX assets_company_idx ON assets(company_id);
CREATE INDEX assets_tracker_idx ON assets(tracker_id) WHERE tracker_id IS NOT NULL;

-- Asset location history (PostGIS + time-series)
CREATE TABLE asset_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  geom       GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  accuracy   REAL,
  battery    SMALLINT,
  speed      REAL,
  heading    REAL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw        JSONB
);

CREATE INDEX asset_locations_asset_time_idx ON asset_locations(asset_id, timestamp DESC);
CREATE INDEX asset_locations_geom_idx ON asset_locations USING GIST(geom);
CREATE INDEX asset_locations_company_idx ON asset_locations(company_id);

-- Latest location view for efficient map queries
CREATE VIEW asset_latest_locations AS
SELECT DISTINCT ON (asset_id)
  id, asset_id, company_id, lat, lng, geom, accuracy, battery, speed, heading, timestamp, raw
FROM asset_locations
ORDER BY asset_id, timestamp DESC;

-- Geofences (PostGIS polygons)
CREATE TABLE geofences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  geometry   GEOMETRY(Polygon, 4326) NOT NULL,
  color      TEXT NOT NULL DEFAULT '#F59E0B',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX geofences_company_idx ON geofences(company_id);
CREATE INDEX geofences_geom_idx ON geofences USING GIST(geometry);

-- Alert rules
CREATE TABLE alert_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  asset_id     UUID REFERENCES assets(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL CHECK (trigger IN ('enter', 'exit', 'idle')),
  idle_minutes INTEGER,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert events (fired alerts log)
CREATE TABLE alert_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL,
  rule_id          UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at  TIMESTAMPTZ
);

CREATE INDEX alert_events_company_idx ON alert_events(company_id, triggered_at DESC);

-- Row Level Security
ALTER TABLE companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events     ENABLE ROW LEVEL SECURITY;

-- Helper: get caller's company_id
CREATE OR REPLACE FUNCTION current_company_id()
RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$;

-- RLS Policies
CREATE POLICY "users see own company" ON companies
  FOR SELECT USING (id = current_company_id());

CREATE POLICY "users see own profile" ON profiles
  FOR ALL USING (id = auth.uid());

CREATE POLICY "company assets" ON assets
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company locations" ON asset_locations
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company geofences" ON geofences
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company alert rules" ON alert_rules
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company alert events" ON alert_events
  FOR ALL USING (company_id = current_company_id());

-- Realtime (enable for live map updates)
ALTER PUBLICATION supabase_realtime ADD TABLE asset_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE alert_events;


-- ==================== 002_v2.sql ====================

-- HammerTrack v2: Bluetooth tools, theft alerts, maintenance, QuickBooks
-- Run after 001_initial.sql

-- ── Work hours on companies (for after-hours theft detection) ──────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_start TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_end   TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_days  INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}';

-- ── New alert trigger types ────────────────────────────────────────────────────
-- alert_rules.trigger was CHECK (enter|exit|idle). Widen it.
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_trigger_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_trigger_check
  CHECK (trigger IN ('enter', 'exit', 'idle', 'after_hours_movement', 'left_site'));

-- ── Bluetooth tool associations (which gateway currently "holds" a tool) ────────
CREATE TABLE IF NOT EXISTS tool_associations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tool_asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  gateway_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  rssi            INTEGER,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tool_asset_id)
);
CREATE INDEX IF NOT EXISTS tool_assoc_company_idx ON tool_associations(company_id);
CREATE INDEX IF NOT EXISTS tool_assoc_gateway_idx ON tool_associations(gateway_asset_id);

-- ── Maintenance ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id           UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  interval_type      TEXT NOT NULL CHECK (interval_type IN ('engine_hours', 'mileage', 'days')),
  interval_value     NUMERIC NOT NULL,
  last_service_value NUMERIC NOT NULL DEFAULT 0,
  last_service_date  TIMESTAMPTZ,
  description        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS maint_sched_company_idx ON maintenance_schedules(company_id);

CREATE TABLE IF NOT EXISTS service_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id          UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  service_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cost              NUMERIC NOT NULL DEFAULT 0,
  vendor            TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  odometer_or_hours NUMERIC
);
CREATE INDEX IF NOT EXISTS svc_records_company_idx ON service_records(company_id, service_date DESC);

-- ── QuickBooks Online connection (tokens stored server-side only) ───────────────
CREATE TABLE IF NOT EXISTS qbo_connections (
  company_id    UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  realm_id      TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  company_name  TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS for new tenant tables ────────────────────────────────────────────────────
ALTER TABLE tool_associations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_connections       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company tool associations" ON tool_associations
  FOR ALL USING (company_id = current_company_id());
CREATE POLICY "company maintenance schedules" ON maintenance_schedules
  FOR ALL USING (company_id = current_company_id());
CREATE POLICY "company service records" ON service_records
  FOR ALL USING (company_id = current_company_id());
CREATE POLICY "company qbo connection" ON qbo_connections
  FOR ALL USING (company_id = current_company_id());

-- Realtime for tool associations (live "which truck" updates)
ALTER PUBLICATION supabase_realtime ADD TABLE tool_associations;


-- ==================== 003_signup_policies.sql ====================

-- Let a newly-signed-up user create their own company + profile.
--
-- 001 only created SELECT policies, so the client-side registration inserts
-- (companies + profiles) were blocked by Row Level Security and the new account
-- ended up with no company attached. These INSERT policies allow a user to
-- create exactly the company/profile rows keyed to their own auth id (the app
-- sets companies.id = profiles.id = auth.users.id at signup).

CREATE POLICY "users create own company" ON companies
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "users create own profile" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());


-- ==================== 004_asset_fields.sql ====================

-- Asset categories, serial numbers, and photos.
-- category: free-form grouping ("Dozers", "Pickups", "Crew A") — acts like a folder.
-- serial:   serial / VIN / asset tag.
-- photo_url: link to an asset photo (Supabase Storage or any URL).

ALTER TABLE assets ADD COLUMN IF NOT EXISTS category  TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS serial    TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(company_id, category) WHERE category IS NOT NULL;


-- ==================== 005_geofence_edit.sql ====================

-- Editable geofences + sub-zones.
--
-- 1) parent_id lets a zone nest under a parent site (sub-zones).
-- 2) A security_invoker view exposes geometry as GeoJSON so the app (which works
--    in GeoJSON) can read it directly; RLS on the base table still applies.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES geofences(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS geofences_parent_idx ON geofences(parent_id) WHERE parent_id IS NOT NULL;

CREATE OR REPLACE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  name,
  color,
  parent_id,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;

-- Insert/update a geofence from GeoJSON (the app speaks GeoJSON, the table stores
-- PostGIS). SECURITY INVOKER so the caller's RLS still governs the write.
CREATE OR REPLACE FUNCTION upsert_geofence(
  p_id        UUID,
  p_name      TEXT,
  p_color     TEXT,
  p_geometry  JSONB,
  p_parent_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO geofences (company_id, name, color, parent_id, geometry)
    VALUES (current_company_id(), p_name, p_color, p_parent_id, ST_GeomFromGeoJSON(p_geometry::text))
    RETURNING id INTO v_id;
  ELSE
    UPDATE geofences SET
      name = p_name, color = p_color, parent_id = p_parent_id,
      geometry = ST_GeomFromGeoJSON(p_geometry::text)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;


-- ==================== 006_asset_photos.sql ====================

-- Asset photo storage.
--
-- Photos upload through a server action using the service-role key (which
-- bypasses storage RLS), into a PUBLIC bucket so assets.photo_url can be a
-- plain public URL the <img> tag renders without signed-URL churn.
--
-- No INSERT/UPDATE/DELETE policies are created on storage.objects for this
-- bucket: with none present, anon/authenticated clients cannot write to it —
-- only the server (service role) can. Object paths are namespaced by company:
--   asset-photos/{company_id}/{uuid}.jpg

INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-photos', 'asset-photos', true)
ON CONFLICT (id) DO NOTHING;


-- ==================== 007_asset_costs.sql ====================

-- Per-asset cost structure — the inputs for real job-cost math.
-- All optional; which ones apply varies by asset type (see AssetForm):
--   vehicle:   hourly_rate ($/operating-hr), mileage_rate ($/mi), daily_cost, purchase_value
--   equipment: hourly_rate ($/engine-hr), daily_cost, purchase_value
--   personnel: hourly_rate (loaded labor $/hr)
--   tool:      purchase_value (replacement $)
--
-- daily_cost = ownership that accrues whether or not the asset moves
-- (payment, insurance, depreciation). hourly/mileage accrue from observed
-- activity in asset_locations. The map's cost chip sums these over the
-- selected window — no more demo PROJECT rates on real accounts.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS hourly_rate    NUMERIC CHECK (hourly_rate    >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mileage_rate   NUMERIC CHECK (mileage_rate   >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS daily_cost     NUMERIC CHECK (daily_cost     >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS purchase_value NUMERIC CHECK (purchase_value >= 0);


-- ==================== 008_company_prefs.sql ====================

-- Company preferences: default weather location for the map.
-- NULL = follow the fleet (weather at the most recent asset position).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS weather_place TEXT;

-- Admins update their own company's settings (001 only created SELECT).
-- Scoped to admins via the profiles.role check.
CREATE POLICY "admins update own company" ON companies
  FOR UPDATE USING (
    id = current_company_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ==================== 009_company_contacts.sql ====================

-- Where theft / geofence alerts get delivered. Both optional; if unset the
-- notifier falls back to the ALERT_SMS_TO / ALERT_EMAIL_TO env vars (pilot use).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS alert_phone TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS alert_email TEXT;


-- ==================== 010_teams.sql ====================

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


-- ── 012: named, saveable map views per user ─────────────────────────────────
-- { views: [{id, name, cfg}], defaultId } — layer/style snapshots; defaultId
-- applies on map open. App tolerates the column being absent.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS map_views JSONB;
-- 013: zone kinds — 'site' (job site: usage, invoicing, site log) vs
-- 'boundary' (perimeter: outline-only render, exit/after-hours alerts,
-- excluded from usage metrics). App tolerates this migration being absent.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'site';

-- Widen the upsert RPC (p_kind defaults NULL → keeps kind unchanged on edit,
-- 'site' on create) and expose kind through the GeoJSON view.
CREATE OR REPLACE FUNCTION upsert_geofence(
  p_id        UUID,
  p_name      TEXT,
  p_color     TEXT,
  p_geometry  JSONB,
  p_parent_id UUID DEFAULT NULL,
  p_kind      TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO geofences (company_id, name, color, parent_id, geometry, kind)
    VALUES (current_company_id(), p_name, p_color, p_parent_id,
            ST_GeomFromGeoJSON(p_geometry::text), COALESCE(p_kind, 'site'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE geofences SET
      name = p_name, color = p_color, parent_id = p_parent_id,
      geometry = ST_GeomFromGeoJSON(p_geometry::text),
      kind = COALESCE(p_kind, kind)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  name,
  color,
  parent_id,
  kind,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;
