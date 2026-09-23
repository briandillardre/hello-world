-- 120_timecard_integrity.sql — Time card integrity (Sep 22 2026).
--
-- A landscaping prospect forwarded what his office found by reviewing
-- security footage against the timecards: one crew member clocking another
-- in at 5:20 AM who arrived at 5:39; a person clocked in 5:17 AM – 7:15 PM
-- and 6:11 AM – 1:22 PM on days his car was never on the property; and the
-- cameras had stopped recording after 5 PM. "These are the issues I'm
-- dealing with that with the right technology can be fixed." Brian: "Think
-- thru how we can help with this issue with our software and implement."
--
-- The phone already records where every shift goes (103). This is the
-- READING of that record against the clock, plus two policies a company can
-- turn on, so the office finds these on /timecards instead of on a camera:
--
-- 1. time_entries grows: the device that clocked in / out (a random id the
--    app keeps per phone — two people clocking in from ONE phone is the
--    buddy-punch tell), and an optional clock-in / clock-out photo (the
--    front camera, stored in a PRIVATE bucket, read through signed URLs by
--    the people who may see the card).
-- 2. companies.clock_policy (JSONB): { photoIn, photoOut, atSite, siteRadiusM }
--    — photo at clock-in / clock-out, and "you have to be at the site (or a
--    yard) to clock in". All off by default: nothing changes for a company
--    that never opens the card.
-- 3. timecard_gps_stats_v2(): the 103 numbers plus what the integrity flags
--    need — first and last fix INSIDE the site (arrived late / left early),
--    how far the phone travelled all shift (a phone left in a truck reads
--    as a few metres), the distance from the clock-in / clock-out fix to the
--    site, and whether that fix was inside a yard (a crew that meets at the
--    yard and drives out is not clocking in "away").
-- 4. The 104 column guard learns the new columns: a session may set the
--    clock-out device and photo only while CLOSING its own open entry;
--    the clock-in pair is server-written and never changes from a session.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS device_id      TEXT,
  ADD COLUMN IF NOT EXISTS out_device_id  TEXT,
  ADD COLUMN IF NOT EXISTS in_photo_path  TEXT,
  ADD COLUMN IF NOT EXISTS out_photo_path TEXT;

-- Bounded, and a photo path can only point INSIDE this row's own folder
-- (company/user/…) — a session cannot attach somebody else's object.
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_device_id_shape;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_device_id_shape
  CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9_-]{8,64}$');
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_out_device_id_shape;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_out_device_id_shape
  CHECK (out_device_id IS NULL OR out_device_id ~ '^[A-Za-z0-9_-]{8,64}$');
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_in_photo_path_shape;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_in_photo_path_shape
  CHECK (in_photo_path IS NULL OR (length(in_photo_path) <= 200
         AND position(company_id::text || '/' || user_id::text || '/' IN in_photo_path) = 1));
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_out_photo_path_shape;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_out_photo_path_shape
  CHECK (out_photo_path IS NULL OR (length(out_photo_path) <= 200
         AND position(company_id::text || '/' || user_id::text || '/' IN out_photo_path) = 1));

-- "Same phone as …": one device across two people in a week is the lookup.
CREATE INDEX IF NOT EXISTS time_entries_company_device_idx
  ON time_entries (company_id, device_id, clock_in_at DESC)
  WHERE device_id IS NOT NULL;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS clock_policy JSONB;

-- Clock-in / clock-out photos: PRIVATE. No policies, no grants — every read
-- is a signed URL minted by the server for a card the caller may see, every
-- write is the server (service role) after the action verified the bytes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clock-photos', 'clock-photos', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- ── The column guard (104), extended ────────────────────────────────────────
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
       -- 120: the clock-in device and photo are written with the row and
       -- never change from a session.
       OR NEW.device_id           IS DISTINCT FROM OLD.device_id
       OR NEW.in_photo_path       IS DISTINCT FROM OLD.in_photo_path
       -- Closing is a one-way door: an already-closed entry cannot be
       -- reopened or re-timed from a session — and (120) its clock-out
       -- device / photo are part of the close.
       OR (OLD.clock_out_at IS NOT NULL AND NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at)
       OR (OLD.clock_out_at IS NOT NULL AND (NEW.out_lat IS DISTINCT FROM OLD.out_lat OR NEW.out_lng IS DISTINCT FROM OLD.out_lng))
       OR (OLD.clock_out_at IS NOT NULL AND (NEW.out_device_id IS DISTINCT FROM OLD.out_device_id OR NEW.out_photo_path IS DISTINCT FROM OLD.out_photo_path))
    THEN
      RAISE EXCEPTION 'time entries can only be closed from the app; corrections are made by a manager on the Time cards page';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The trigger exists since 104; re-pointed here so this file stands alone.
