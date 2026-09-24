-- 122 — Pairing episodes remember WHERE the tag was heard.
--
-- Brian, Sep 24, of the 85A roller's page where every row said "rode with":
-- "There needs to be a way to differentiate between 'rode with' and 'seen
-- by'. Rode with should require it to be moving like more than a half mile
-- with a hub."
--
-- The first answer (#158) measured the CARRIER's own drive between the first
-- and last time it heard the tag. Wrong, and the live data says why: an
-- episode stays open across hearing gaps of up to 6 h, so a dump truck that
-- hears a roller at a site, hauls six loads and comes back each time drove
-- 60 miles "with" a roller that never moved (F650 + HAMM roller, Sep 22: 703
-- sightings, every one within 45 m of the first, 4,460 moving fixes between
-- them). Reading that truck's track per page view cost ~0.9 s per 6,000
-- fixes on top of being wrong.
--
-- The rule now: where was the truck each time it HEARD the tag? A tag that
-- is heard at places more than half a mile apart travelled; one heard only
-- in one spot went nowhere, however far the truck drove in between. The
-- ingest (lib/ble-sightings.ts) folds each sighting's position into the
-- episode as it happens, so reading the verdict costs nothing:
--   first_lat/lng    where the carrier first heard the tag
--   anchor_lat/lng   the last PLACE it heard it (moves only past 250 m: the
--                    position is the TRUCK's and a tag is heard ~100 m away
--                    on any side, so GPS wander or a truck re-parking around
--                    a parked machine never adds distance)
--   span_m           farthest any sighting has been from the first one —
--                    the verdict: ≥ 805 m (half a mile) = rode with
--   moved_m          straight-line sum of the moves between places — the
--                    "22 mi together" (a floor: sparse sightings see the
--                    ends of a drive, not its bends)
--   heard_n          sightings folded in. NULL = recorded before this
--                    migration; ht_pairing_summarize() fills those from the
--                    carriers' raw beacon lists, once.
-- The pure fold is lib/pairing-ride.ts (`foldSighting`), harness
-- `node scripts/pairing-ride-test.mjs`; the SQL below mirrors it for the
-- one-time backfill only.

ALTER TABLE pairing_log
  ADD COLUMN IF NOT EXISTS first_lat  double precision,
  ADD COLUMN IF NOT EXISTS first_lng  double precision,
  ADD COLUMN IF NOT EXISTS anchor_lat double precision,
  ADD COLUMN IF NOT EXISTS anchor_lng double precision,
  ADD COLUMN IF NOT EXISTS span_m     real,
  ADD COLUMN IF NOT EXISTS moved_m    real,
  ADD COLUMN IF NOT EXISTS heard_n    integer;

-- ── Who may write the history ───────────────────────────────────────────────
-- 021's policy was FOR ALL: any signed-in member could insert or rewrite
-- episodes through PostgREST — and an episode now carries a verdict. Only the
-- ingest writes pairing_log, and it runs as the service role (no RLS).
DROP POLICY IF EXISTS "company pairing log" ON pairing_log;
DROP POLICY IF EXISTS "company pairing log read" ON pairing_log;
CREATE POLICY "company pairing log read" ON pairing_log
  FOR SELECT USING (company_id = current_company_id());

-- 111's ladder, which missed this table: an episode follows BOTH its assets,
-- like tool_associations — a tag's history with a hidden truck is that
-- truck's whereabouts, and a hidden machine's pairings are the machine's.
DROP POLICY IF EXISTS "follows asset visibility" ON pairing_log;
CREATE POLICY "follows asset visibility" ON pairing_log AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = pairing_log.member_asset_id)
     AND EXISTS (SELECT 1 FROM assets a WHERE a.id = pairing_log.carrier_asset_id));

-- ── The one-time backfill ───────────────────────────────────────────────────
-- Metres between two points — the same haversine as lib/pairing-ride.ts.
CREATE OR REPLACE FUNCTION ht_metres(lat1 double precision, lng1 double precision,
                                     lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)))
$$;

