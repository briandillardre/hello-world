-- 129 — Driver safety scores (lib/driving-score.ts, docs/DRIVER-SCORES.md).
--
-- Brian, Oct 2026: "We need driver scores for any OBD devices. Look around at
-- how this is done with a keen eye for insurance providers as this will be a
-- future source of revenue for us."  Method: HammerTrack Safety Score v1
-- (docs/INSURANCE-TELEMATICS.md §3).
--
-- driving_daily — ONE row per road vehicle per COMPANY-LOCAL day
-- (companies.digest_prefs.tz): tracked miles, moving and engine time, late
-- night (midnight–4 AM, scored) and evening (10 PM–midnight, shown), time
-- per speeding tier against a site's own limit plus the absolute 80/75 mph
-- catch, the truck's accelerometer events (confirmed by the speed stream —
-- the scored ones), the ones it did not confirm, GPS-estimated hard stops
-- (coaching only), possible impacts (listed, never scored), and the data-
-- quality inputs an underwriter asks about (OBD vs GPS speed, miles with a
-- known limit, gaps, unplugs, jamming, towing, refused GPS spikes, whether
-- the accelerometer was on). `drivers` = per clocked-in phone that rode
-- along: { "<user id>": { s, mi, ss, smi, ns, zm, zh, zs } } — `ss`… are the
-- minutes that person was the ONLY phone aboard, the only time a score can
-- fairly charge them.
--
-- driving_events — the events behind those counts, for coaching and the map.
-- A day is rebuilt whole by driving_put_day (delete + insert in one
-- transaction), so a rebuild never doubles anything; (asset_id, kind, at) is
-- the natural key besides.
--
-- Built by the hourly /api/cron/driving through the service role: days that
-- received fixes since the last run (today, late uploads), then a bounded
-- backfill of older days. NOTHING is built at deploy time.
--
-- Reads: the company's members, under the per-asset visibility ladder (111)
-- like every asset-keyed table. Driver behaviour is people-shaped data:
-- Prospective Clients read none of it (119's lockdown). Writes: service role.
--
-- Frozen once pushed (CLAUDE.md) — fix-ups go in a new file.

CREATE TABLE IF NOT EXISTS public.driving_daily (
  asset_id        UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tz              TEXT NOT NULL DEFAULT 'America/New_York',
  vclass          TEXT NOT NULL DEFAULT 'light' CHECK (vclass IN ('light', 'heavy')),
  miles           REAL NOT NULL DEFAULT 0,
  moving_s        INTEGER NOT NULL DEFAULT 0,
  engine_s        INTEGER NOT NULL DEFAULT 0,
  night_s         INTEGER NOT NULL DEFAULT 0,
  evening_s       INTEGER NOT NULL DEFAULT 0,
  max_mph         SMALLINT NOT NULL DEFAULT 0,
  limit_miles     REAL NOT NULL DEFAULT 0,
  zone_mod_s      INTEGER NOT NULL DEFAULT 0,
  zone_heavy_s    INTEGER NOT NULL DEFAULT 0,
  zone_sev_s      INTEGER NOT NULL DEFAULT 0,
  max_sev_s       INTEGER NOT NULL DEFAULT 0,
  zone_speed_n    SMALLINT NOT NULL DEFAULT 0,
  max_speed_n     SMALLINT NOT NULL DEFAULT 0,
  brake_mod       SMALLINT NOT NULL DEFAULT 0,
  brake_sev       SMALLINT NOT NULL DEFAULT 0,
  accel_mod       SMALLINT NOT NULL DEFAULT 0,
  accel_sev       SMALLINT NOT NULL DEFAULT 0,
  corner_mod      SMALLINT NOT NULL DEFAULT 0,
  corner_sev      SMALLINT NOT NULL DEFAULT 0,
  unconfirmed_n   SMALLINT NOT NULL DEFAULT 0,
  brake_est       SMALLINT NOT NULL DEFAULT 0,
  accel_est       SMALLINT NOT NULL DEFAULT 0,
  crashes         SMALLINT NOT NULL DEFAULT 0,
  fixes           INTEGER NOT NULL DEFAULT 0,
  obd_s           INTEGER NOT NULL DEFAULT 0,
  dense_s         INTEGER NOT NULL DEFAULT 0,
  gap_s           INTEGER NOT NULL DEFAULT 0,
  longest_gap_s   INTEGER NOT NULL DEFAULT 0,
  power_lost      SMALLINT NOT NULL DEFAULT 0,
  unplug_n        SMALLINT NOT NULL DEFAULT 0,
  jamming_n       SMALLINT NOT NULL DEFAULT 0,
  towing_n        SMALLINT NOT NULL DEFAULT 0,
  rejects_n       SMALLINT NOT NULL DEFAULT 0,
  -- harsh events counted as measured (seen today or in the last 30 days)
  accel_on        BOOLEAN NOT NULL DEFAULT FALSE,
  -- this day's own fixes carried Green Driving keys (what the look-back reads)
  accel_seen      BOOLEAN NOT NULL DEFAULT FALSE,
  drivers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  version         SMALLINT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, day),
  CONSTRAINT driving_daily_drivers_object CHECK (jsonb_typeof(drivers) = 'object')
);
CREATE INDEX IF NOT EXISTS driving_daily_company_day_idx ON public.driving_daily (company_id, day DESC);

