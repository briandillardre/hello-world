-- Migrations 132 + 133 under the roles that will actually hit them. Run by
-- run.sh after setup.sql + 132 (twice) + pre133.sql + 133 (twice). Prints one
-- line per failure and a tally.
SET client_min_messages = warning;

CREATE TABLE t_results (name TEXT, ok BOOLEAN, got TEXT);
CREATE FUNCTION t_ok(p_name text, p_ok boolean, p_got text DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO t_results VALUES (p_name, COALESCE(p_ok, false), p_got) $$;
-- Run one statement as a signed-in API role and return its first value (or
-- 'ERROR <sqlstate>'). The role switch is local to the call.
CREATE FUNCTION t_as(p_uid uuid, p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERROR ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN r;
END $$;

-- ── The fleet ───────────────────────────────────────────────────────────────
INSERT INTO companies VALUES ('a0000000-0000-0000-0000-000000000000', 'Company A'), ('b0000000-0000-0000-0000-000000000000', 'Company B');
INSERT INTO auth.users VALUES
  ('a0000000-0000-0000-0000-000000000000'), ('a1000000-0000-0000-0000-000000000000'), ('a2000000-0000-0000-0000-000000000000'),
  ('a3000000-0000-0000-0000-000000000000'), ('a4000000-0000-0000-0000-000000000000'), ('b0000000-0000-0000-0000-000000000000');
INSERT INTO profiles VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'admin'),   -- A's Master
  ('a1000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'admin'),
  ('a2000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'associate'),
  ('a3000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'prospect'),
  ('a4000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'foreman'),
  ('b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'admin');   -- B's Master
INSERT INTO assets VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000000', 'Generator', 'tool', '{}'),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000000', 'Owner tag', 'tool', '{"visibility":"master"}'),
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000000', 'Cut-off saw', 'tool', '{}'),
  ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000000', 'Sam (phone)', 'personnel', '{}'),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000000', 'B saw', 'tool', '{}');
INSERT INTO geofences (id, company_id, name, geometry, kind) VALUES
  ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'Union hall', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 'boundary'),
  ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000000', 'Creekside', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 'site'),
  ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-000000000000', 'Clinic', '{"type":"Polygon","coordinates":[[[2,2],[3,2],[3,3],[2,2]]]}', 'boundary');

-- ── The view ────────────────────────────────────────────────────────────────
SELECT t_ok('view: privacy_zone is the LAST column, after division_id',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'geofences_json') LIKE '%,division_id,privacy_zone',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'geofences_json'));
SELECT t_ok('view: still security_invoker',
  (SELECT reloptions::text FROM pg_class WHERE relname = 'geofences_json') LIKE '%security_invoker=true%',
  (SELECT reloptions::text FROM pg_class WHERE relname = 'geofences_json'));
SELECT t_ok('view: grants kept (a member still reads it)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM geofences_json') = '3',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM geofences_json'));
SELECT t_ok('view: every zone starts not private',
  (SELECT bool_and(NOT privacy_zone) FROM geofences_json));

-- ── Only the server sets the flag ───────────────────────────────────────────
SELECT t_ok('flag: a member cannot turn a zone private through the API',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET privacy_zone = true WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET privacy_zone = true WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$));
SELECT t_ok('flag: nor create one private',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$INSERT INTO geofences (company_id, name, geometry, kind, privacy_zone) VALUES ('a0000000-0000-0000-0000-000000000000', 'x', '{}', 'boundary', true) RETURNING 'inserted'$$) = 'ERROR 42501');
SELECT t_ok('flag: other zone edits still work for a member',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET notes = 'gate 4188' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('flag: a new zone (not private) still inserts for a member',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$INSERT INTO geofences (company_id, name, geometry, kind) VALUES ('a0000000-0000-0000-0000-000000000000', 'New site', '{}', 'site') RETURNING 'inserted'$$) = 'inserted');
SELECT t_ok('flag: the service role sets it',
  t_as(NULL, 'service_role',
    $$UPDATE geofences SET privacy_zone = true WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('flag: and a member reads it through the view',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT privacy_zone::text FROM geofences_json WHERE id = 'a0000000-0000-0000-0000-00000000000b'$$) = 'true');
SELECT t_ok('flag: a member cannot turn it back off either',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET privacy_zone = false WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');

-- ── 133: a private zone stays one ──────────────────────────────────────────
-- Union hall (b) is private now. Crew and a Foreman may still rename it, but
-- not redraw, re-kind, re-own or delete it; Admins and the server may.
SELECT t_ok('guard: a member still renames a private zone',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET name = 'Union hall (Local 12)', notes = 'side gate' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('guard: a zone save that re-sends the same outline, kind and owner is a rename',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET geometry = geometry, kind = kind, owner_id = owner_id WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('guard: … and so is the outline coming back a hair off (GeoJSON''s 9 decimals)',
  t_as('a4000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET geometry = '{"type":"Polygon","coordinates":[[[0.0000000001,0],[1,0],[1,1],[0.0000000001,0]]]}' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('guard: crew cannot redraw a private zone',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET geometry = '{"type":"Polygon","coordinates":[[[5,5],[6,5],[6,6],[5,5]]]}' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');
SELECT t_ok('guard: nor a Foreman (rank 1)',
  t_as('a4000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET geometry = '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,0.5],[0,0]]]}' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');
SELECT t_ok('guard: crew cannot turn a private zone into a site (the flag would go inert)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET kind = 'site' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');
SELECT t_ok('guard: crew cannot make a private zone their own personal one',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET owner_id = 'a2000000-0000-0000-0000-000000000000' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');
SELECT t_ok('guard: a Foreman cannot delete a private zone',
  t_as('a4000000-0000-0000-0000-000000000000', 'authenticated',
    $$DELETE FROM geofences WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'deleted'$$) = 'ERROR 42501');
SELECT t_ok('guard: the zone is still private, a boundary and company-wide after all that',
  (SELECT privacy_zone AND kind = 'boundary' AND owner_id IS NULL FROM geofences WHERE id = 'a0000000-0000-0000-0000-00000000000b'));
SELECT t_ok('guard: crew still delete an ordinary zone',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$DELETE FROM geofences WHERE name = 'New site' RETURNING 'deleted'$$) = 'deleted');
SELECT t_ok('guard: an Admin redraws a private zone',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET geometry = '{"type":"Polygon","coordinates":[[[0,0],[1.2,0],[1.2,1],[0,0]]]}' WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('guard: … but still cannot flip the flag through the API',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$UPDATE geofences SET privacy_zone = false WHERE id = 'a0000000-0000-0000-0000-00000000000b' RETURNING 'updated'$$) = 'ERROR 42501');
SELECT t_ok('guard: the server marks the clinic private',
  t_as(NULL, 'service_role',
    $$UPDATE geofences SET privacy_zone = true WHERE id = 'a0000000-0000-0000-0000-00000000000d' RETURNING 'updated'$$) = 'updated');
SELECT t_ok('guard: an Admin deletes a private zone',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$DELETE FROM geofences WHERE id = 'a0000000-0000-0000-0000-00000000000d' RETURNING 'deleted'$$) = 'deleted');
SELECT t_ok('guard: the server may too',
  t_as(NULL, 'service_role',
    $$INSERT INTO geofences (company_id, name, geometry, kind, privacy_zone) VALUES ('a0000000-0000-0000-0000-000000000000', 'Temp', '{}', 'boundary', true) RETURNING 'inserted'$$) = 'inserted'
  AND t_as(NULL, 'service_role', $$DELETE FROM geofences WHERE name = 'Temp' RETURNING 'deleted'$$) = 'deleted');

-- ── tool_sightings ──────────────────────────────────────────────────────────
INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 34.851, -82.401, 250, 'off_shift', now() - interval '1 hour', now(), 0),
  -- heard by the owner's owner-only phone: owner eyes only
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 34.861, -82.411, 250, 'off_shift', now() - interval '2 hours', now(), 4),
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a2', 34.851, -82.401, 250, 'off_shift', now() - interval '1 hour', now(), 0),
  ('b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000b1', 32.78, -79.93, NULL, 'recovery', now(), now(), 3);
