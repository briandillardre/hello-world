-- 154 — Pay apps: the schedule of values, change orders and applications for
-- payment in the G702 / G703 layout (job flow, part 2; board #230). Brian:
-- "aia pay apps (we currently use sheets)" — DCG's per-job PA1, PA2… tabs.
--
--   JOB_SOV            the schedule of values: item, area, description,
--                      scheduled value, a line's own retainage % (variable
--                      retainage — the sheet's column I note).
--   JOB_CHANGE_ORDERS  CO1, CO2… potential → pricing → submitted → approved
--                      (or rejected / void): requested and approved amounts,
--                      the cost impact on the budget, schedule days. An
--                      approved change order joins the applications as its
--                      own line from its approval date — never before.
--   JOB_PAY_APPS       one per application: number, date, period to,
--                      retainage on work and stored material (or a final
--                      release), the entries (this period, stored), and —
--                      once sent — the frozen lines and G702 totals every
--                      later application builds on. Approved, paid (date and
--                      amount), lien waiver (partial / final) on it too.
--
-- All dollars: read with the costs ability only (ht_viewer_can_costs, 130),
-- never a prospect's. Writes: lib/actions/payapps.ts on the service role after
-- the edit + Jobs + costs checks (sending and voiding are a Manager's).

CREATE TABLE IF NOT EXISTS public.job_sov (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  item_no          TEXT NOT NULL DEFAULT '' CHECK (char_length(item_no) <= 12),
  area             TEXT CHECK (area IS NULL OR char_length(area) <= 60),
  description      TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  scheduled_value  NUMERIC(14, 2) NOT NULL CHECK (scheduled_value BETWEEN -1000000000 AND 1000000000),
  retainage_pct    NUMERIC(5, 2) CHECK (retainage_pct IS NULL OR (retainage_pct >= 0 AND retainage_pct <= 50)),
  sort             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_sov_job_idx ON public.job_sov (job_id, sort) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_change_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  number            INT NOT NULL CHECK (number BETWEEN 1 AND 999),
  customer_no       TEXT CHECK (customer_no IS NULL OR char_length(customer_no) <= 40),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description       TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  type              TEXT CHECK (type IS NULL OR type IN ('owner', 'field', 'design', 'scope', 'credit', 'other')),
  status            TEXT NOT NULL DEFAULT 'potential' CHECK (status IN ('potential', 'pricing', 'submitted', 'approved', 'rejected', 'void')),
  identified_on     DATE,
  submitted_on      DATE,
  approved_on       DATE,
  requested_amount  NUMERIC(14, 2) CHECK (requested_amount IS NULL OR requested_amount BETWEEN -1000000000 AND 1000000000),
  approved_amount   NUMERIC(14, 2) CHECK (approved_amount IS NULL OR approved_amount BETWEEN -1000000000 AND 1000000000),
  cost_impact       NUMERIC(14, 2) CHECK (cost_impact IS NULL OR cost_impact BETWEEN -1000000000 AND 1000000000),
  schedule_days     INT CHECK (schedule_days IS NULL OR schedule_days BETWEEN -1000 AND 1000),
  note              TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK (status <> 'approved' OR approved_amount IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_change_orders_number_uq ON public.job_change_orders (job_id, number) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_pay_apps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  app_no                INT NOT NULL CHECK (app_no BETWEEN 1 AND 999),
  app_date              DATE NOT NULL,
  period_to             DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'void')),
  retainage_pct         NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (retainage_pct >= 0 AND retainage_pct <= 50),
  stored_retainage_pct  NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (stored_retainage_pct >= 0 AND stored_retainage_pct <= 50),
  release               BOOLEAN NOT NULL DEFAULT false,
  -- While a draft: {"<line key>": {"thisPeriod": n, "stored": n}}. Once sent, the
  -- frozen lines and totals below are the application of record.
  entries               JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(entries) = 'object' AND pg_column_size(entries) < 200000),
  lines                 JSONB CHECK (lines IS NULL OR (jsonb_typeof(lines) = 'array' AND pg_column_size(lines) < 400000)),
  totals                JSONB CHECK (totals IS NULL OR (jsonb_typeof(totals) = 'object' AND pg_column_size(totals) < 8000)),
  invoice_no            TEXT CHECK (invoice_no IS NULL OR char_length(invoice_no) <= 40),
  note                  TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  submitted_at          TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  paid_on               DATE,
  paid_amount           NUMERIC(14, 2) CHECK (paid_amount IS NULL OR paid_amount BETWEEN -1000000000 AND 1000000000),
  waiver                TEXT NOT NULL DEFAULT 'none' CHECK (waiver IN ('none', 'partial', 'final')),
  waiver_on             DATE,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  CHECK (period_to >= '1990-01-01' AND app_date >= '1990-01-01'),
  CHECK (status = 'draft' OR status = 'void' OR (lines IS NOT NULL AND totals IS NOT NULL))
);
-- A voided application frees its number: the resubmission is Application No. 2 again.
CREATE UNIQUE INDEX IF NOT EXISTS job_pay_apps_no_uq ON public.job_pay_apps (job_id, app_no) WHERE deleted_at IS NULL AND status <> 'void';
CREATE INDEX IF NOT EXISTS job_pay_apps_company_idx ON public.job_pay_apps (company_id, status) WHERE deleted_at IS NULL;

ALTER TABLE public.job_sov ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_pay_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "costs read" ON public.job_sov;
CREATE POLICY "costs read" ON public.job_sov
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.job_change_orders;
CREATE POLICY "costs read" ON public.job_change_orders
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.job_pay_apps;
CREATE POLICY "costs read" ON public.job_pay_apps
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());

REVOKE ALL ON public.job_sov, public.job_change_orders, public.job_pay_apps FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.job_sov, public.job_change_orders, public.job_pay_apps FROM authenticated;
GRANT SELECT ON public.job_sov, public.job_change_orders, public.job_pay_apps TO authenticated;
SELECT ht_prospect_lockdown('job_sov', false);
SELECT ht_prospect_lockdown('job_change_orders', false);
SELECT ht_prospect_lockdown('job_pay_apps', false);

NOTIFY pgrst, 'reload schema';