CREATE TABLE IF NOT EXISTS public.driving_events (
  id          BIGSERIAL PRIMARY KEY,
  asset_id    UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('harsh_brake', 'harsh_accel', 'harsh_corner', 'crash', 'max_speed', 'zone_speeding')),
  severity    TEXT NOT NULL CHECK (severity IN ('moderate', 'heavy', 'severe')),
  source      TEXT NOT NULL CHECK (source IN ('device', 'gps')),
  -- accelerometer events: did the speed stream confirm it (scored) or not (listed)?
  confirmed   BOOLEAN,
  -- g for harsh events and impacts; peak mph for speeding
  value       REAL,
  speed_mph   SMALLINT,
  duration_s  INTEGER,
  limit_mph   SMALLINT,
  zone_id     UUID REFERENCES public.geofences(id) ON DELETE SET NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  -- the one clocked-in phone aboard, when exactly one was
  person_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  version     SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT driving_events_natural_key UNIQUE (asset_id, kind, at)
);
CREATE INDEX IF NOT EXISTS driving_events_company_at_idx ON public.driving_events (company_id, at DESC);
CREATE INDEX IF NOT EXISTS driving_events_asset_day_idx ON public.driving_events (asset_id, day);
CREATE INDEX IF NOT EXISTS driving_events_person_idx ON public.driving_events (person_id, at DESC) WHERE person_id IS NOT NULL;

-- ── Who reads ───────────────────────────────────────────────────────────────
ALTER TABLE public.driving_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driving_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company reads driving daily" ON public.driving_daily;
CREATE POLICY "company reads driving daily" ON public.driving_daily
  FOR SELECT USING (company_id = current_company_id());
DROP POLICY IF EXISTS "company reads driving events" ON public.driving_events;
CREATE POLICY "company reads driving events" ON public.driving_events
  FOR SELECT USING (company_id = current_company_id());

-- 111's ladder: the EXISTS runs against assets under the caller's own RLS, so
-- a hidden truck's scores and events are hidden with it.
DROP POLICY IF EXISTS "follows asset visibility" ON public.driving_daily;
CREATE POLICY "follows asset visibility" ON public.driving_daily AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = driving_daily.asset_id));
DROP POLICY IF EXISTS "follows asset visibility" ON public.driving_events;
CREATE POLICY "follows asset visibility" ON public.driving_events AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = driving_events.asset_id));

SELECT ht_prospect_lockdown('driving_daily', false);
SELECT ht_prospect_lockdown('driving_events', false);

-- No writes through PostgREST at all (the builder is the service role).
DO $$
BEGIN
  REVOKE ALL ON TABLE public.driving_daily, public.driving_events FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.driving_daily, public.driving_events FROM authenticated;
  REVOKE ALL ON SEQUENCE public.driving_events_id_seq FROM anon, authenticated;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE '129: driving grants left as-is (%)', SQLERRM;
END $$;