SELECT t_ok('sightings: a member reads their company''s (not the owner-only tag''s)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings') = '1',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings'));
SELECT t_ok('sightings: the Master reads all three of A''s, none of B''s',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings') = '3');
SELECT t_ok('sightings: what the owner''s owner-only phone heard is hidden from an Admin',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings WHERE tool_asset_id = ''a0000000-0000-0000-0000-0000000000a1''') = '1',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings WHERE tool_asset_id = ''a0000000-0000-0000-0000-0000000000a1'''));
SELECT t_ok('sightings: the level must be on the ladder',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 250, 'off_shift', now(), now(), 5) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('sightings: a Prospective Client reads none',
  t_as('a3000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM tool_sightings') = '0');
SELECT t_ok('sightings: anon reads nothing at all',
  t_as(NULL, 'anon', 'SELECT count(*)::text FROM tool_sightings') LIKE 'ERROR%');
SELECT t_ok('sightings: a member cannot write one',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 250, 'off_shift', now(), now()) RETURNING 'inserted'$$) LIKE 'ERROR%');
SELECT t_ok('sightings: nor move one',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', $$UPDATE tool_sightings SET lat = 0 RETURNING 'updated'$$) LIKE 'ERROR%');
SELECT t_ok('sightings: an exact spot only for a recovery',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, NULL, 'off_shift', now(), now()) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('sightings: and a recovery is never blurred',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 250, 'recovery', now(), now()) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('sightings: the service role writes',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 300, 'privacy_zone', now(), now()) RETURNING 'inserted'$$) = 'inserted');

