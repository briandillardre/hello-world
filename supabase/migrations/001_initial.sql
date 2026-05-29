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