-- Every separator-free, lower-case form a tool's tracker_id may take for one
-- id a Teltonika box reported — lib/ble-sightings.ts `beaconCandidates(id,
-- 'hex')`, stripped the way its fallback compares them: the id itself, the
-- MAC inside a factory EYE Beacon's zero UUID (and the zero UUID around a
-- bare MAC), and an iBeacon's HEX major/minor read as the DECIMAL people
-- register (plus the owner shorthand uuid:minor).
CREATE OR REPLACE FUNCTION ht_beacon_keys(r text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH p AS (SELECT regexp_match(r, '^(.{20,}):([0-9a-zA-Z]{1,5}):([0-9a-zA-Z]{1,5})$') AS m)
  SELECT array_remove(ARRAY[
    lower(regexp_replace(r, '[^0-9a-zA-Z]', '', 'g')),
    CASE WHEN r ~ '^0{8}-0{4}-0{4}-0{4}-[0-9a-fA-F]{12}$' THEN lower(right(r, 12)) END,
    CASE WHEN r ~ '^[0-9a-fA-F]{2}([:-]?[0-9a-fA-F]{2}){5}$'
         THEN '000000000000000000000000' || lower(regexp_replace(r, '[^0-9a-fA-F]', '', 'g')) END,
    CASE WHEN m IS NOT NULL AND m[2] ~ '^[0-9a-fA-F]{1,4}$' AND m[3] ~ '^[0-9a-fA-F]{1,4}$'
         THEN lower(regexp_replace(m[1], '[^0-9a-zA-Z]', '', 'g'))
              || (('x' || lpad(m[2], 8, '0'))::bit(32)::int)::text
              || (('x' || lpad(m[3], 8, '0'))::bit(32)::int)::text END,
    CASE WHEN m IS NOT NULL AND m[2] ~ '^[0-9a-fA-F]{1,4}$' AND m[3] ~ '^[0-9a-fA-F]{1,4}$'
         THEN lower(regexp_replace(m[1], '[^0-9a-zA-Z]', '', 'g'))
              || (('x' || lpad(m[3], 8, '0'))::bit(32)::int)::text END
  ], NULL) FROM p
$$;

-- Fill one episode's places from what its carrier recorded: every fix in the
-- episode whose raw beacon list carries the tag, plus the carrier's fixes at
-- (or within 10 min of) its first and last sighting — those ARE sightings by
-- construction, and they are all a phone carrier has (phones never stored
-- their beacon lists). Walks them in time order exactly like the ingest
-- fold. Idempotent: it recomputes from scratch. Service role only — it reads
-- raw across the carrier's whole window (~0.15 ms a fix) and is meant to run
-- once over the episodes recorded before this migration:
--   SELECT ht_pairing_summarize(id) FROM pairing_log WHERE heard_n IS NULL;
-- (run in slices after the deploy that carried this file — not at deploy
-- time: 190 episodes span ~257,000 fixes.)
CREATE OR REPLACE FUNCTION ht_pairing_summarize(p_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  ep record;
  s record;
  n int := 0;
  f_lat double precision; f_lng double precision;
  a_lat double precision; a_lng double precision;
  span double precision := 0;
  moved double precision := 0;
  d double precision;
BEGIN
  SELECT p.id, p.carrier_asset_id, p.started_at,
         COALESCE(p.last_seen, p.ended_at, p.started_at) AS t1,
         lower(regexp_replace(COALESCE(m.tracker_id, ''), '[^0-9a-zA-Z]', '', 'g')) AS tkey
    INTO ep
    FROM pairing_log p JOIN assets m ON m.id = p.member_asset_id
   WHERE p.id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  FOR s IN
    WITH heard AS (
      SELECT l.timestamp AS ts, l.lat, l.lng FROM asset_locations l
       WHERE l.asset_id = ep.carrier_asset_id
         AND l.timestamp BETWEEN ep.started_at AND ep.t1
         AND length(ep.tkey) >= 8
         AND jsonb_typeof(l.raw -> 'ble.beacons') = 'array'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.raw -> 'ble.beacons') b
                      WHERE ep.tkey = ANY (ht_beacon_keys(b ->> 'id')))
    ), first_end AS (
      SELECT l.timestamp AS ts, l.lat, l.lng FROM asset_locations l
       WHERE l.asset_id = ep.carrier_asset_id
         AND l.timestamp BETWEEN ep.started_at - interval '10 minutes' AND ep.started_at + interval '10 minutes'
       ORDER BY abs(extract(epoch FROM l.timestamp - ep.started_at)) LIMIT 1
    ), last_end AS (
      SELECT l.timestamp AS ts, l.lat, l.lng FROM asset_locations l
       WHERE l.asset_id = ep.carrier_asset_id
         AND l.timestamp BETWEEN ep.t1 - interval '10 minutes' AND ep.t1 + interval '10 minutes'
       ORDER BY abs(extract(epoch FROM l.timestamp - ep.t1)) LIMIT 1
    )
    SELECT DISTINCT ON (ts) ts, lat, lng
      FROM (SELECT * FROM heard UNION ALL SELECT * FROM first_end UNION ALL SELECT * FROM last_end) x
     WHERE lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 AND NOT (lat = 0 AND lng = 0)
     ORDER BY ts
  LOOP
    IF n = 0 THEN
      f_lat := s.lat; f_lng := s.lng; a_lat := s.lat; a_lng := s.lng;
    ELSE
      d := ht_metres(a_lat, a_lng, s.lat, s.lng);
      IF d > 250 THEN moved := moved + d; a_lat := s.lat; a_lng := s.lng; END IF;
      span := greatest(span, ht_metres(f_lat, f_lng, s.lat, s.lng));
    END IF;
    n := n + 1;
  END LOOP;

  UPDATE pairing_log SET
    first_lat = f_lat, first_lng = f_lng, anchor_lat = a_lat, anchor_lng = a_lng,
    span_m = span, moved_m = moved, heard_n = n
  WHERE id = p_id;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION ht_pairing_summarize(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ht_pairing_summarize(uuid) TO service_role;
