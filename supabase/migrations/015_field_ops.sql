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
