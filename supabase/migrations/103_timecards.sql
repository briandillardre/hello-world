-- 103_timecards.sql — Time clock v2 (Sep 9 2026 — Brian: "clock in also a
-- must and mandatory tracking thru app while clocked in"; the bar is
-- Workyard's "GPS-verified time cards straight to payroll").
--
-- 1. time_entries grows payroll fields: an unpaid break, and an edit trail —
--    a manager fixing a forgotten clock-out keeps the ORIGINAL times beside
--    the corrected ones, with who / when / why. Nothing here changes how the
--    crew clocks in or out.
-- 2. timecard_gps_stats(): per entry, the person's PHONE fixes between
--    clock-in and clock-out (or now) — how many, how many fell inside the
--    shift's job-site polygon, first and last. That is the "GPS-verified"
--    number on /timecards, computed where the rows live: one range scan per
--    entry on asset_locations(asset_id, timestamp) from 001. Invoker rights,
--    so the caller's RLS decides what it may count.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS break_minutes   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edited_by       UUID,
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_note       TEXT,
  ADD COLUMN IF NOT EXISTS original_in_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_out_at TIMESTAMPTZ;

-- Bounded: a break is minutes within a day; a note is a sentence or two.
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_break_minutes_check;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_break_minutes_check
  CHECK (break_minutes >= 0 AND break_minutes <= 720);
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_edit_note_len;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_edit_note_len
  CHECK (edit_note IS NULL OR length(edit_note) <= 500);

-- One person's week: (company, person, newest first).
CREATE INDEX IF NOT EXISTS time_entries_company_user_time_idx
  ON time_entries (company_id, user_id, clock_in_at DESC);

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
  -- The person's phone asset (Share location / the shift tracker write to
  -- it): one per user by construction; prefer the active row if a stale
  -- duplicate ever exists.
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
   -- An entry someone forgot to close must not scan weeks of pings.
   AND l.timestamp <= te.clock_in_at + interval '24 hours'
  WHERE te.id = ANY (p_entry_ids)
  GROUP BY te.id;
$$;

REVOKE ALL ON FUNCTION timecard_gps_stats(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION timecard_gps_stats(UUID[]) TO authenticated, service_role;
