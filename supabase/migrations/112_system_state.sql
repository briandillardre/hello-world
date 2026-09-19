-- 112 — system_state: a small key/value table for platform-level cron memory.
--
-- First use: the health cron's set of silent hardware trackers. Lambdas
-- forget everything between runs, so the founder was pushed the SAME two dead
-- units every four hours (Brian, Sep 19: three identical "tracker silent"
-- notifications in sixteen hours). With the set remembered here, a run can
-- say what CHANGED — a unit went dark, a unit came back — and stay quiet
-- otherwise.
--
-- Service role only: RLS on with no policies, and the API roles' grants
-- revoked — the same shape 086 gave schema_migrations. Server code reads it
-- with the service client, which bypasses RLS.

CREATE TABLE IF NOT EXISTS public.system_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  REVOKE ALL ON TABLE public.system_state FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object OR insufficient_privilege THEN
    RAISE NOTICE '112: system_state grants left as-is (%)', SQLERRM;
END $$;
