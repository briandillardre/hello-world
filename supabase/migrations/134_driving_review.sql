-- 134 — Driver safety scores: the review pass on 129 (PR #190).
--
-- sec-check P1. Driving behaviour is people-shaped data, but 129 left its
-- per-person half readable to every member through PostgREST: the read
-- policies on driving_daily / driving_events were company-wide, and the two
-- period sums (driving_rollup, driving_person_events) ran as the caller over
-- those rows. An Associate's session plus the anon key could pull
-- `driving_events?person_id=not.is.null&select=person_id,at,kind,speed_mph,lat,lng`
-- — Managers', Admins' and the owner's events with time and place — or every
-- person's sums out of `driving_daily.drivers` / `rpc/driving_rollup`. The
-- pages apply "yourself and the people you outrank" (lib/db/driving.ts
-- driverVisible); now the database does too:
--
--   • ht_can_see_person(uuid) — the ladder for PEOPLE (lib/permissions.ts
--     outranks): yourself; anyone strictly below you in your own company
--     (Master 4 · admin 3 · manager 2 · foreman 1 · associate 0); nobody
--     outranks the Master (profile id == company id); a Prospective Client
--     answers to the Master alone (118); someone no longer on the roster is
--     the Master's business only.
--   • driving_events — a RESTRICTIVE read policy: an event charged to a
--     person is readable only by people who may see that person.
--   • driving_daily.drivers — no longer readable by members at all: SELECT is
--     granted column by column, every column but that one. The service role
--     (the builder, the company-key MCP door) keeps the whole row.
--   • driving_rollup / driving_person_events — SECURITY DEFINER with every
--     rule written out, because a definer reads past RLS: the caller's own
--     company only (the service role may name any), the vehicle under 111's
--     visibility ladder, nothing at all for a Prospective Client, and a
--     person's sums or counts only past ht_can_see_person. driving_rollup
--     also returns attributed_miles — the solo miles tied to ANY named
--     driver — so the data-quality line "miles tied to a named driver" reads
--     the same whoever prints the insurer report (it names nobody).
--
-- Bounded and idempotent: functions, grants and one policy — nothing reads
-- or rewrites a row at deploy, no backfill. Frozen once pushed (CLAUDE.md):
-- fix-ups go in a new file. Harness: scripts/driving-sql-test/run.sh.

-- ── Who is asking ───────────────────────────────────────────────────────────
-- A SECURITY DEFINER function runs as its owner, so current_user cannot say
-- who called. The API says it twice per request: the JWT's role claim
-- (auth.role()) and the role PostgREST switched to — the `role` setting,
-- which a definer leaves as the caller set it ('none' on a direct connection:
-- a migration, the SQL editor). A member's session never reads as the
-- service, whatever the other half says.
CREATE OR REPLACE FUNCTION public.ht_caller_is_service()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('role', true), 'none') IN ('authenticated', 'anon')
      OR COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN false
    WHEN COALESCE(current_setting('role', true), 'none') = 'service_role'
      OR COALESCE(auth.role(), '') = 'service_role' THEN true
    ELSE COALESCE(current_setting('role', true), 'none') = 'none' AND auth.role() IS NULL
  END
$$;