DROP TRIGGER IF EXISTS time_entries_guard_cols ON time_entries;
CREATE TRIGGER time_entries_guard_cols
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_time_entry_cols();

-- ── The shift, read against the clock ───────────────────────────────────────
-- Same shape and cost as 103/104 (one range scan per entry on
-- asset_locations(asset_id, timestamp), invoker rights, ≤ 500 ids), plus:
--   first_on_site / last_on_site — the first and last fix INSIDE the site
--   spread_m   — the bounding box of the shift's fixes, corner to corner
--   in_dist_m / out_dist_m — clock-in / clock-out fix to the site polygon
--                (0 inside; NULL without a site or a fix)
--   in_at_yard / out_at_yard — that fix inside any of the company's yards
CREATE OR REPLACE FUNCTION timecard_gps_stats_v2(p_entry_ids UUID[])
RETURNS TABLE (
  entry_id UUID, fixes INTEGER, on_site INTEGER, first_fix TIMESTAMPTZ, last_fix TIMESTAMPTZ,
  first_on_site TIMESTAMPTZ, last_on_site TIMESTAMPTZ, spread_m INTEGER,
  in_dist_m INTEGER, out_dist_m INTEGER, in_at_yard BOOLEAN, out_at_yard BOOLEAN
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT te.id,
         s.fixes, s.on_site, s.first_fix, s.last_fix, s.first_on_site, s.last_on_site, s.spread_m,
         CASE WHEN g.id IS NOT NULL AND te.in_lat IS NOT NULL AND te.in_lng IS NOT NULL
              THEN ST_Distance(g.geometry::geography, ST_SetSRID(ST_MakePoint(te.in_lng, te.in_lat), 4326)::geography)::int END,
         CASE WHEN g.id IS NOT NULL AND te.out_lat IS NOT NULL AND te.out_lng IS NOT NULL
              THEN ST_Distance(g.geometry::geography, ST_SetSRID(ST_MakePoint(te.out_lng, te.out_lat), 4326)::geography)::int END,
         CASE WHEN te.in_lat IS NOT NULL AND te.in_lng IS NOT NULL THEN EXISTS (
           SELECT 1 FROM geofences y
           WHERE y.company_id = te.company_id AND y.kind = 'yard'
             AND ST_Contains(y.geometry, ST_SetSRID(ST_MakePoint(te.in_lng, te.in_lat), 4326))) END,
         CASE WHEN te.out_lat IS NOT NULL AND te.out_lng IS NOT NULL THEN EXISTS (
           SELECT 1 FROM geofences y
           WHERE y.company_id = te.company_id AND y.kind = 'yard'
             AND ST_Contains(y.geometry, ST_SetSRID(ST_MakePoint(te.out_lng, te.out_lat), 4326))) END
  FROM time_entries te
  LEFT JOIN LATERAL (
    SELECT a.id FROM assets a
    WHERE a.company_id = te.company_id AND a.tracker_id = 'phone-' || te.user_id::text
    ORDER BY a.active DESC, a.created_at DESC
    LIMIT 1
  ) ph ON true
  LEFT JOIN geofences g ON g.id = te.project_geofence_id
  LEFT JOIN LATERAL (
    SELECT COUNT(l.id)::int AS fixes,
           COUNT(l.id) FILTER (WHERE g.id IS NOT NULL AND ST_Contains(g.geometry, l.geom))::int AS on_site,
           MIN(l.timestamp) AS first_fix,
           MAX(l.timestamp) AS last_fix,
           MIN(l.timestamp) FILTER (WHERE g.id IS NOT NULL AND ST_Contains(g.geometry, l.geom)) AS first_on_site,
           MAX(l.timestamp) FILTER (WHERE g.id IS NOT NULL AND ST_Contains(g.geometry, l.geom)) AS last_on_site,
           CASE WHEN COUNT(l.id) > 1 THEN ST_Distance(
             ST_SetSRID(ST_MakePoint(MIN(l.lng), MIN(l.lat)), 4326)::geography,
             ST_SetSRID(ST_MakePoint(MAX(l.lng), MAX(l.lat)), 4326)::geography)::int ELSE 0 END AS spread_m
    FROM asset_locations l
    WHERE l.asset_id = ph.id
      AND l.timestamp >= te.clock_in_at
      AND l.timestamp <= COALESCE(te.clock_out_at, now())
      -- An entry someone forgot to close must not scan weeks of pings.
      AND l.timestamp <= te.clock_in_at + interval '24 hours'
  ) s ON true
  WHERE te.id = ANY (p_entry_ids[1:500]);
$$;

REVOKE ALL ON FUNCTION timecard_gps_stats_v2(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION timecard_gps_stats_v2(UUID[]) TO authenticated, service_role;
