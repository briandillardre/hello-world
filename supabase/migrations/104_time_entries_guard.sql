-- 104_time_entries_guard.sql — time cards are payroll now (103), so the rows
-- have to be tamper-evident (sec-check P1, Sep 9 2026). The 015 policy was
-- FOR ALL on company match: any member could PATCH any entry's hours — or
-- forge the new audit columns — straight through PostgREST with their own
-- session token, and /timecards, the CSV, the QuickBooks push and the AI
-- would all read it as truth.
--
-- 1. Policies: SELECT stays company-wide (the read model every surface
--    already assumes); INSERT only your own rows; UPDATE only your own rows;
--    no client DELETE at all. Manager corrections go through
--    adjustTimeEntryAction on the service role and keep the original times.
-- 2. Column guard (BEFORE UPDATE, the 096 shape): a session may only CLOSE
--    its own open entry — clock_out_at + out_lat/out_lng, once. Every other
--    column is server-side. Clock-in/out in lib/actions/fieldops.ts already
--    writes exactly that.
-- 3. timecard_gps_stats: cap the id array — one call with a company's ~3,000
--    entry ids was ~8.6M point-in-polygon tests on Micro compute.

DROP POLICY IF EXISTS "company time entries" ON time_entries;

DROP POLICY IF EXISTS "time entries: read company" ON time_entries;
CREATE POLICY "time entries: read company" ON time_entries
  FOR SELECT USING (company_id = current_company_id());

DROP POLICY IF EXISTS "time entries: insert own" ON time_entries;
CREATE POLICY "time entries: insert own" ON time_entries
  FOR INSERT WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "time entries: update own" ON time_entries;
CREATE POLICY "time entries: update own" ON time_entries
  FOR UPDATE USING (company_id = current_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION guard_time_entry_cols()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.role(), 'postgres') NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF NEW.company_id          IS DISTINCT FROM OLD.company_id
       OR NEW.user_id             IS DISTINCT FROM OLD.user_id
       OR NEW.person_name         IS DISTINCT FROM OLD.person_name
       OR NEW.category            IS DISTINCT FROM OLD.category
       OR NEW.project_geofence_id IS DISTINCT FROM OLD.project_geofence_id
       OR NEW.plan                IS DISTINCT FROM OLD.plan
       OR NEW.clock_in_at         IS DISTINCT FROM OLD.clock_in_at
       OR NEW.created_at          IS DISTINCT FROM OLD.created_at
       OR NEW.in_lat              IS DISTINCT FROM OLD.in_lat
       OR NEW.in_lng              IS DISTINCT FROM OLD.in_lng
       OR NEW.idempotency_key     IS DISTINCT FROM OLD.idempotency_key
       OR NEW.break_minutes       IS DISTINCT FROM OLD.break_minutes
       OR NEW.edited_by           IS DISTINCT FROM OLD.edited_by
       OR NEW.edited_at           IS DISTINCT FROM OLD.edited_at
       OR NEW.edit_note           IS DISTINCT FROM OLD.edit_note
       OR NEW.original_in_at      IS DISTINCT FROM OLD.original_in_at
       OR NEW.original_out_at     IS DISTINCT FROM OLD.original_out_at
       -- Closing is a one-way door: an already-closed entry cannot be
       -- reopened or re-timed from a session.
       OR (OLD.clock_out_at IS NOT NULL AND NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at)
       OR (OLD.clock_out_at IS NOT NULL AND (NEW.out_lat IS DISTINCT FROM OLD.out_lat OR NEW.out_lng IS DISTINCT FROM OLD.out_lng))
    THEN
      RAISE EXCEPTION 'time entries can only be closed from the app; corrections are made by a manager on the Time cards page';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS time_entries_guard_cols ON time_entries;
CREATE TRIGGER time_entries_guard_cols
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_time_entry_cols();

-- Same function as 103, with the array capped.
CREATE OR REPLACE FUNCTION timecard_gps_stats(p_entry_ids UUID[])
RETURNS TABLE (entry_id UUID, fixes INTEGER, on_site INTEGER, first_fix TIMESTAMPTZ, last_fix TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT te.id,
         COUNT(l.id)::int,
         COUNT(l.id) FILTER (WHERE g.id IS NOT NULL AND ST_Contains(g.geometry, l.geom))::int,
         MIN(l.timestamp),
         MAX(l.timestamp)
  FROM time_entries te
  LEFT JOIN LATERAL (
    SELECT a.id FROM assets a
    WHERE a.company_id = te.company_id AND a.tracker_id = 'phone-' || te.user_id::text
    ORDER BY a.active DESC, a.created_at DESC
    LIMIT 1
  ) ph ON true
  LEFT JOIN geofences g ON g.id = te.project_geofence_id
  LEFT JOIN asset_locations l
    ON l.asset_id = ph.id
   AND l.timestamp >= te.clock_in_at
   AND l.timestamp <= COALESCE(te.clock_out_at, now())
   AND l.timestamp <= te.clock_in_at + interval '24 hours'
  WHERE te.id = ANY (p_entry_ids[1:500])
  GROUP BY te.id;
$$;
