-- 058: account deletion requests — Apple App Store guideline 5.1.1(v)
-- requires an IN-APP way to initiate account deletion. The in-app button
-- files a request here; deletion is completed within the 30-day window the
-- privacy policy promises (manual for now, automated later).

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL,
  user_id      UUID NOT NULL,
  email        TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS adr_open_idx ON account_deletion_requests(requested_at) WHERE completed_at IS NULL;

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;
-- Users may file + see their own request; completion is service-role work.
DROP POLICY IF EXISTS "own deletion requests" ON account_deletion_requests;
CREATE POLICY "own deletion requests" ON account_deletion_requests
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
