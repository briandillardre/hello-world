-- Seed a starter fleet for Dillard Construction Group so the live map is populated.
-- Safe to run once in the Supabase SQL Editor (it bypasses RLS as the table owner).
-- These are placeholder assets at a Nashville job site — delete them or let your
-- real FMM00A trackers replace them once hardware is online.
--
-- Re-runnable: assets use ON CONFLICT (company_id, tracker_id) DO NOTHING, so a
-- second run won't create duplicates.

WITH co AS (
  SELECT id FROM companies ORDER BY created_at LIMIT 1
),
ins AS (
  INSERT INTO assets (company_id, name, type, tracker_id, metadata)
  SELECT co.id, a.name, a.type, a.tracker_id, a.metadata
  FROM co, (VALUES
    ('F-350 Truck #1',       'vehicle',   'obd-001', '{"make":"Ford","model":"F-350","year":2022,"license":"TN-ACM-001"}'::jsonb),
    ('CAT 336 Excavator',    'equipment', 'gps-002', '{"make":"Caterpillar","model":"336","year":2020}'::jsonb),
    ('John Martinez',        'personnel', 'bt-003',  '{"role":"Foreman","phone":"615-555-0103"}'::jsonb),
    ('Drill Kit Set A',      'tool',      'bt-004',  '{"contents":"Milwaukee drill set","value":1200}'::jsonb),
    ('Concrete Mixer M200',  'equipment', 'gps-005', '{"make":"Multiquip","model":"MC94PH","capacity":"9 cu ft"}'::jsonb),
    ('Ram 2500 #2',          'vehicle',   'obd-006', '{"make":"Ram","model":"2500","year":2023,"license":"TN-ACM-002"}'::jsonb),
    ('Sarah Chen',           'personnel', 'bt-007',  '{"role":"Site Engineer","phone":"615-555-0107"}'::jsonb),
    ('Level & Survey Kit B', 'tool',      'bt-008',  '{"contents":"Laser level, tripod, measuring tools","value":850}'::jsonb),
    ('JD 310L Backhoe',      'equipment', 'gps-009', '{"make":"John Deere","model":"310L","year":2021}'::jsonb),
    ('Silverado 1500 #3',    'vehicle',   'obd-010', '{"make":"Chevrolet","model":"Silverado 1500","year":2021,"license":"TN-ACM-003"}'::jsonb)
  ) AS a(name, type, tracker_id, metadata)
  ON CONFLICT (company_id, tracker_id) DO NOTHING
  RETURNING id, company_id, tracker_id
)
INSERT INTO asset_locations (asset_id, company_id, lat, lng, accuracy, battery, speed, heading, timestamp)
SELECT ins.id, ins.company_id, l.lat, l.lng, l.accuracy, l.battery, l.speed, l.heading,
       NOW() - l.mins * interval '1 minute'
FROM ins
JOIN (VALUES
  ('obd-001', 36.1627, -86.7816, 5,  88,   0,   0,  12),
  ('gps-002', 36.1650, -86.7800, 8,  42,   0,   0, 240),
  ('bt-003',  36.1610, -86.7830, 10, 71,   0,   0,   3),
  ('bt-004',  36.1640, -86.7790, 15, 31,   0,   0,  47),
  ('gps-005', 36.1620, -86.7850, 6,  NULL, 0,   0, 120),
  ('obd-006', 36.1660, -86.7780, 4,  95,  45, 270,   2),
  ('bt-007',  36.1635, -86.7820, 12, 56,   0,   0,   8),
  ('bt-008',  36.1655, -86.7810, 20, 62,   0,   0,  90),
  ('gps-009', 36.1615, -86.7770, 7,  78,   0,   0,  30),
  ('obd-010', 36.1645, -86.7840, 5,  83,   0,   0,  18)
) AS l(tracker_id, lat, lng, accuracy, battery, speed, heading, mins)
  ON l.tracker_id = ins.tracker_id;

-- Three job-site geofences
INSERT INTO geofences (company_id, name, geometry, color)
SELECT (SELECT id FROM companies ORDER BY created_at LIMIT 1), g.name,
       ST_GeomFromText(g.wkt, 4326), g.color
FROM (VALUES
  ('Riverfront Tower', 'POLYGON((-86.7862 36.1602, -86.7813 36.1602, -86.7813 36.1652, -86.7862 36.1652, -86.7862 36.1602))', '#ff9e16'),
  ('Maple St Grading', 'POLYGON((-86.7811 36.1605, -86.7762 36.1605, -86.7762 36.1668, -86.7811 36.1668, -86.7811 36.1605))', '#2dd4bf'),
  ('Equipment Yard',   'POLYGON((-86.7788 36.1656, -86.7768 36.1656, -86.7768 36.1667, -86.7788 36.1667, -86.7788 36.1656))', '#60a5fa')
) AS g(name, wkt, color);
