-- Migration 132 under the roles that will actually hit it. Run by run.sh
-- after setup.sql + 132 (twice). Prints one line per failure and a tally.
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
  ('a3000000-0000-0000-0000-000000000000'), ('b0000000-0000-0000-0000-000000000000');
INSERT INTO profiles VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'admin'),   -- A's Master
  ('a1000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'admin'),
  ('a2000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'associate'),
  ('a3000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'prospect'),
  ('b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'admin');   -- B's Master
INSERT INTO assets VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000000', 'Generator', 'tool', '{}'),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000000', 'Owner tag', 'tool', '{"visibility":"master"}'),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000000', 'B saw', 'tool', '{}');
INSERT INTO geofences (id, company_id, name, geometry, kind) VALUES
  ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'Union hall', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 'boundary'),
  ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000000', 'Creekside', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 'site');

-- ── The view ────────────────────────────────────────────────────────────────
SELECT t_ok('view: privacy_zone is the LAST column, after division_id',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'geofences_json') LIKE '%,division_id,privacy_zone',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'geofences_json'));
SELECT t_ok('view: still security_invoker',
  (SELECT reloptions::text FROM pg_class WHERE relname = 'geofences_json') LIKE '%security_invoker=true%',
  (SELECT reloptions::text FROM pg_class WHERE relname = 'geofences_json'));
SELECT t_ok('view: grants kept (a member still reads it)',
  t_as('a2000000-0000-0000-0000-000000000000', 'authenticated', 'SELECT count(*)::text FROM geofences_json') = '2',
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

-- ── tool_sightings ──────────────────────────────────────────────────────────
INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen, visible_rank) VALUES
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 34.851, -82.401, 250, 'off_shift', now() - interval '1 hour', now(), 0),
  -- heard by the owner's owner-only phone: owner eyes only
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 34.861, -82.411, 250, 'off_shift', now() - interval '2 hours', now(), 4),
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a2', 34.851, -82.401, 250, 'off_shift', now() - interval '1 hour', now(), 0),
  ('b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000b1', 32.78, -79.93, NULL, 'recovery', now(), now(), 0);
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
  t_as(NULL, 'service_role', $$INSERT INTO tool_sightings (company_id, tool_asset_id, lat, lng, precision_m, reason, first_seen, last_seen) VALUES ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000a1', 1, 1, 120, 'privacy_zone', now(), now()) RETURNING 'inserted'$$) = 'inserted');

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

SELECT 'FAIL ' || name || COALESCE(' — got ' || got, '') FROM t_results WHERE NOT ok;
SELECT 'privacy-sql: ' || count(*) FILTER (WHERE ok) || ' passed, ' || count(*) FILTER (WHERE NOT ok) || ' failed' FROM t_results;
