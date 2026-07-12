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
