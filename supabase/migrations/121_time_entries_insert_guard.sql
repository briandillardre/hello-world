-- 121_time_entries_insert_guard.sql — the reviewer pass on 120 (Sep 23 2026).
--
-- 104 guards UPDATE: a session may only CLOSE its own open entry. INSERT was
-- open — a member's own JWT could insert a row that is already closed, with a
-- photo path that points at nothing, a break, an "edit" trail — and 120's
-- photo policy read the fake path as "photo present" (sec-check P2). A
-- session may only OPEN an entry: clock-in fields only. Everything else is
-- written by the server (service role): the clock-in photo path right after
-- the insert, the close from the app (UPDATE, still guarded by 104/120),
-- corrections by a manager.

CREATE OR REPLACE FUNCTION guard_time_entry_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.role(), 'postgres') NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF NEW.clock_out_at    IS NOT NULL
       OR NEW.out_lat         IS NOT NULL
       OR NEW.out_lng         IS NOT NULL
       OR NEW.out_device_id   IS NOT NULL
       OR NEW.out_photo_path  IS NOT NULL
       OR NEW.in_photo_path   IS NOT NULL
       OR COALESCE(NEW.break_minutes, 0) <> 0
       OR NEW.edited_by       IS NOT NULL
       OR NEW.edited_at       IS NOT NULL
       OR NEW.edit_note       IS NOT NULL
       OR NEW.original_in_at  IS NOT NULL
       OR NEW.original_out_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'a time entry can only be opened from the app; it is closed from the app and corrected by a manager on the Time cards page';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS time_entries_guard_insert ON time_entries;
CREATE TRIGGER time_entries_guard_insert
  BEFORE INSERT ON time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_time_entry_insert();
