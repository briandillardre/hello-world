-- 156 — Issues & actions, the job's documents, closeout that checks itself
-- (job flow, part 4; board #232).
--
-- ISSUES: the PM Master's Issues & Actions — numbered per job (I-1, I-2…),
-- category, priority, owner, who has to decide, due date, schedule days, the
-- resolution; an issue that becomes extra work points at its change order.
-- What it could cost lives in JOB_ISSUE_MONEY (costs only, the job_money
-- pattern) so the issue itself stays readable by everyone on the job.
--
-- DOCUMENTS: every paper a job collects, by type, in the private 'jobdocs'
-- bucket at <company>/<id> (signed upload, 10-minute signed download, a
-- download never shown inline). The money papers — contract, signed change
-- orders, lien waivers, invoices, the W-9, bonds — are COSTS ONLY: costs_only
-- is CHECKed against the type so no writer can mislabel one, and the read
-- policy hides them from logins without costs. Insurance, permits and bonds
-- carry an expiry date.
--
-- CLOSEOUT: moving a job to Closed is refused while its punch list, closeout
-- must-dos, change orders, issues, final application, payments or final lien
-- waiver are open (lib/jobs/closeout.ts) — a Manager may close it anyway with
-- a reason, written here with who and when.
--
-- Members hold SELECT only; every write is lib/actions/jobissues.ts,
-- lib/actions/jobdocs.ts or lib/actions/jobs.ts on the service role after the
-- edit + Jobs checks (dollars and money papers also need costs). Never a
-- prospect's.

CREATE TABLE IF NOT EXISTS public.job_issues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  number           INT NOT NULL CHECK (number BETWEEN 1 AND 9999),
  title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category         TEXT NOT NULL CHECK (category IN ('design', 'change', 'schedule', 'site', 'utility', 'permit', 'safety', 'quality', 'payment', 'other')),
  priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'resolved')),
  owner_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_from    TEXT CHECK (decision_from IS NULL OR char_length(decision_from) <= 120),
  due_on           DATE,
  schedule_days    INT CHECK (schedule_days IS NULL OR schedule_days BETWEEN -3650 AND 3650),
  detail           TEXT CHECK (detail IS NULL OR char_length(detail) <= 2000),
  resolution       TEXT CHECK (resolution IS NULL OR char_length(resolution) <= 2000),
  opened_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  resolved_on      DATE,
  change_order_id  UUID REFERENCES public.job_change_orders(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS job_issues_number_uidx ON public.job_issues (job_id, number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_issues_job_idx ON public.job_issues (job_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_issue_money (
  issue_id       UUID PRIMARY KEY REFERENCES public.job_issues(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id         UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  cost_exposure  NUMERIC(14, 2) CHECK (cost_exposure IS NULL OR cost_exposure BETWEEN -1000000000 AND 1000000000),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_issue_money_job_idx ON public.job_issue_money (job_id);

CREATE TABLE IF NOT EXISTS public.job_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('contract', 'change_order', 'lien_waiver', 'invoice', 'w9', 'bond',
                 'insurance', 'permit', 'submittal', 'rfi', 'inspection', 'warranty', 'asbuilt', 'correspondence', 'safety', 'other')),
  costs_only   BOOLEAN NOT NULL,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  doc_date     DATE,
  expires_on   DATE,
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  filename     TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  path         TEXT NOT NULL UNIQUE CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  size_bytes   BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  pay_app_id   UUID REFERENCES public.job_pay_apps(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  -- The money papers are costs-only by their type, whoever writes the row (lib/jobs/documents.ts COSTS_ONLY_KINDS).
  CONSTRAINT job_documents_costs_only_by_kind CHECK (costs_only = (kind IN ('contract', 'change_order', 'lien_waiver', 'invoice', 'w9', 'bond')))
);
CREATE INDEX IF NOT EXISTS job_documents_job_idx ON public.job_documents (job_id, kind) WHERE deleted_at IS NULL;

-- Who closed the job, when, and — when something was still open — why.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS closed_note TEXT CHECK (closed_note IS NULL OR char_length(closed_note) <= 500);

ALTER TABLE public.job_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_issue_money ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company read" ON public.job_issues;
CREATE POLICY "company read" ON public.job_issues
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "costs read" ON public.job_issue_money;
CREATE POLICY "costs read" ON public.job_issue_money
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "company read" ON public.job_documents;
CREATE POLICY "company read" ON public.job_documents
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND (NOT costs_only OR ht_viewer_can_costs()));

REVOKE ALL ON public.job_issues, public.job_issue_money, public.job_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.job_issues, public.job_issue_money, public.job_documents FROM authenticated;
GRANT SELECT ON public.job_issues, public.job_issue_money, public.job_documents TO authenticated;
SELECT ht_prospect_lockdown('job_issues', false);
SELECT ht_prospect_lockdown('job_issue_money', false);
SELECT ht_prospect_lockdown('job_documents', false);

-- The files: private, 50 MB, any type (they leave only as downloads).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('jobdocs', 'jobdocs', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
