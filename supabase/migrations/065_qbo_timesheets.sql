-- 065: QBO timesheets — GPS-verified clock-ins/outs become QuickBooks
-- TimeActivity rows (employee, date, hours, CustomerRef = the job-site zone),
-- so payroll and job costing run off hours the trackers can vouch for.
-- Uses the EXISTING QBO connection (qbo_connections, lib/qbo.ts) — this is
-- the TimeActivity API, not QuickBooks Time.
--
-- Zone → customer mapping is NOT added here: geofences.qbo_customer_id
-- already exists (migration 037) and the invoice flow keeps it fresh — the
-- timesheet push reuses (and back-fills) the same column.

-- ── Worker → QBO employee mapping ────────────────────────────────────────────
-- time_entries identify the worker by user_id (the profile id); one QBO
-- employee per worker per company, editable on the Accounting page.
CREATE TABLE IF NOT EXISTS qbo_employee_map (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,
  qbo_employee_id   TEXT NOT NULL,
  -- Display name snapshot so the mapping card renders without a QBO round-trip.
  qbo_employee_name TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);

-- ── Push ledger (idempotency + audit) ────────────────────────────────────────
-- One row per time entry, claimed BEFORE the QBO call:
--   pending → claimed, API call in flight (a crashed push stays visible)
--   pushed  → TimeActivity created; the UNIQUE(time_entry_id) makes retries
--             and double-taps no-ops — an entry can never post twice
--   error   → QBO rejected it; the error column says why and the next push
--             of that day re-claims and retries just the failed entries
CREATE TABLE IF NOT EXISTS qbo_time_pushes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  time_entry_id       UUID NOT NULL UNIQUE REFERENCES time_entries(id) ON DELETE CASCADE,
  qbo_timeactivity_id TEXT,
  hours               NUMERIC,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'pushed', 'error')),
  error               TEXT,
  pushed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qbo_time_pushes_company_idx
  ON qbo_time_pushes(company_id, pushed_at DESC);

-- ── RLS (company-scoped, same pattern as 015) ────────────────────────────────
ALTER TABLE qbo_employee_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_time_pushes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company qbo employee map" ON qbo_employee_map;
CREATE POLICY "company qbo employee map" ON qbo_employee_map
  FOR ALL USING (company_id = current_company_id());

DROP POLICY IF EXISTS "company qbo time pushes" ON qbo_time_pushes;
CREATE POLICY "company qbo time pushes" ON qbo_time_pushes
  FOR ALL USING (company_id = current_company_id());
