-- TrackFlow v2: Bluetooth tools, theft alerts, maintenance, QuickBooks
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