-- ── 133: sightings ──────────────────────────────────────────────────────────
SELECT t_ok('133 cleanup: a privacy-zone row finer than the 250 m grid is gone',
  NOT EXISTS (SELECT 1 FROM tool_sightings WHERE id = 'c1000000-0000-0000-0000-000000000001'));
SELECT t_ok('133 cleanup: an honest privacy-zone row (≥ 250 m) and the grid row are kept',
  (SELECT count(*) FROM tool_sightings WHERE id IN ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004')) = 2);
SELECT t_ok('133 cleanup: a recovery spot stored at the crew''s level is raised to Admins',
  (SELECT visible_rank FROM tool_sightings WHERE id = 'c1000000-0000-0000-0000-000000000003') = 3);
SELECT t_ok('rough: a privacy-zone row finer than 250 m is refused',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 120, 'privacy_zone', now(), now()) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('rough: so is an off-the-clock row finer than the grid',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 100, 'off_shift', now(), now()) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('rough: nor can a row be moved finer later',
  t_as(NULL, 'service_role', $$UPDATE tool_sightings SET precision_m = 40 WHERE reason = 'privacy_zone' RETURNING 'updated'$$) = 'ERROR 23514');
SELECT t_ok('recovery rank: an exact spot the crew could read is refused',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, NULL, 'recovery', now(), now(), 0) RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('recovery rank: at Admins it is written',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, NULL, 'recovery', now(), now(), 3) RETURNING 'inserted'$$) = 'inserted');
SELECT t_ok('recovery rank: crew do not read the exact spot, an Admin does',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', $$SELECT count(*)::text FROM tool_sightings WHERE reason = 'recovery'$$) = '0'
  AND t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', $$SELECT count(*)::text FROM tool_sightings WHERE reason = 'recovery'$$) = '1');
SELECT t_ok('place_since: a move is stamped inside the row''s span',
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, place_since) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 250, 'off_shift', now() - interval '1 hour', now(), now() - interval '2 hours') RETURNING 'inserted'$$) = 'ERROR 23514'
  AND t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, place_since) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 250, 'off_shift', now() - interval '1 hour', now(), now() - interval '5 minutes') RETURNING 'inserted'$$) = 'inserted');

