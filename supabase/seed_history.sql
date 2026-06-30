-- Add 24 hours of historical location points per asset (one every 30 min) so the
-- data has real movement going back in time. Run once in Supabase SQL Editor
-- AFTER seed_dillard.sql. The newest (current) point stays on top, so the live
-- map is unchanged — this just fills in history behind it.

WITH co AS (SELECT id FROM companies ORDER BY created_at LIMIT 1),
latest AS (
  SELECT DISTINCT ON (asset_id) asset_id, company_id, lat, lng
  FROM asset_locations
  WHERE company_id = (SELECT id FROM co)
  ORDER BY asset_id, timestamp DESC
)
INSERT INTO asset_locations (asset_id, company_id, lat, lng, speed, heading, battery, timestamp)
SELECT
  l.asset_id,
  l.company_id,
  l.lat + (random() - 0.5) * 0.012,           -- wander ~±650m
  l.lng + (random() - 0.5) * 0.012,
  floor(random() * 45)::int,                    -- speed 0–45 mph
  floor(random() * 360)::int,                   -- heading
  60 + floor(random() * 35)::int,               -- battery 60–95%
  NOW() - (g * interval '30 minutes')           -- back over the last 24h
FROM latest l, generate_series(1, 48) AS g;
