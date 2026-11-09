-- 160 — Production: what got BUILT against what was BID (Brian, Nov 9, of an
-- HCSS ad: "Make sure we are beating hcss on our features, cleanliness, and
-- ease of use"). HCSS HeavyJob's heart is foremen logging quantities AND
-- hours by cost code every day. Here the foreman logs only the QUANTITY —
-- the hours already live in HammerTrack (GPS time cards clocked to the site,
-- every tracked machine's hours on it, the same sources job cost reads), and
-- lib/jobs/production.ts shares each day's cost across the items worked that
-- day by the value each earned.
--
-- JOB_ITEMS = the bid scope by item (from the won estimate, or typed):
-- quantity, unit, bid production per crew-day, and the DIRECT unit cost.
-- JOB_QUANTITIES = one number per item per day.
--
-- Money: bid_unit_cost is NOT granted to members — it's read on the server
-- for logins with the costs ability only, so a Foreman logs and reads
-- quantities and rates but never a dollar. Writes: lib/actions/production.ts
-- on the service role after the edit + Jobs checks (items: Managers; daily
-- quantities: anyone who can edit with Jobs open — Foreman and up by default).

CREATE TABLE IF NOT EXISTS public.job_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id         UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  code           TEXT CHECK (code IS NULL OR char_length(code) <= 40),
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  unit           TEXT NOT NULL CHECK (unit IN ('CY', 'TON', 'SY', 'SF', 'LF', 'EA', 'LOAD', 'AC', 'LS')),
  budget_qty     NUMERIC(14, 3) NOT NULL CHECK (budget_qty > 0 AND budget_qty <= 100000000),
  bid_per_day    NUMERIC(14, 3) CHECK (bid_per_day IS NULL OR (bid_per_day > 0 AND bid_per_day <= 100000000)),
  bid_unit_cost  NUMERIC(14, 4) CHECK (bid_unit_cost IS NULL OR (bid_unit_cost >= 0 AND bid_unit_cost <= 100000000)),
  crew_name      TEXT CHECK (crew_name IS NULL OR char_length(crew_name) <= 80),
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_items_job_idx ON public.job_items (job_id, sort) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_quantities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES public.job_items(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  qty         NUMERIC(14, 3) NOT NULL CHECK (qty >= 0 AND qty <= 100000000),
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  entered_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one number per item per day: a re-entry replaces it (upsert on this)
CREATE UNIQUE INDEX IF NOT EXISTS job_quantities_item_day_uq ON public.job_quantities (item_id, day);
CREATE INDEX IF NOT EXISTS job_quantities_job_idx ON public.job_quantities (job_id, day);

ALTER TABLE public.job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_quantities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read" ON public.job_items;
CREATE POLICY "members read" ON public.job_items
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "members read" ON public.job_quantities;
CREATE POLICY "members read" ON public.job_quantities
  FOR SELECT USING (company_id = current_company_id());

REVOKE ALL ON public.job_items, public.job_quantities FROM anon;
REVOKE ALL ON public.job_items, public.job_quantities FROM authenticated;
-- every column but the money
GRANT SELECT (id, company_id, job_id, code, name, unit, budget_qty, bid_per_day, crew_name, sort, created_at, deleted_at) ON public.job_items TO authenticated;
GRANT SELECT ON public.job_quantities TO authenticated;
SELECT ht_prospect_lockdown('job_items', false);
SELECT ht_prospect_lockdown('job_quantities', false);
