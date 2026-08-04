-- 050: work orders — the enterprise maintenance layer ("we take back seat
-- to no one" — Brian, Aug 3). Tenna's moat is schedule → work order → cost
-- → history; we already had the two ends, this is the middle. Our edges:
-- WOs auto-open from REAL telemetry readings (OBD hours/miles, AEMP), and
-- completed costs land in the same service history + QBO books as
-- everything else, with no per-seat fee for mechanics.

CREATE TABLE IF NOT EXISTS work_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  detail        TEXT,
  -- What opened it: a human, an overdue schedule, an OEM fault code, or a
  -- vehicle-health alert. source_ref carries the schedule id / fault code so
  -- auto-generation stays idempotent (partial unique index below).
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule','fault','health')),
  source_ref    TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_parts','done','canceled')),
  assignee_id   UUID,
  due_date      DATE,
  -- Odometer/engine-hours when opened — pulled from live telemetry, not typed.
  reading       NUMERIC,
  parts_cost    NUMERIC NOT NULL DEFAULT 0,
  labor_hours   NUMERIC NOT NULL DEFAULT 0,
  labor_rate    NUMERIC,
  -- Completion links the WO to the service_records row it wrote.
  service_record_id UUID REFERENCES service_records(id) ON DELETE SET NULL,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS work_orders_company_idx ON work_orders(company_id, status, created_at DESC);
-- One OPEN auto-generated WO per trigger — re-running the generator never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_auto_uidx
  ON work_orders(company_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND status NOT IN ('done','canceled');

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company work orders" ON work_orders;
CREATE POLICY "company work orders" ON work_orders
  FOR ALL USING (company_id = current_company_id());
