-- 067: Idempotency hardening + replay visibility (task #29 — reviewer
-- follow-ups from the offline-queue/QBO-timesheet wave).

-- (a) Company-scoped idempotency. The 066 unique indexes were GLOBAL: a key
-- collision across tenants (or a key deliberately copied from another
-- company) would make an unrelated company's replay hit 23505 and report
-- "already recorded" — silently discarding a real clock-in or writeup.
-- Uniqueness only ever needs to hold within one company.
DROP INDEX IF EXISTS time_entries_idem_key_idx;
DROP INDEX IF EXISTS daily_logs_idem_key_idx;
DROP INDEX IF EXISTS equipment_checks_idem_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_idem_co_key_idx
  ON time_entries (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_idem_co_key_idx
  ON daily_logs (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_checks_idem_co_key_idx
  ON equipment_checks (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- (b) Replay visibility: when an offline replay arrives without the
-- in-session photo Files (the app was closed before coverage returned),
-- required-photo rules relax so the writeup isn't lost — but the office
-- should SEE that the photo requirement was waived, not assume the form
-- was completed as designed.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS photos_waived BOOLEAN NOT NULL DEFAULT FALSE;
