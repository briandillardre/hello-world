-- 155 — Job cost: the budget by cost type, the costs that aren't already in
-- HammerTrack, and WIP (job flow, part 3; board #231). The PM Master's rules:
-- the budget is DIRECT cost from the awarded scope, by PCAT L / M / S / E (O
-- for the rest), F (fuel) and R (repairs) actual-only; the ORIGINAL budget
-- never changes, the CURRENT budget moves only by an approved change order's
-- cost impact (job_change_orders.cost_pcat says which type it lands on).
--
-- Most actuals feed themselves and are read where they already live: labor
-- from time cards clocked to the job × each person's loaded rate (their
-- phone asset's hourly_rate, 007), equipment from the hours ledger
-- (usage_daily × each machine's rates), material / fuel / repairs from job-
-- coded receipts. JOB_COSTS holds the rest — sub and supplier invoices,
-- payroll adjustments — typed or pasted from accounting.
--
-- All dollars: costs ability only (ht_viewer_can_costs), never a prospect.
-- Writes: lib/actions/jobcost.ts on the service role after the edit + Jobs +
-- costs checks; the budget is a Manager's.

CREATE TABLE IF NOT EXISTS public.job_budget_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  cost_code    TEXT CHECK (cost_code IS NULL OR char_length(cost_code) <= 40),
  description  TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  pcat         TEXT NOT NULL CHECK (pcat IN ('L', 'M', 'S', 'E', 'O')),
  original     NUMERIC(14, 2) NOT NULL CHECK (original BETWEEN -1000000000 AND 1000000000),
  sort         INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_budget_lines_job_idx ON public.job_budget_lines (job_id, sort) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  spent_on     DATE NOT NULL CHECK (spent_on >= '1990-01-01'),
  pcat         TEXT NOT NULL CHECK (pcat IN ('L', 'M', 'S', 'E', 'F', 'R', 'O')),
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount BETWEEN -1000000000 AND 1000000000),
  vendor       TEXT CHECK (vendor IS NULL OR char_length(vendor) <= 120),
  reference    TEXT CHECK (reference IS NULL OR char_length(reference) <= 60),
  description  TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_costs_job_idx ON public.job_costs (job_id, spent_on DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.job_change_orders ADD COLUMN IF NOT EXISTS cost_pcat TEXT
  CHECK (cost_pcat IS NULL OR cost_pcat IN ('L', 'M', 'S', 'E', 'O'));
-- The PM's own estimate at completion (blank = the current budget, or the cost so far when that is more).
ALTER TABLE public.job_money ADD COLUMN IF NOT EXISTS estimate_at_completion NUMERIC(14, 2)
  CHECK (estimate_at_completion IS NULL OR (estimate_at_completion >= 0 AND estimate_at_completion <= 1000000000));

ALTER TABLE public.job_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs read" ON public.job_budget_lines;
CREATE POLICY "costs read" ON public.job_budget_lines
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.job_costs;
CREATE POLICY "costs read" ON public.job_costs
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());

REVOKE ALL ON public.job_budget_lines, public.job_costs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.job_budget_lines, public.job_costs FROM authenticated;
GRANT SELECT ON public.job_budget_lines, public.job_costs TO authenticated;
SELECT ht_prospect_lockdown('job_budget_lines', false);
SELECT ht_prospect_lockdown('job_costs', false);

NOTIFY pgrst, 'reload schema';
