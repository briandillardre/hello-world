-- 126 — DOT short-haul time records (lib/short-haul.ts, /timecards/short-haul).
--
-- Brian, Oct 1 2026, of the gaps against Linxup: "Dashcams, eld logbooks,
-- buying online. Let's solve this." Most contractor drivers need no ELD:
-- the federal short-haul exception (49 CFR 395.1(e)) asks only for time
-- records — when the driver reported, hours on duty, when released, the
-- prior 7 days — on days they stay within 150 air-miles and are released
-- within 14 hours. The time clock already holds all of it; this adds the
-- two things it lacked.
--
-- 1. profiles.driver_class — who drives a commercial vehicle: 'cdl' (the
--    (e)(1) rules) or 'cmv' (no CDL, the (e)(2) rules). NULL = not a
--    commercial driver, no record. Written by the service role behind
--    setDriverClassAction's team + rank checks (profiles stay write-locked
--    for sessions, 068); read under the existing profile policies.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS driver_class TEXT;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_driver_class_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_driver_class_check
  CHECK (driver_class IS NULL OR driver_class IN ('cmv', 'cdl'));

-- 2. shorthaul_reach() — for each time entry, the farthest the person's
--    phone went from the given reporting point (the day's first clock-in,
--    computed by the caller) between clock-in and clock-out, in metres, and
--    how many fixes that rests on. Same shape and cost as 120's
--    timecard_gps_stats_v2: one range scan per entry on
--    asset_locations(asset_id, timestamp), capped at 24 h for an entry
--    nobody closed, ≤ 500 entries per call, invoker rights.
CREATE OR REPLACE FUNCTION shorthaul_reach(p_entry_ids UUID[], p_lat DOUBLE PRECISION[], p_lng DOUBLE PRECISION[])
RETURNS TABLE (entry_id UUID, fixes INTEGER, reach_m INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT te.id, COALESCE(s.fixes, 0), s.reach_m
  FROM unnest(p_entry_ids[1:500], p_lat[1:500], p_lng[1:500]) AS o(entry_id, lat, lng)
  JOIN time_entries te ON te.id = o.entry_id
  LEFT JOIN LATERAL (
    SELECT a.id FROM assets a
    WHERE a.company_id = te.company_id AND a.tracker_id = 'phone-' || te.user_id::text
    ORDER BY a.active DESC, a.created_at DESC
    LIMIT 1
  ) ph ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(l.id)::int AS fixes,
           CASE WHEN o.lat IS NULL OR o.lng IS NULL THEN NULL
                ELSE MAX(ST_DistanceSphere(l.geom, ST_SetSRID(ST_MakePoint(o.lng, o.lat), 4326)))::int END AS reach_m
    FROM asset_locations l
    WHERE l.asset_id = ph.id
      AND l.timestamp >= te.clock_in_at
      AND l.timestamp <= COALESCE(te.clock_out_at, now())
      AND l.timestamp <= te.clock_in_at + interval '24 hours'
  ) s ON true;
$$;

REVOKE ALL ON FUNCTION shorthaul_reach(UUID[], DOUBLE PRECISION[], DOUBLE PRECISION[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION shorthaul_reach(UUID[], DOUBLE PRECISION[], DOUBLE PRECISION[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