-- ── The builder's reads ─────────────────────────────────────────────────────
-- One vehicle's fixes for a window, slimmed in SQL to what the math reads,
-- as ONE compact JSON array (a single row is never cut by the API's row
-- cap): [epoch ms, lat, lng, mph, ignition, position.valid, satellites,
-- hdop, event id, power-pin volts, {event keys} | null, heading, OBD km/h]
-- (lib/driving-score decodeFix). One indexed range scan of
-- (asset_id, timestamp); capped at 30,000 fixes (8 h at one a second).
CREATE OR REPLACE FUNCTION public.driving_day_fixes(p_asset UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(
           (extract(epoch FROM f."timestamp") * 1000)::bigint,
           f.lat, f.lng, f.speed, f.ignition,
           f.raw->'position.valid', f.raw->'position.satellites', f.raw->'position.hdop',
           f.raw->'event.enum', f.raw->'external.powersource.voltage',
           CASE WHEN f.raw ?| ARRAY['harsh.braking.event', 'harsh.acceleration.event', 'harsh.cornering.event',
                                    'green.driving.type', 'green.driving.type.enum', 'green.driving.value',
                                    'green.driving.braking', 'green.driving.acceleration', 'green.driving.cornering',
                                    'crash.event', 'crash.detection', 'crash.event.enum', 'crash',
                                    'battery.unplug.event', 'unplug.event', 'unplug', 'unplug.status',
                                    'gnss.jamming.state', 'gnss.jamming.status', 'jamming.event', 'gsm.jamming.status',
                                    'towing.event', 'towing.detection.event', 'towing', 'towing.status']
                THEN (SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(f.raw) k
                      WHERE k.key LIKE 'harsh.%' OR k.key LIKE 'green.driving.%' OR k.key LIKE 'crash.%'
                         OR k.key IN ('absolute.acceleration', 'eco.driving.event.duration', 'crash',
                                      'battery.unplug.event', 'unplug.event', 'unplug', 'unplug.status',
                                      'gnss.jamming.state', 'gnss.jamming.status', 'jamming.event', 'gsm.jamming.status',
                                      'towing.event', 'towing.detection.event', 'towing', 'towing.status'))
           END,
           f.heading,
           COALESCE(f.raw->'can.vehicle.speed', f.raw->'obd.vehicle.speed')
         ) ORDER BY f."timestamp"), '[]'::jsonb)
  FROM (
    SELECT l."timestamp", l.lat, l.lng, l.speed, l.ignition, l.heading, l.raw
    FROM asset_locations l
    WHERE l.asset_id = p_asset AND l."timestamp" >= p_from AND l."timestamp" < p_to
    ORDER BY l."timestamp"
    LIMIT 30000
  ) f
$$;

-- Crew phones for driver attribution: [asset id, epoch ms, lat, lng, mph].
-- Phones record every ~30 s while clocked in; capped at 50,000 rows.
CREATE OR REPLACE FUNCTION public.driving_phone_fixes(p_assets UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(f.asset_id, (extract(epoch FROM f."timestamp") * 1000)::bigint, f.lat, f.lng, f.speed)
         ORDER BY f."timestamp"), '[]'::jsonb)
  FROM (
    SELECT l.asset_id, l."timestamp", l.lat, l.lng, l.speed
    FROM asset_locations l
    WHERE l.asset_id = ANY(p_assets) AND l."timestamp" >= p_from AND l."timestamp" < p_to
    ORDER BY l."timestamp"
    LIMIT 50000
  ) f
$$;

