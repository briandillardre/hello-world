-- 100 · Device tokens belong to their owner (sec-check, Sep 9 2026).
--
-- 029's single FOR ALL policy checked only company_id, so any member could
-- INSERT a device_tokens row carrying a TEAMMATE's user_id and their own FCM
-- token — and from then on receive every per-person push meant for that
-- teammate (the receipt chase now carries merchant, amount and the capture
-- link). Reads stay company-wide (the fallback fan-out needs them); writes
-- are pinned to auth.uid(). The register route writes through the service
-- client (identity still from the session), so a handed-down phone can be
-- taken over by its new owner.
DROP POLICY IF EXISTS "company device tokens" ON device_tokens;
DROP POLICY IF EXISTS "device tokens: read company" ON device_tokens;
DROP POLICY IF EXISTS "device tokens: insert own" ON device_tokens;
DROP POLICY IF EXISTS "device tokens: update own" ON device_tokens;
DROP POLICY IF EXISTS "device tokens: delete own" ON device_tokens;
CREATE POLICY "device tokens: read company" ON device_tokens
  FOR SELECT USING (company_id = current_company_id());
CREATE POLICY "device tokens: insert own" ON device_tokens
  FOR INSERT WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());
CREATE POLICY "device tokens: update own" ON device_tokens
  FOR UPDATE USING (company_id = current_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = current_company_id() AND user_id = auth.uid());
CREATE POLICY "device tokens: delete own" ON device_tokens
  FOR DELETE USING (company_id = current_company_id() AND user_id = auth.uid());

-- 099 added an index identical to 030's expenses_company_status_idx.
DROP INDEX IF EXISTS expenses_company_status_txn_idx;
