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

-- The pre-013 view has no `kind` column; REPLACE can't insert one mid-list
-- (42P16), so drop and recreate. Views hold no data — this is safe.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
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

-- The pre-013 view has no `kind` column; REPLACE can't insert one mid-list
-- (42P16), so drop and recreate. Views hold no data — this is safe.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
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
-- 014: AI assistant conversation history.
-- Each user keeps their own thread with the assistant; RLS locks rows to
-- their auth id. The app degrades to stateless chat if this table is absent,
-- so running this migration simply "turns memory on".

CREATE TABLE IF NOT EXISTS ai_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id    UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_messages_user_time_idx ON ai_messages(user_id, created_at DESC);

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_messages_own ON ai_messages;
CREATE POLICY ai_messages_own ON ai_messages
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 015: Field ops — time clock, gated daily logs, QR equipment checks.
-- See docs/FIELD-OPS-DESIGN.md for the full design.

-- ── Time clock ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  user_id             UUID NOT NULL,
  person_name         TEXT NOT NULL DEFAULT '',
  -- Where the day is charged. 'project' entries carry the zone.
  category            TEXT NOT NULL DEFAULT 'project'
                      CHECK (category IN ('project', 'shop', 'overhead', 'maintenance')),
  project_geofence_id UUID REFERENCES geofences(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL DEFAULT '',
  clock_in_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS time_entries_company_time_idx ON time_entries(company_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_user_open_idx ON time_entries(user_id) WHERE clock_out_at IS NULL;

-- ── Daily logs (the clock-out toll gate) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL,
  user_id          UUID NOT NULL,
  time_entry_id    UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  log_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  writeup          TEXT NOT NULL DEFAULT '',
  safety           TEXT NOT NULL DEFAULT '',
  trucks_fueled    BOOLEAN,
  equipment_fueled BOOLEAN,
  -- [{url, kind: 'photo' | 'receipt'}]
  photos           JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS daily_logs_company_date_idx ON daily_logs(company_id, log_date DESC);

-- ── QR equipment checks (one tap at the machine) ────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_checks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id    UUID,
  check_type TEXT NOT NULL
             CHECK (check_type IN ('greased', 'fueled', 'radiator_blowout', 'air_filter', 'oil_check', 'washed')),
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS equipment_checks_asset_time_idx ON equipment_checks(asset_id, created_at DESC);

-- Short scannable slug per asset for QR stickers (/t/{slug}).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS qr_slug TEXT;
UPDATE assets SET qr_slug = substr(md5(id::text || 'hammertrack-qr'), 1, 8) WHERE qr_slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_qr_slug_idx ON assets(qr_slug);

-- New assets get a slug automatically.
CREATE OR REPLACE FUNCTION set_asset_qr_slug()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.qr_slug IS NULL THEN
    NEW.qr_slug := substr(md5(NEW.id::text || 'hammertrack-qr'), 1, 8);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assets_qr_slug ON assets;
CREATE TRIGGER assets_qr_slug BEFORE INSERT ON assets
  FOR EACH ROW EXECUTE FUNCTION set_asset_qr_slug();

-- ── RLS (company-scoped, same pattern as 001) ───────────────────────────────
ALTER TABLE time_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company time entries" ON time_entries;
CREATE POLICY "company time entries" ON time_entries
  FOR ALL USING (company_id = current_company_id());

DROP POLICY IF EXISTS "company daily logs" ON daily_logs;
CREATE POLICY "company daily logs" ON daily_logs
  FOR ALL USING (company_id = current_company_id());

DROP POLICY IF EXISTS "company equipment checks" ON equipment_checks;
CREATE POLICY "company equipment checks" ON equipment_checks
  FOR ALL USING (company_id = current_company_id());

-- ── Field photo storage (daily-log photos + receipts) ───────────────────────
-- Same trust model as asset-photos (006): public-read bucket, server-only
-- writes (no client policies; uploads go through a service-role action).
INSERT INTO storage.buckets (id, name, public)
VALUES ('field-photos', 'field-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 016: store GNSS altitude (meters) per fix. The panel already shows live
-- altitude from raw params; this makes elevation queryable and chartable
-- (haul-route profiles, cut/fill context). Ingest writes it from this
-- migration forward — historical rows keep altitude only inside `raw`.

ALTER TABLE asset_locations ADD COLUMN IF NOT EXISTS altitude REAL;

-- 017: receipts inbox — every receipt photo captured in a daily log gets a
-- row here. AI fills vendor/amount/date; a HUMAN approves before anything
-- posts to QuickBooks (the GAAP screens/books boundary, permanently).

CREATE TABLE IF NOT EXISTS receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  user_id             UUID,
  daily_log_id        UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  project_geofence_id UUID,
  url                 TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  vendor              TEXT,
  amount              NUMERIC(12, 2),
  txn_date            DATE,
  category            TEXT,
  note                TEXT,
  qbo_purchase_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS receipts_company_status_idx ON receipts(company_id, status, created_at DESC);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company receipts" ON receipts;
CREATE POLICY "company receipts" ON receipts
  FOR ALL USING (company_id = current_company_id());


-- ── 018_pair_confirmations.sql ──────────────────────────────────────────
-- Who-ran-what confirmations: the foreman's word on top of the GPS guess.
-- The pairing engine (lib/pairing) proposes person↔machine runs from
-- co-movement; a human confirms or rejects each day's pair. Confirmed pairs
-- become payroll/job-cost grade; rejected ones stop showing up.

CREATE TABLE IF NOT EXISTS pair_confirmations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  person_asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  machine_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  decided_by       UUID,
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, day, person_asset_id, machine_asset_id)
);
ALTER TABLE pair_confirmations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS pair_confirmations_day_idx ON pair_confirmations(company_id, day);

DROP POLICY IF EXISTS "company pair confirmations" ON pair_confirmations;
CREATE POLICY "company pair confirmations" ON pair_confirmations
  FOR ALL USING (company_id = current_company_id());

-- ── 019_site_weather.sql ────────────────────────────────────────────────
-- Site weather receipts: one row per job-site zone per day — high/low temp,
-- rain total, max wind. Written nightly by the weather cron (service role);
-- read on the zone page as documentation for rain-delay claims.

CREATE TABLE IF NOT EXISTS site_weather (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  temp_hi     REAL,
  temp_lo     REAL,
  rain_in     REAL,
  wind_max    REAL,
  code        INT,
  source      TEXT NOT NULL DEFAULT 'model',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (geofence_id, day)
);
ALTER TABLE site_weather ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS site_weather_zone_idx ON site_weather(geofence_id, day DESC);

-- Members read their company's log; the nightly cron writes with the
-- service role (bypasses RLS), so no insert policy is needed.
DROP POLICY IF EXISTS "company site weather" ON site_weather;
CREATE POLICY "company site weather" ON site_weather
  FOR SELECT USING (company_id = current_company_id());