-- The newest row per tool, under the caller's own RLS (the map's read).
INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a3', 10, 10, 250, 'off_shift', now() - interval '4 hours', now() - interval '3 hours', 0),
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a3', 11, 11, 250, 'off_shift', now() - interval '2 hours', now() - interval '1 hour', 0),
  -- heard by the owner's owner-only phone, newest of all
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a3', 12, 12, 250, 'off_shift', now() - interval '40 minutes', now() - interval '30 minutes', 4);
SELECT t_ok('latest: crew get the newest row THEY may read (not the owner-only one)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT lat::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4) WHERE tool_asset_id = 'a0000000-0000-0000-0000-0000000000a3'$$) = '11',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT lat::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4) WHERE tool_asset_id = 'a0000000-0000-0000-0000-0000000000a3'$$));
SELECT t_ok('latest: the owner gets the owner-only one',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT lat::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4) WHERE tool_asset_id = 'a0000000-0000-0000-0000-0000000000a3'$$) = '12');
SELECT t_ok('latest: the owner previewing the crew (rank 0) gets the crew''s',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT lat::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 0) WHERE tool_asset_id = 'a0000000-0000-0000-0000-0000000000a3'$$) = '11');
SELECT t_ok('latest: one row per tool, every tool the owner can see',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT (count(*) = count(DISTINCT tool_asset_id) AND count(*) = 3)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4)$$) = 'true',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT count(*)::text || '/' || count(DISTINCT tool_asset_id)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4)$$));
SELECT t_ok('latest: the window holds (nothing of the saw in the last 10 min)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT count(*)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '10 minutes', 4) WHERE tool_asset_id = 'a0000000-0000-0000-0000-0000000000a3'$$) = '0');
SELECT t_ok('latest: another company''s caller reads none of A''s',
  t_as('b0000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT count(*)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4)$$) = '0');
SELECT t_ok('latest: a Prospective Client reads none',
  t_as('a3000000-0000-0000-0000-000000000000', 'authenticated',
    $$SELECT count(*)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4)$$) = '0');
SELECT t_ok('latest: anon cannot call it',
  t_as(NULL, 'anon', $$SELECT count(*)::text FROM ht_tool_sightings_latest('a0000000-0000-0000-0000-000000000000', now() - interval '30 days', 4)$$) LIKE 'ERROR%');

-- ── asset_recovery ──────────────────────────────────────────────────────────
INSERT INTO asset_recovery (company_id, asset_id, started_by, reason, expires_at) VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000000', 'Left the yard overnight', now() + interval '7 days');
SELECT t_ok('recovery: one open recovery per asset',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 'again', now() + interval '7 days') RETURNING 'inserted'$$) = 'ERROR 23505');
SELECT t_ok('recovery: stopping it closes the open row',
  t_as(NULL, 'service_role', $$UPDATE asset_recovery SET ended_at = now() WHERE ended_at IS NULL RETURNING 'updated'$$) = 'updated');
