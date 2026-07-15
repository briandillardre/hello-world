-- Multiple labeled photos per asset (truck shot, GVWR sticker, VIN plate,
-- engine bay, damage/issues, …). `assets.photo_url` stays the single "hero"
-- image the map panel + list thumbnails read; this table holds the full set.
-- The first photo added becomes the hero when none is set yet.

CREATE TABLE IF NOT EXISTS asset_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  label       TEXT,                       -- 'truck' | 'gvwr' | 'vin' | 'engine' | 'issue' | free text
  sort        INTEGER NOT NULL DEFAULT 0, -- display order (hero first)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_photos_asset_idx ON asset_photos(asset_id, sort);

ALTER TABLE asset_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company asset photos" ON asset_photos
  FOR ALL USING (company_id = current_company_id());
