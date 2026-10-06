-- Rows 132's first code could have written, BEFORE 133 runs: 133 must clean
-- them up (a privacy-zone sighting finer than the 250 m grid goes; a
-- recovery's exact spot is raised to Admins) and keep the honest ones.
-- Company C is used by nothing else in checks.sql.
SET client_min_messages = warning;
INSERT INTO companies VALUES ('c0000000-0000-0000-0000-000000000000', 'Company C');
INSERT INTO assets VALUES ('c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000000', 'Trailer', 'tool', '{}');
INSERT INTO tool_sightings (id, company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES
  -- a house lot's exact centre ±25 m: the leak 133 removes
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000c1', 34.85, -82.4, 25, 'privacy_zone', now() - interval '2 hours', now() - interval '1 hour', 0),
  -- a big zone's honest roughness: kept
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000c1', 34.86, -82.41, 400, 'privacy_zone', now() - interval '2 hours', now() - interval '1 hour', 0),
  -- a recovery's exact spot at the crew's level: raised to Admins
  ('c1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000c1', 34.87, -82.42, NULL, 'recovery', now() - interval '2 hours', now() - interval '1 hour', 0),
  -- the off-the-clock grid: kept as it is
  ('c1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-0000000000c1', 34.88, -82.43, 250, 'off_shift', now() - interval '2 hours', now() - interval '1 hour', 0);