-- ── The ladder, for people ──────────────────────────────────────────────────
-- SECURITY DEFINER like ht_viewer_rank (111): profiles' own RLS would hide a
-- prospect's row (118) and recurse otherwise.
CREATE OR REPLACE FUNCTION public.ht_can_see_person(p_person UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_person IS NULL OR auth.uid() IS NULL THEN false
    WHEN p_person = auth.uid() THEN true
    ELSE COALESCE(
      (SELECT CASE
                WHEN t.company_id IS DISTINCT FROM current_company_id() THEN false  -- another company's person
                WHEN t.id = t.company_id THEN false                                  -- nobody outranks the Master
                WHEN t.role = 'prospect' THEN ht_viewer_rank() = 4                   -- the Master's alone (118)
                ELSE ht_viewer_rank() > CASE t.role WHEN 'admin' THEN 3 WHEN 'manager' THEN 2
                                                    WHEN 'foreman' THEN 1 ELSE 0 END
              END
       FROM profiles t WHERE t.id = p_person),
      -- No profile any more (removed from the team): the owner's business alone.
      ht_viewer_rank() = 4)
  END
$$;

-- ── driving_events: a person's events follow the ladder ─────────────────────
DROP POLICY IF EXISTS "a person's events follow the ladder" ON public.driving_events;
CREATE POLICY "a person's events follow the ladder" ON public.driving_events AS RESTRICTIVE FOR SELECT
  USING (person_id IS NULL OR ht_can_see_person(person_id));

-- ── driving_daily: every column but the per-person sums ─────────────────────
-- Revoking the table-level SELECT also drops any column grants, so this is
-- safe to run twice. The list is read from the table itself: "every column
-- but drivers", not a hand-kept copy of 129's.
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.driving_daily'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'drivers';
  IF v_cols IS NULL THEN
    RAISE EXCEPTION '134: driving_daily has no columns to grant';
  END IF;
  REVOKE SELECT ON TABLE public.driving_daily FROM authenticated;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.driving_daily TO authenticated', v_cols);
END $$;

-- ── The readers' sums, as definers ──────────────────────────────────────────
-- 129's driving_jnum stays as it is. The return type grows a column
-- (attributed_miles), so driving_rollup is dropped and made again — in the
-- runner's one transaction, so no request ever finds it missing.
DROP FUNCTION IF EXISTS public.driving_rollup(UUID, UUID[], DATE, DATE);
CREATE FUNCTION public.driving_rollup(p_company UUID, p_assets UUID[], p_from DATE, p_to DATE)
RETURNS TABLE (
  asset_id UUID, month TEXT, n_days INT, n_driving INT, n_accel INT, accel_miles REAL, updated_at TIMESTAMPTZ,
  miles REAL, moving_s BIGINT, engine_s BIGINT, night_s BIGINT, evening_s BIGINT, max_mph INT, limit_miles REAL,
  zone_mod_s BIGINT, zone_heavy_s BIGINT, zone_sev_s BIGINT, max_sev_s BIGINT, zone_speed_n INT, max_speed_n INT,
  brake_mod INT, brake_sev INT, accel_mod INT, accel_sev INT, corner_mod INT, corner_sev INT, unconfirmed_n INT,
  brake_est INT, accel_est INT, crashes INT, fixes BIGINT, obd_s BIGINT, dense_s BIGINT, gap_s BIGINT,
  longest_gap_s INT, power_lost INT, unplug_n INT, jamming_n INT, towing_n INT, rejects_n INT, drivers JSONB,
  attributed_miles REAL)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_all  BOOLEAN := ht_caller_is_service();
  v_rank INT := ht_viewer_rank();
BEGIN
  -- A member reads their own company only, and a Prospective Client nothing.
  IF NOT v_all AND (p_company IS NULL OR p_company IS DISTINCT FROM current_company_id()
                    OR ht_viewer_role() = 'prospect') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH d AS (
    SELECT x.*, to_char(x.day, 'YYYY-MM') AS mon
    FROM driving_daily x
    WHERE x.company_id = p_company AND x.asset_id = ANY(p_assets) AND x.day >= p_from AND x.day <= p_to
      -- 111's ladder on the vehicle, written out (a definer reads past RLS).
      AND (v_all OR EXISTS (SELECT 1 FROM assets a
                            WHERE a.id = x.asset_id AND a.company_id = p_company
                              AND ht_visibility_rank(a.metadata) <= v_rank))
  ),
  -- Whose sums this caller may see — decided once per person, not per row.
  seen AS MATERIALIZED (
    SELECT k.pid
    FROM (SELECT DISTINCT p.key AS pid FROM d CROSS JOIN LATERAL jsonb_object_keys(d.drivers) AS p(key)) k
    WHERE v_all OR CASE WHEN k.pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN ht_can_see_person(k.pid::uuid) ELSE false END
  ),
  people AS (
    SELECT d.asset_id, d.mon, p.key AS pid,
           count(*) AS nd,
           count(*) FILTER (WHERE driving_jnum(p.value, 'ss') > 0) AS dd,
           count(*) FILTER (WHERE driving_jnum(p.value, 'ss') > 0 AND d.accel_on) AS ad,
           sum(driving_jnum(p.value, 's')) AS s, sum(driving_jnum(p.value, 'mi')) AS mi,
           sum(driving_jnum(p.value, 'ss')) AS ss, sum(driving_jnum(p.value, 'smi')) AS smi,
           sum(driving_jnum(p.value, 'ns')) AS ns, sum(driving_jnum(p.value, 'zm')) AS zm,
           sum(driving_jnum(p.value, 'zh')) AS zh, sum(driving_jnum(p.value, 'zs')) AS zs,
           COALESCE(sum(driving_jnum(p.value, 'smi')) FILTER (WHERE d.accel_on AND driving_jnum(p.value, 'ss') > 0), 0) AS a
    FROM d CROSS JOIN LATERAL jsonb_each(d.drivers) p
    WHERE jsonb_typeof(p.value) = 'object' AND p.key IN (SELECT seen.pid FROM seen)
    GROUP BY d.asset_id, d.mon, p.key
  ),
  ppl AS (
    SELECT people.asset_id, people.mon, jsonb_object_agg(people.pid, jsonb_build_object(
             'nd', people.nd, 'dd', people.dd, 'ad', people.ad, 's', people.s, 'mi', people.mi, 'ss', people.ss,
             'smi', people.smi, 'ns', people.ns, 'zm', people.zm, 'zh', people.zh, 'zs', people.zs, 'a', people.a)) AS drivers
    FROM people
    GROUP BY people.asset_id, people.mon
  ),
  -- Every named driver's solo miles, whoever they are: a data-quality total
  -- that names nobody and must not change with who is looking.
  attr AS (
    SELECT d.asset_id, d.mon, sum(driving_jnum(p.value, 'smi')) AS smi
    FROM d CROSS JOIN LATERAL jsonb_each(d.drivers) p
    WHERE jsonb_typeof(p.value) = 'object'
    GROUP BY d.asset_id, d.mon
  ),
  sums AS (
    SELECT d.asset_id, d.mon,
           count(*)::int AS n_days,
           (count(*) FILTER (WHERE d.moving_s > 0))::int AS n_driving,
           (count(*) FILTER (WHERE d.moving_s > 0 AND d.accel_on))::int AS n_accel,
           COALESCE(sum(d.miles) FILTER (WHERE d.moving_s > 0 AND d.accel_on), 0)::real AS accel_miles,
           max(d.updated_at) AS updated_at,
           sum(d.miles)::real AS miles, sum(d.moving_s)::bigint AS moving_s, sum(d.engine_s)::bigint AS engine_s,
           sum(d.night_s)::bigint AS night_s, sum(d.evening_s)::bigint AS evening_s, max(d.max_mph)::int AS max_mph,
           sum(d.limit_miles)::real AS limit_miles, sum(d.zone_mod_s)::bigint AS zone_mod_s,
           sum(d.zone_heavy_s)::bigint AS zone_heavy_s, sum(d.zone_sev_s)::bigint AS zone_sev_s,
           sum(d.max_sev_s)::bigint AS max_sev_s, sum(d.zone_speed_n)::int AS zone_speed_n,
           sum(d.max_speed_n)::int AS max_speed_n, sum(d.brake_mod)::int AS brake_mod, sum(d.brake_sev)::int AS brake_sev,
           sum(d.accel_mod)::int AS accel_mod, sum(d.accel_sev)::int AS accel_sev, sum(d.corner_mod)::int AS corner_mod,
           sum(d.corner_sev)::int AS corner_sev, sum(d.unconfirmed_n)::int AS unconfirmed_n,
           sum(d.brake_est)::int AS brake_est, sum(d.accel_est)::int AS accel_est, sum(d.crashes)::int AS crashes,
           sum(d.fixes)::bigint AS fixes, sum(d.obd_s)::bigint AS obd_s, sum(d.dense_s)::bigint AS dense_s,
           sum(d.gap_s)::bigint AS gap_s, max(d.longest_gap_s)::int AS longest_gap_s,
           sum(d.power_lost)::int AS power_lost, sum(d.unplug_n)::int AS unplug_n, sum(d.jamming_n)::int AS jamming_n,
           sum(d.towing_n)::int AS towing_n, sum(d.rejects_n)::int AS rejects_n
    FROM d
    GROUP BY d.asset_id, d.mon
  )
  SELECT s.asset_id, s.mon, s.n_days, s.n_driving, s.n_accel, s.accel_miles, s.updated_at,
         s.miles, s.moving_s, s.engine_s, s.night_s, s.evening_s, s.max_mph, s.limit_miles,
         s.zone_mod_s, s.zone_heavy_s, s.zone_sev_s, s.max_sev_s, s.zone_speed_n, s.max_speed_n,
         s.brake_mod, s.brake_sev, s.accel_mod, s.accel_sev, s.corner_mod, s.corner_sev, s.unconfirmed_n,
         s.brake_est, s.accel_est, s.crashes, s.fixes, s.obd_s, s.dense_s, s.gap_s,
         s.longest_gap_s, s.power_lost, s.unplug_n, s.jamming_n, s.towing_n, s.rejects_n,
         COALESCE(ppl.drivers, '{}'::jsonb), COALESCE(attr.smi, 0)::real
  FROM sums s
  LEFT JOIN ppl ON ppl.asset_id = s.asset_id AND ppl.mon = s.mon
  LEFT JOIN attr ON attr.asset_id = s.asset_id AND attr.mon = s.mon
  ORDER BY s.mon, s.asset_id;
END $$;

-- Each person's events in a period, counted by what they were — the same
-- rules: own company, visible vehicle, no prospect, people past the ladder.
CREATE OR REPLACE FUNCTION public.driving_person_events(p_company UUID, p_assets UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (person_id UUID, kind TEXT, severity TEXT, source TEXT, confirmed BOOLEAN, n INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_all  BOOLEAN := ht_caller_is_service();
  v_rank INT := ht_viewer_rank();
BEGIN
  IF NOT v_all AND (p_company IS NULL OR p_company IS DISTINCT FROM current_company_id()
                    OR ht_viewer_role() = 'prospect') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH ev AS (
    SELECT e.person_id AS pid, e.kind AS k, e.severity AS sev, e.source AS src, e.confirmed AS conf
    FROM driving_events e
    WHERE e.company_id = p_company AND e.asset_id = ANY(p_assets) AND e.person_id IS NOT NULL
      AND e.at >= p_from AND e.at < p_to
      AND (v_all OR EXISTS (SELECT 1 FROM assets a
                            WHERE a.id = e.asset_id AND a.company_id = p_company
                              AND ht_visibility_rank(a.metadata) <= v_rank))
  ),
  seen AS MATERIALIZED (
    SELECT q.pid FROM (SELECT DISTINCT ev.pid FROM ev) q
    WHERE v_all OR ht_can_see_person(q.pid)
  )
  SELECT ev.pid, ev.k, ev.sev, ev.src, ev.conf, count(*)::int
  FROM ev
  WHERE ev.pid IN (SELECT seen.pid FROM seen)
  GROUP BY ev.pid, ev.k, ev.sev, ev.src, ev.conf
  ORDER BY ev.pid, ev.k, ev.sev, ev.src, ev.conf;
END $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- New functions arrive executable by PUBLIC (and by anon through Supabase's
-- default privileges): members and the service role only, and the caller
-- test is for the definers' own use.
REVOKE ALL ON FUNCTION public.ht_caller_is_service() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ht_can_see_person(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driving_rollup(UUID, UUID[], DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driving_person_events(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ht_caller_is_service() TO service_role;
GRANT EXECUTE ON FUNCTION public.ht_can_see_person(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driving_rollup(UUID, UUID[], DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driving_person_events(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