-- Which vehicles received fixes since the last run, and over what span —
-- late uploads (a unit that buffered offline) land in their real days. One
-- range scan of the created_at index (049); the look-back is clamped to two
-- days so a stale watermark can never turn into a history scan.
CREATE OR REPLACE FUNCTION public.driving_dirty(p_since TIMESTAMPTZ, p_assets UUID[])
RETURNS TABLE (asset_id UUID, min_ts TIMESTAMPTZ, max_ts TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.asset_id, min(l."timestamp"), max(l."timestamp")
  FROM asset_locations l
  WHERE l.created_at >= GREATEST(p_since, now() - INTERVAL '2 days')
    AND l."timestamp" >= now() - INTERVAL '95 days'
    AND l.asset_id = ANY(p_assets)
  GROUP BY l.asset_id
$$;

-- The backfill's to-do list: company-local days (in p_tz) inside
-- [p_from, p_to] on which a vehicle has at least one fix but no row at the
-- current engine version, oldest first per vehicle. A loose index scan —
-- one (asset_id, timestamp) probe per day with data — so a quiet year costs
-- nothing and the list is cut at p_limit.
CREATE OR REPLACE FUNCTION public.driving_backfill_todo(p_assets UUID[], p_from DATE, p_to DATE, p_tz TEXT, p_version INT, p_limit INT)
RETURNS TABLE (asset_id UUID, day DATE)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tz    TEXT := ht_safe_tz(p_tz);
  v_end   TIMESTAMPTZ := ((p_to + 1)::timestamp AT TIME ZONE v_tz);
  v_a     UUID;
  v_ts    TIMESTAMPTZ;
  v_day   DATE;
  v_n     INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
BEGIN
  FOREACH v_a IN ARRAY COALESCE(p_assets, '{}'::uuid[]) LOOP
    SELECT min(l."timestamp") INTO v_ts FROM asset_locations l
      WHERE l.asset_id = v_a AND l."timestamp" >= (p_from::timestamp AT TIME ZONE v_tz) AND l."timestamp" < v_end;
    WHILE v_ts IS NOT NULL LOOP
      v_day := (v_ts AT TIME ZONE v_tz)::date;
      IF NOT EXISTS (SELECT 1 FROM driving_daily d WHERE d.asset_id = v_a AND d.day = v_day AND d.version >= p_version) THEN
        asset_id := v_a;
        day := v_day;
        RETURN NEXT;
        v_n := v_n + 1;
        IF v_n >= v_limit THEN RETURN; END IF;
      END IF;
      SELECT min(l."timestamp") INTO v_ts FROM asset_locations l
        WHERE l.asset_id = v_a AND l."timestamp" >= ((v_day + 1)::timestamp AT TIME ZONE v_tz) AND l."timestamp" < v_end;
    END LOOP;
  END LOOP;
END $$;

-- ── The builder's one write ─────────────────────────────────────────────────
-- Replace a vehicle-day whole: its events and its row, in one transaction.
-- company_id comes from the asset itself, never from the payload; a site or
-- a person from another company is dropped.
CREATE OR REPLACE FUNCTION public.driving_put_day(p_asset UUID, p_day DATE, p_row JSONB, p_events JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
BEGIN
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
    RAISE EXCEPTION 'driving_put_day: row must be an object';
  END IF;
  IF p_events IS NOT NULL AND jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'driving_put_day: events must be an array';
  END IF;
  SELECT a.company_id INTO v_company FROM assets a WHERE a.id = p_asset;
  IF v_company IS NULL THEN RETURN; END IF;

  DELETE FROM driving_events WHERE asset_id = p_asset AND day = p_day;

  INSERT INTO driving_events (asset_id, company_id, day, at, kind, severity, source, confirmed, value, speed_mph,
                              duration_s, limit_mph, zone_id, lat, lng, person_id, version)
  SELECT p_asset, v_company, p_day, e.at, e.kind, e.severity, e.source, e.confirmed, e.value, e.speed_mph,
         e.duration_s, e.limit_mph,
         (SELECT g.id FROM geofences g WHERE g.id = e.zone_id AND g.company_id = v_company),
         e.lat, e.lng,
         (SELECT p.id FROM profiles p WHERE p.id = e.person_id AND p.company_id = v_company),
         COALESCE(e.version, 1)
  FROM jsonb_to_recordset(COALESCE(p_events, '[]'::jsonb)) AS e(
    at TIMESTAMPTZ, kind TEXT, severity TEXT, source TEXT, confirmed BOOLEAN, value REAL, speed_mph SMALLINT,
    duration_s INTEGER, limit_mph SMALLINT, zone_id UUID, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    person_id UUID, version SMALLINT)
  WHERE e.at IS NOT NULL
  LIMIT 5000
  ON CONFLICT (asset_id, kind, at) DO NOTHING;

  INSERT INTO driving_daily (
    asset_id, day, company_id, tz, vclass, miles, moving_s, engine_s, night_s, evening_s, max_mph,
    limit_miles, zone_mod_s, zone_heavy_s, zone_sev_s, max_sev_s, zone_speed_n, max_speed_n,
    brake_mod, brake_sev, accel_mod, accel_sev, corner_mod, corner_sev, unconfirmed_n, brake_est, accel_est, crashes,
    fixes, obd_s, dense_s, gap_s, longest_gap_s, power_lost, unplug_n, jamming_n, towing_n, rejects_n,
    accel_on, accel_seen, drivers, version, updated_at)
  SELECT p_asset, p_day, v_company, COALESCE(r.tz, 'America/New_York'),
    CASE WHEN r.vclass = 'heavy' THEN 'heavy' ELSE 'light' END,
    COALESCE(r.miles, 0), COALESCE(r.moving_s, 0), COALESCE(r.engine_s, 0), COALESCE(r.night_s, 0), COALESCE(r.evening_s, 0),
    COALESCE(r.max_mph, 0), COALESCE(r.limit_miles, 0), COALESCE(r.zone_mod_s, 0), COALESCE(r.zone_heavy_s, 0),
    COALESCE(r.zone_sev_s, 0), COALESCE(r.max_sev_s, 0), COALESCE(r.zone_speed_n, 0), COALESCE(r.max_speed_n, 0),
    COALESCE(r.brake_mod, 0), COALESCE(r.brake_sev, 0), COALESCE(r.accel_mod, 0), COALESCE(r.accel_sev, 0),
    COALESCE(r.corner_mod, 0), COALESCE(r.corner_sev, 0), COALESCE(r.unconfirmed_n, 0), COALESCE(r.brake_est, 0),
    COALESCE(r.accel_est, 0), COALESCE(r.crashes, 0), COALESCE(r.fixes, 0), COALESCE(r.obd_s, 0), COALESCE(r.dense_s, 0),
    COALESCE(r.gap_s, 0), COALESCE(r.longest_gap_s, 0), COALESCE(r.power_lost, 0), COALESCE(r.unplug_n, 0),
    COALESCE(r.jamming_n, 0), COALESCE(r.towing_n, 0), COALESCE(r.rejects_n, 0), COALESCE(r.accel_on, FALSE),
    COALESCE(r.accel_seen, FALSE),
    CASE WHEN jsonb_typeof(p_row->'drivers') = 'object' THEN p_row->'drivers' ELSE '{}'::jsonb END,
    COALESCE(r.version, 1), now()
  FROM jsonb_to_record(p_row) AS r(
    tz TEXT, vclass TEXT, miles REAL, moving_s INTEGER, engine_s INTEGER, night_s INTEGER, evening_s INTEGER, max_mph SMALLINT,
    limit_miles REAL, zone_mod_s INTEGER, zone_heavy_s INTEGER, zone_sev_s INTEGER, max_sev_s INTEGER,
    zone_speed_n SMALLINT, max_speed_n SMALLINT, brake_mod SMALLINT, brake_sev SMALLINT, accel_mod SMALLINT,
    accel_sev SMALLINT, corner_mod SMALLINT, corner_sev SMALLINT, unconfirmed_n SMALLINT, brake_est SMALLINT,
    accel_est SMALLINT, crashes SMALLINT, fixes INTEGER, obd_s INTEGER, dense_s INTEGER, gap_s INTEGER,
    longest_gap_s INTEGER, power_lost SMALLINT, unplug_n SMALLINT, jamming_n SMALLINT, towing_n SMALLINT,
    rejects_n SMALLINT, accel_on BOOLEAN, accel_seen BOOLEAN, version SMALLINT)
  ON CONFLICT (asset_id, day) DO UPDATE SET
    company_id = EXCLUDED.company_id, tz = EXCLUDED.tz, vclass = EXCLUDED.vclass, miles = EXCLUDED.miles,
    moving_s = EXCLUDED.moving_s, engine_s = EXCLUDED.engine_s, night_s = EXCLUDED.night_s, evening_s = EXCLUDED.evening_s,
    max_mph = EXCLUDED.max_mph, limit_miles = EXCLUDED.limit_miles, zone_mod_s = EXCLUDED.zone_mod_s,
    zone_heavy_s = EXCLUDED.zone_heavy_s, zone_sev_s = EXCLUDED.zone_sev_s, max_sev_s = EXCLUDED.max_sev_s,
    zone_speed_n = EXCLUDED.zone_speed_n, max_speed_n = EXCLUDED.max_speed_n,
    brake_mod = EXCLUDED.brake_mod, brake_sev = EXCLUDED.brake_sev, accel_mod = EXCLUDED.accel_mod,
    accel_sev = EXCLUDED.accel_sev, corner_mod = EXCLUDED.corner_mod, corner_sev = EXCLUDED.corner_sev,
    unconfirmed_n = EXCLUDED.unconfirmed_n, brake_est = EXCLUDED.brake_est, accel_est = EXCLUDED.accel_est,
    crashes = EXCLUDED.crashes, fixes = EXCLUDED.fixes, obd_s = EXCLUDED.obd_s, dense_s = EXCLUDED.dense_s,
    gap_s = EXCLUDED.gap_s, longest_gap_s = EXCLUDED.longest_gap_s, power_lost = EXCLUDED.power_lost,
    unplug_n = EXCLUDED.unplug_n, jamming_n = EXCLUDED.jamming_n, towing_n = EXCLUDED.towing_n,
    rejects_n = EXCLUDED.rejects_n, accel_on = EXCLUDED.accel_on, accel_seen = EXCLUDED.accel_seen, drivers = EXCLUDED.drivers,
    version = EXCLUDED.version, updated_at = now();
END $$;

-- Service role only: every builder function reads or writes across the
-- company boundary by design.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.driving_day_fixes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.driving_phone_fixes(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.driving_dirty(TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.driving_backfill_todo(UUID[], DATE, DATE, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.driving_put_day(UUID, DATE, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE '129: driving function grants left as-is (%)', SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.driving_day_fixes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.driving_phone_fixes(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.driving_dirty(TIMESTAMPTZ, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.driving_backfill_todo(UUID[], DATE, DATE, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.driving_put_day(UUID, DATE, JSONB, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