SELECT t_ok('recovery: a closed one makes room for the next',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 'Seen at the pawn shop', now() + interval '7 days') RETURNING 'inserted'$$) = 'inserted');
SELECT t_ok('recovery: crew read their company''s',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery') = '2');
SELECT t_ok('recovery: other companies read none of it',
  t_as('b0000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery') = '0');
SELECT t_ok('recovery: a Prospective Client reads none',
  t_as('a3000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery') = '0');
SELECT t_ok('recovery: an Admin cannot start one through the API (server action only)',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated',
    $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a2', 'xyz', now() + interval '7 days') RETURNING 'inserted'$$) LIKE 'ERROR%');
SELECT t_ok('recovery: nor end one',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', $$UPDATE asset_recovery SET ended_at = now() RETURNING 'updated'$$) LIKE 'ERROR%');
SELECT t_ok('recovery: a reason is required',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a2', '', now() + interval '7 days') RETURNING 'inserted'$$) = 'ERROR 23514');
INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a2', 'Owner tag missing', now() + interval '7 days');
SELECT t_ok('recovery: an owner-only asset''s recovery is hidden below the owner (111)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery') = '2'
  AND t_as('a0000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery') = '3');

-- ── 133: recovery ───────────────────────────────────────────────────────────
SELECT t_ok('reason: crew cannot read why a recovery was started',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT reason FROM asset_recovery LIMIT 1') = 'ERROR 42501');
SELECT t_ok('reason: nor anyone through the API (the server reads it for Admins and the owner)',
  t_as('a0000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT reason FROM asset_recovery LIMIT 1') = 'ERROR 42501');
SELECT t_ok('reason: a select-everything read is refused too (the app names its columns)',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM (SELECT * FROM asset_recovery) r') = 'ERROR 42501');
SELECT t_ok('reason: every other column still reads',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    'SELECT count(started_at)::text || count(expires_at)::text || count(asset_id)::text || count(alert_event_id)::text FROM asset_recovery WHERE ended_at IS NULL') = '1110',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated',
    'SELECT count(started_at)::text || count(expires_at)::text || count(asset_id)::text || count(alert_event_id)::text FROM asset_recovery WHERE ended_at IS NULL'));
SELECT t_ok('reason: the service role reads it',
  t_as(NULL, 'service_role', $$SELECT reason FROM asset_recovery WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL$$) = 'Seen at the pawn shop');
SELECT t_ok('30 days: a recovery cannot be started for longer',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a3', 'gone', now() + interval '31 days') RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('30 days: extending up to 30 days from the start is fine',
  t_as(NULL, 'service_role', $$UPDATE asset_recovery SET expires_at = started_at + interval '30 days' WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL RETURNING 'updated'$$) = 'updated');
SELECT t_ok('30 days: past it is refused',
  t_as(NULL, 'service_role', $$UPDATE asset_recovery SET expires_at = started_at + interval '31 days' WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL RETURNING 'updated'$$) = 'ERROR 23514');
SELECT t_ok('people: a person (personnel asset) is never put in recovery',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery (company_id, asset_id, reason, expires_at) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000f1', 'where is Sam', now() + interval '7 days') RETURNING 'inserted'$$) = 'ERROR 23514');
SELECT t_ok('extensions: the server records one',
  t_as(NULL, 'service_role', $$INSERT INTO asset_recovery_extensions (recovery_id, company_id, asset_id, extended_by, expires_before, expires_after)
    SELECT id, company_id, asset_id, 'a1000000-0000-0000-0000-000000000000', now() + interval '1 day', now() + interval '7 days'
    FROM asset_recovery WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL RETURNING 'inserted'$$) = 'inserted');
SELECT t_ok('extensions: nobody rewrites one — not even the server',
  t_as(NULL, 'service_role', $$UPDATE asset_recovery_extensions SET expires_after = now() + interval '20 days' RETURNING 'updated'$$) = 'ERROR 42501'
  AND t_as(NULL, 'service_role', $$DELETE FROM asset_recovery_extensions RETURNING 'deleted'$$) = 'ERROR 42501');
SELECT t_ok('extensions: a member cannot write one',
  t_as('a1000000-0000-0000-0000-000000000000', 'authenticated', $$INSERT INTO asset_recovery_extensions (recovery_id, company_id, asset_id, expires_before, expires_after)
    SELECT id, company_id, asset_id, now(), now() + interval '7 days' FROM asset_recovery WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL RETURNING 'inserted'$$) LIKE 'ERROR%');
SELECT t_ok('extensions: the company reads them; another company, a prospect and anon do not',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery_extensions') = '1'
  AND t_as('b0000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery_extensions') = '0'
  AND t_as('a3000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM asset_recovery_extensions') = '0'
  AND t_as(NULL, 'anon', 'SELECT count(*)::text FROM asset_recovery_extensions') LIKE 'ERROR%');
SELECT t_ok('extensions: a recovery with extensions can still be deleted by the server',
  t_as(NULL, 'service_role', $$DELETE FROM asset_recovery WHERE asset_id = 'a0000000-0000-0000-0000-0000000000a1' AND ended_at IS NULL RETURNING 'deleted'$$) = 'deleted');
SELECT t_ok('extensions: … and they go with it (the cascade runs as the table owner)',
  (SELECT count(*) FROM asset_recovery_extensions) = 0);

SELECT 'FAIL ' || name || COALESCE(' — got ' || got, '') FROM t_results WHERE NOT ok;
SELECT 'privacy-sql: ' || count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' FROM t_results;
