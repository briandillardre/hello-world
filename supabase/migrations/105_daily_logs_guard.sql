-- 105_daily_logs_guard.sql — daily logs get the 104 treatment (sec-check on
-- the photos PR, Sep 9; task #60). 015's policy was FOR ALL on company match:
-- any member could rewrite or delete a coworker's daily log — the writeup,
-- the safety note, the photo list the office reads every morning.
--
-- The app's only session-side write is the clock-out INSERT of the person's
-- own log (lib/actions/fieldops.ts); photos/receipts on it are written by the
-- server. So: SELECT company-wide (the morning read), INSERT own rows only,
-- and no client UPDATE or DELETE at all — corrections, when they come, go
-- through a server action on the service role, the way time cards do.

DROP POLICY IF EXISTS "company daily logs" ON daily_logs;

DROP POLICY IF EXISTS "daily logs: read company" ON daily_logs;
CREATE POLICY "daily logs: read company" ON daily_logs
  FOR SELECT USING (company_id = current_company_id());

DROP POLICY IF EXISTS "daily logs: insert own" ON daily_logs;
CREATE POLICY "daily logs: insert own" ON daily_logs
  FOR INSERT WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());
