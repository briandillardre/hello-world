-- 152 — The job: one record per site from the first bid to the final lien
-- waiver (Brian, Nov 8: "Make sure the Preconstruction, Estimating,
-- checklists, etc. Have a natural flow on into project management flow,
-- photos, tracking, aia pay apps (we currently use sheets) … Ideally this
-- basically runs my business").
--
--   JOBS           the project log's row: stage (Estimating → Submitted →
--                  Awarded → Active → Substantially complete → Financial
--                  closeout → Closed, or On hold / Lost / No bid / Cancelled),
--                  the customer and their job number, the owner, contract
--                  number and date, scope and exclusions, types, the dates,
--                  the PM and superintendent, the address. One per site: the
--                  site zone stays the project (046's zone = project = QBO
--                  customer rule; the job number lives in the zone name).
--   JOB_MONEY      the dollars on it — bid, original contract, retainage on
--                  work and on stored material, bonded. Behind the costs
--                  ability, like every price since 130.
--   JOB_CHECKLIST  the job's own copy of the company's stage checklist (bid ·
--                  won · mobilize · monthly · closeout), each item done by
--                  whom and when, with a note. Items link into the app — the
--                  takeoff, the estimate, the machine files, the photos.
--   JOB_CONTACTS   the GC's PM and super, the owner's rep, the engineer, the
--                  surveyor, suppliers, inspectors — typed in by the company.
--   JOB_TEMPLATES  the company's checklist template (one row per company).
--
-- Reads: company members (never a prospect); dollars only with the costs
-- ability. Writes: lib/actions/jobs.ts on the service role after the edit
-- and Jobs checks (the 138 pattern) — members hold SELECT only.

CREATE TABLE IF NOT EXISTS public.jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id        UUID NOT NULL UNIQUE REFERENCES geofences(id) ON DELETE CASCADE,
  stage              TEXT NOT NULL DEFAULT 'estimating' CHECK (stage IN (
                       'estimating', 'submitted', 'awarded', 'active', 'on_hold', 'substantial',
                       'closeout', 'closed', 'lost', 'no_bid', 'cancelled')),
  number             TEXT CHECK (number IS NULL OR char_length(number) BETWEEN 1 AND 20),
  customer           TEXT CHECK (customer IS NULL OR char_length(customer) <= 120),
  customer_job_no    TEXT CHECK (customer_job_no IS NULL OR char_length(customer_job_no) <= 60),
  owner_name         TEXT CHECK (owner_name IS NULL OR char_length(owner_name) <= 120),
  contract_no        TEXT CHECK (contract_no IS NULL OR char_length(contract_no) <= 60),
  contract_date      DATE,
  scope              TEXT CHECK (scope IS NULL OR char_length(scope) <= 1000),
  exclusions         TEXT CHECK (exclusions IS NULL OR char_length(exclusions) <= 2000),
  project_type       TEXT CHECK (project_type IS NULL OR char_length(project_type) <= 40),
  contract_type      TEXT CHECK (contract_type IS NULL OR contract_type IN ('lump_sum', 'unit_price', 'tm', 'internal')),
  billing_type       TEXT CHECK (billing_type IS NULL OR billing_type IN ('progress', 'unit_price', 'tm', 'milestone')),
  bid_due            DATE,
  award_date         DATE,
  ntp_date           DATE,
  start_date         DATE,
  target_completion  DATE,
  actual_completion  DATE,
  pm_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  super_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  address            TEXT CHECK (address IS NULL OR char_length(address) <= 200),
  city               TEXT CHECK (city IS NULL OR char_length(city) <= 80),
  county             TEXT CHECK (county IS NULL OR char_length(county) <= 80),
  state              TEXT CHECK (state IS NULL OR char_length(state) <= 40),
  zip                TEXT CHECK (zip IS NULL OR char_length(zip) <= 12),
  risk               TEXT CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high', 'critical')),
  lost_reason        TEXT CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 300),
  notes              TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  -- The estimate the job was won on (147), when there is one.
  estimate_id        UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON public.jobs (company_id, stage);

