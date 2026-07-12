-- ─────────────────────────────────────────────────────────────────────────────
-- HammerTrack catch-up script: migrations 013 + 014 + 015 in one paste.
-- Safe to re-run (everything is IF NOT EXISTS / OR REPLACE / DROP-recreate).
-- Paste the WHOLE file into the Supabase SQL Editor and hit Run once.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ── Verify: every row should read TRUE ───────────────────────────────────────
select 'zone kinds (013)' as item, exists(select from information_schema.columns where table_name='geofences' and column_name='kind') as done
union all select 'ai_messages (014)', exists(select from information_schema.tables where table_name='ai_messages')
union all select 'time clock (015)', exists(select from information_schema.tables where table_name='time_entries')
union all select 'field-photos bucket (015)', exists(select from storage.buckets where id='field-photos')
union all select 'asset QR slugs (015)', exists(select from information_schema.columns where table_name='assets' and column_name='qr_slug');
