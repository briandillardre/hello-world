-- 052: per-zone site imagery timeline (Brian flies a Mavic Air 2 daily).
--
-- Dated aerial/progress photos attached to a zone — the job's visual
-- evidence locker: before/after, weekly earthwork progress, closeout-binder
-- and pay-app proof. v1 is a dated viewer with a time slider on the zone
-- page; true georeferenced map overlays (orthomosaics with bounds) are the
-- recorded next step, and the SkyFi "order a satellite shot" button rides
-- this same table later (source column below).

CREATE TABLE IF NOT EXISTS zone_imagery (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  taken_on     DATE NOT NULL,
  caption      TEXT,
  source       TEXT NOT NULL DEFAULT 'drone' CHECK (source IN ('drone','aerial','satellite','ground')),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zone_imagery_zone_idx ON zone_imagery(geofence_id, taken_on DESC);

ALTER TABLE zone_imagery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company zone imagery" ON zone_imagery;
CREATE POLICY "company zone imagery" ON zone_imagery
  FOR ALL USING (company_id = current_company_id());
