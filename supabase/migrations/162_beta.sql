-- 162 — The Beta section (Brian, Nov 19: "Build all of this into hammertrack
-- in a beta section"). Ten field-and-office tools that ride data HammerTrack
-- already holds, plus the activation funnel and a public status page.
--
-- BETA_RECORDS: one table for the tools' typed records, the way job_documents
--   keeps many paper kinds in one table. `kind` says which tool; `data` holds
--   the tool's own fields, validated by lib/beta/registers.ts before any write
--   (members hold SELECT only — every write is lib/actions/beta.ts on the
--   service role after the session checks).
--     locate        an 811 ticket on a site (number, called, valid through)
--     rental        a third-party rental (vendor, rates, on/off rent) — dollars
--     credential    a crew member's card or cert (kind, number, expires)
--     lien          a job's lien settings (role, public, first/last furnished)
--     owning        a machine's ownership-cost inputs — dollars
--     haul_ticket   a quarry / plant / dump ticket (truck, tons, CY, source)
--     wage_rate     a job's prevailing wage line (classification, base, fringe)
--     worker_class  a person's certified-payroll class and pay — dollars
--     dvir          a driver vehicle inspection report (items, defects, sign-off)
--   costs_only is CHECKed by kind (rental / owning / worker_class), so a
--   dollar row is never readable without the costs ability in SQL.
--   A credential names a person's cards: Foreman and up read all of them, a
--   crew member reads only their own.
--
-- STATUS_CHECKS: one row per health-cron run — is the database answering, did
--   tracker data arrive, is the AI answering. The public /status page reads
--   them through the service role and shows only up/down by hour; no company
--   data, no counts.

CREATE TABLE IF NOT EXISTS public.beta_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('locate', 'rental', 'credential', 'lien', 'owning', 'haul_ticket', 'wage_rate', 'worker_class', 'dvir')),
  geofence_id  UUID REFERENCES public.geofences(id) ON DELETE CASCADE,
  asset_id     UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  person_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  data         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 24000),
  due_on       DATE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  costs_only   BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT beta_records_costs_by_kind CHECK (costs_only = (kind IN ('rental', 'owning', 'worker_class')))
);
CREATE INDEX IF NOT EXISTS beta_records_kind_idx ON public.beta_records (company_id, kind, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS beta_records_zone_idx ON public.beta_records (geofence_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS beta_records_asset_idx ON public.beta_records (asset_id) WHERE deleted_at IS NULL;
-- one lien sheet per job site, one ownership sheet per machine, one payroll class per person
CREATE UNIQUE INDEX IF NOT EXISTS beta_records_lien_uq ON public.beta_records (geofence_id) WHERE kind = 'lien' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS beta_records_owning_uq ON public.beta_records (asset_id) WHERE kind = 'owning' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS beta_records_worker_uq ON public.beta_records (company_id, person_id) WHERE kind = 'worker_class' AND deleted_at IS NULL;

ALTER TABLE public.beta_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read" ON public.beta_records;
CREATE POLICY "members read" ON public.beta_records FOR SELECT USING (
  company_id = current_company_id() AND deleted_at IS NULL
  AND (NOT costs_only OR ht_viewer_can_costs())
  AND (kind <> 'credential' OR ht_viewer_rank() >= 1 OR person_id = auth.uid())
);
REVOKE ALL ON public.beta_records FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.beta_records FROM authenticated;
GRANT SELECT ON public.beta_records TO authenticated;
SELECT ht_prospect_lockdown('beta_records', false);

CREATE TABLE IF NOT EXISTS public.status_checks (
  id          BIGSERIAL PRIMARY KEY,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  db_ok       BOOLEAN NOT NULL,
  ingest_ok   BOOLEAN,
  ai_ok       BOOLEAN
);
CREATE INDEX IF NOT EXISTS status_checks_time_idx ON public.status_checks (checked_at DESC);
ALTER TABLE public.status_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.status_checks FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.status_checks_id_seq FROM anon, authenticated;
SELECT ht_prospect_lockdown('status_checks', false);
