-- 066: Offline field queue — idempotency keys for replayed field events.
-- Jobsites are dead zones: the phone queues failed clock-ins/outs and QR
-- checks (lib/offline-queue.ts) and replays them when coverage returns. Each
-- attempt carries a client-generated UUID; the partial unique indexes below
-- make the replay a safe no-op when the original attempt actually landed
-- (insert hits 23505 → the action returns ok — the earlier attempt won).
-- Rows written without a key (online path, pre-066 clients) stay NULL and
-- are untouched by the partial indexes.

ALTER TABLE time_entries     ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE daily_logs       ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE equipment_checks ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_idem_key_idx
  ON time_entries (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_idem_key_idx
  ON daily_logs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_checks_idem_key_idx
  ON equipment_checks (idempotency_key) WHERE idempotency_key IS NOT NULL;