CREATE TABLE IF NOT EXISTS public.job_money (
  job_id                UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bid_amount            NUMERIC(14, 2) CHECK (bid_amount IS NULL OR (bid_amount >= 0 AND bid_amount <= 1000000000)),
  contract_amount       NUMERIC(14, 2) CHECK (contract_amount IS NULL OR (contract_amount >= 0 AND contract_amount <= 1000000000)),
  retainage_pct         NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (retainage_pct >= 0 AND retainage_pct <= 50),
  stored_retainage_pct  NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (stored_retainage_pct >= 0 AND stored_retainage_pct <= 50),
  bonded                BOOLEAN NOT NULL DEFAULT false,
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_checklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('bid', 'won', 'mobilize', 'monthly', 'closeout')),
  sort        INT NOT NULL DEFAULT 0,
  text        TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  link        TEXT CHECK (link IS NULL OR char_length(link) <= 20),
  required    BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  done_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_checklist_job_idx ON public.job_checklist (job_id, stage, sort) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'gc_pm', 'gc_super', 'billing', 'engineer', 'architect',
                  'surveyor', 'inspector', 'utility', 'sub', 'supplier', 'other')),
  company_name  TEXT CHECK (company_name IS NULL OR char_length(company_name) <= 120),
  name          TEXT CHECK (name IS NULL OR char_length(name) <= 120),
  email         TEXT CHECK (email IS NULL OR char_length(email) <= 200),
  phone         TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
  note          TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CHECK (company_name IS NOT NULL OR name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS job_contacts_job_idx ON public.job_contacts (job_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_templates (
  company_id  UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  -- [{stage, text, link, required}]
  checklist   JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(checklist) = 'array' AND pg_column_size(checklist) < 60000),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_money ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_templates ENABLE ROW LEVEL SECURITY;

-- A job is always on a company site (the actions refuse a personal zone, and
-- the 151 trigger below keeps a site with a job from turning personal), so
-- the company rule is the whole read rule.
DROP POLICY IF EXISTS "company jobs read" ON public.jobs;
CREATE POLICY "company jobs read" ON public.jobs
  FOR SELECT USING (company_id = current_company_id());
DROP POLICY IF EXISTS "costs read" ON public.job_money;
CREATE POLICY "costs read" ON public.job_money
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "company job checklist read" ON public.job_checklist;
CREATE POLICY "company job checklist read" ON public.job_checklist
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "company job contacts read" ON public.job_contacts;
CREATE POLICY "company job contacts read" ON public.job_contacts
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "company job templates read" ON public.job_templates;
CREATE POLICY "company job templates read" ON public.job_templates
  FOR SELECT USING (company_id = current_company_id());

REVOKE ALL ON public.jobs, public.job_money, public.job_checklist, public.job_contacts, public.job_templates FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.jobs, public.job_money, public.job_checklist, public.job_contacts, public.job_templates FROM authenticated;
GRANT SELECT ON public.jobs, public.job_money, public.job_checklist, public.job_contacts, public.job_templates TO authenticated;
SELECT ht_prospect_lockdown('jobs', false);
SELECT ht_prospect_lockdown('job_money', false);
SELECT ht_prospect_lockdown('job_checklist', false);
SELECT ht_prospect_lockdown('job_contacts', false);
SELECT ht_prospect_lockdown('job_templates', false);

-- 151's guard learns about jobs: a site with a job stays a company site.
CREATE OR REPLACE FUNCTION public.ht_geofence_keep_shared() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.owner_id IS NULL AND NEW.owner_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.jobs x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.plan_sets x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.takeoff_snapshots x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.bid_memos x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.estimates x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.borings x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.machine_files x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.dirt_takeoffs x WHERE x.geofence_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.zone_imagery x WHERE x.geofence_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'This site holds a job, plans or bid data, so it stays a company site.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ht_geofence_keep_shared() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
