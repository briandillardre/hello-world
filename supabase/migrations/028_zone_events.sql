-- Zone change history — who changed a zone, when, and what. Redrawing a
-- boundary silently shifts "hours on site" and acreage, so a report can look
-- wrong for no visible reason; this log makes every change explainable and
-- accountable, shown as a timeline on the zone's page.

CREATE TABLE IF NOT EXISTS zone_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  user_id      UUID,                 -- who did it (NULL = system)
  action       TEXT NOT NULL,        -- 'created' | 'edited' | 'reshaped' | 'archived' | 'reactivated'
  detail       JSONB,                -- { changed: ['name','boundary',...], from:{}, to:{} }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zone_events_geofence_idx ON zone_events(geofence_id, created_at DESC);

ALTER TABLE zone_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company zone events" ON zone_events
  FOR ALL USING (company_id = current_company_id());
