-- Seed maintenance schedules + service history for the seeded fleet.
-- Run once in Supabase SQL Editor (after seed_dillard.sql). Matches assets by tracker_id.

WITH co AS (SELECT id FROM companies ORDER BY created_at LIMIT 1),
ax AS (SELECT id, tracker_id FROM assets WHERE company_id = (SELECT id FROM co))
INSERT INTO maintenance_schedules (company_id, asset_id, interval_type, interval_value, last_service_value, last_service_date, description)
SELECT (SELECT id FROM co), ax.id, m.interval_type, m.interval_value, m.last_service_value,
       NOW() - m.days_ago * interval '1 day', m.description
FROM ax JOIN (VALUES
  ('gps-002', 'engine_hours', 250,  1180,  40, 'Hydraulic fluid & filter service'),
  ('obd-001', 'mileage',      5000, 38000, 70, 'Oil change & tire rotation'),
  ('gps-009', 'engine_hours', 500,  2100, 120, 'Annual inspection & greasing'),
  ('obd-006', 'mileage',      5000, 41000, 30, 'Oil change & brake check')
) AS m(tracker_id, interval_type, interval_value, last_service_value, days_ago, description)
  ON m.tracker_id = ax.tracker_id;

WITH co AS (SELECT id FROM companies ORDER BY created_at LIMIT 1),
ax AS (SELECT id, tracker_id FROM assets WHERE company_id = (SELECT id FROM co))
INSERT INTO service_records (company_id, asset_id, service_date, cost, vendor, notes, odometer_or_hours)
SELECT (SELECT id FROM co), ax.id, NOW() - s.days_ago * interval '1 day', s.cost, s.vendor, s.notes, s.reading
FROM ax JOIN (VALUES
  ('gps-002', 40,  845.50,  'Music City Equipment Repair', 'Replaced hydraulic filter, topped fluid.', 1180),
  ('obd-001', 70,  189.99,  'Quick Lube Plus',             'Synthetic oil change, rotated tires.',     38000),
  ('gps-009', 120, 1240.00, 'Deere Authorized Service',    'Annual inspection, replaced worn hoses.',  2100)
) AS s(tracker_id, days_ago, cost, vendor, notes, reading)
  ON s.tracker_id = ax.tracker_id;
