-- 101 · Field photos (Brian, Sep 9 2026: "a separate option within the app to
-- take photos or add photos which are geotagged as a layer on the map — we
-- really like how Google Photos' map does this, heatmap when zoomed out, the
-- pictures when zoomed in to a site").
--
-- ONE index of every job photo that knows where it was taken: shot from the
-- map's camera button, or attached to a daily log (the log's phone fix). The
-- map's Photos layer, the /photos page and the Agent Interface all read this
-- table — never the daily_logs JSON again.
CREATE TABLE IF NOT EXISTS field_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID,                                   -- who took it
  source       TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera', 'daily_log', 'import')),
  source_id    UUID,                                   -- daily_logs.id when source = 'daily_log'
  geofence_id  UUID REFERENCES geofences(id) ON DELETE SET NULL,  -- the site/yard it was taken on
  url          TEXT NOT NULL UNIQUE,                   -- full-size, field-photos bucket
  thumb_url    TEXT,                                   -- ~320 px, drawn on the map
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  accuracy_m   REAL,
  heading      REAL,                                   -- compass heading if the device gave one
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  caption      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS field_photos_company_taken_idx ON field_photos (company_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS field_photos_zone_idx ON field_photos (company_id, geofence_id, taken_at DESC);

ALTER TABLE field_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "field photos: read company" ON field_photos;
DROP POLICY IF EXISTS "field photos: insert own" ON field_photos;
DROP POLICY IF EXISTS "field photos: update own" ON field_photos;
DROP POLICY IF EXISTS "field photos: delete own" ON field_photos;
CREATE POLICY "field photos: read company" ON field_photos
  FOR SELECT USING (company_id = current_company_id());
CREATE POLICY "field photos: insert own" ON field_photos
  FOR INSERT WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());
CREATE POLICY "field photos: update own" ON field_photos
  FOR UPDATE USING (company_id = current_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());
CREATE POLICY "field photos: delete own" ON field_photos
  FOR DELETE USING (company_id = current_company_id() AND user_id = auth.uid());

-- Backfill: every daily-log photo whose log carried the phone's fix (059)
-- becomes a pin, filed under the site the shift was clocked into. Receipt
-- photos stay out — they belong to the Receipts layer.
INSERT INTO field_photos (company_id, user_id, source, source_id, geofence_id, url, lat, lng, taken_at, created_at)
SELECT dl.company_id, dl.user_id, 'daily_log', dl.id, te.project_geofence_id,
       ph->>'url', dl.lat, dl.lng, dl.created_at, dl.created_at
FROM daily_logs dl
LEFT JOIN time_entries te ON te.id = dl.time_entry_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dl.photos, '[]'::jsonb)) AS ph
WHERE dl.lat IS NOT NULL AND dl.lng IS NOT NULL
  AND COALESCE(ph->>'kind', 'photo') = 'photo'
  AND COALESCE(ph->>'url', '') <> ''
ON CONFLICT (url) DO NOTHING;
