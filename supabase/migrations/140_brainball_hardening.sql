-- Brain Ball hardening (sec-check follow-up on 139):
-- 1. prospect lockdown — the 119 house rule every new RLS table carries
-- 2. payload size cap — /register is open signup; an unbounded jsonb column
--    is a storage-abuse channel on an IO-sensitive instance (the game
--    client stores ~4 profiles with history capped at 500, well under 256KB)
-- 3. delete policy — a parent can remove the kids' cloud backup themselves

SELECT ht_prospect_lockdown('brainball_profiles', false);

ALTER TABLE brainball_profiles
  ADD CONSTRAINT brainball_payload_size CHECK (pg_column_size(payload) <= 262144);

CREATE POLICY "own brainball profiles - delete"
  ON brainball_profiles FOR DELETE
  USING (auth.uid() = user_id);
