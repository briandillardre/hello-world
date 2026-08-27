-- 079: the insights engine — "AI that watches so nobody has to know what to
-- ask" (Brian, Aug 27). Two pieces:
--
--   company_metrics_daily — one row per company per LOCAL day: the numbers
--   the trend detectors reason over (tracked cost, hours, per-zone splits,
--   alert counts, receipts outstanding…). Deterministic rollup of tables
--   that already exist (usage_daily, alert_events, expenses, …) — the model
--   never invents a number, it only narrates these.
--
--   insights — the detector findings. ONE live row per story
--   (company_id + fingerprint unique): the nightly engine upserts in place,
--   so a story that hasn't changed can't pile up copies — the anti-cry-wolf
--   rule is in the schema, not just the UI. Rows carry the evidence numbers
--   and a deep link; `money` marks dollar-bearing rows so cost-gated roles
--   never see them (same rule as costToday on the wire).
--
-- Writes happen ONLY through the service-role engine (cron + lazy first
-- run); members read their company's rows. Dismissal is a service-role
-- update behind an authenticated route, so no user-facing write policy.

CREATE TABLE IF NOT EXISTS company_metrics_daily (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, day)
);

ALTER TABLE company_metrics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company metrics read" ON company_metrics_daily;
CREATE POLICY "company metrics read" ON company_metrics_daily
  FOR SELECT USING (company_id = current_company_id());

CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  detector TEXT NOT NULL,
  -- detector + subject (e.g. "burn_pace:<zone id>") — the story's identity.
  fingerprint TEXT NOT NULL,
  -- 1 = worth knowing · 2 = worth a look · 3 = costing you money right now
  severity SMALLINT NOT NULL DEFAULT 1,
  headline TEXT NOT NULL,
  detail TEXT,
  -- The numbers behind the claim. `magnitude` inside is the suppression
  -- scalar: re-fires only when it moves enough (engine rule, ±20%).
  evidence JSONB NOT NULL DEFAULT '{}',
  link TEXT,
  money BOOLEAN NOT NULL DEFAULT false,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A story the engine stops re-asserting goes quiet on its own.
  expires_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (company_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS insights_company_live_idx ON insights(company_id, fired_at DESC);

ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company insights read" ON insights;
CREATE POLICY "company insights read" ON insights
  FOR SELECT USING (company_id = current_company_id());
