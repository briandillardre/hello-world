-- 086: lock down the two public tables born OUTSIDE the migration files.
--
-- Supabase security advisor, Sep 1 2026 — "rls_disabled_in_public" (critical):
-- "Anyone with your project URL can read, edit, and delete all data in this
-- table because Row-Level Security is not enabled." Every table this repo
-- creates has had RLS since 001 (46/46 audited), so the exposed ones are:
--
--  1. schema_migrations — created by scripts/migrate.mjs (the deploy runner)
--     with a bare CREATE TABLE. Supabase's default grants hand anon +
--     authenticated full access to every new public table, so the PUBLIC
--     anon key (it ships in the browser bundle) could read the ledger and
--     INSERT a filename — which makes the runner skip that migration forever.
--     Fix: RLS on with no policies (PostgREST roles see nothing) + grants
--     revoked. The runner connects as the table's owner (postgres) and owners
--     bypass RLS, so deploys — including the INSERT that records THIS file —
--     keep working.
--  2. spatial_ref_sys — PostGIS reference data, installed into public by 001.
--     It must stay READABLE under every role (ST_Transform looks SRIDs up as
--     the calling role), so: RLS on + read-everything policy, writes revoked.
--     On Supabase the extension owner is not always us — insufficient
--     privilege is a NOTICE here, never a failed build.
--  3. Sweep: any other public table without RLS (hand-made in the dashboard,
--     unknown to this repo) gets RLS enabled. Deny-by-default is the safe
--     direction: every app table already carries policies, and server code
--     uses the service role, which bypasses RLS.
--
-- Each ALTER sits in its own block: a PL/pgSQL exception rolls back only the
-- block it fires in, so a failed REVOKE can never undo the RLS it follows.

DO $$
BEGIN
  ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN undefined_table THEN RAISE NOTICE '086: schema_migrations not present — nothing to lock';
END $$;

DO $$
BEGIN
  REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;
EXCEPTION
  WHEN undefined_table OR undefined_object OR insufficient_privilege THEN
    RAISE NOTICE '086: schema_migrations grants left as-is (%)', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS spatial_ref_sys_read ON public.spatial_ref_sys;
  CREATE POLICY spatial_ref_sys_read ON public.spatial_ref_sys FOR SELECT USING (true);
EXCEPTION
  WHEN undefined_table THEN RAISE NOTICE '086: spatial_ref_sys not present';
  WHEN insufficient_privilege THEN
    RAISE NOTICE '086: spatial_ref_sys is owned by the extension owner — enable RLS from the dashboard SQL editor, or move PostGIS to the extensions schema';
END $$;

DO $$
BEGIN
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.spatial_ref_sys FROM anon, authenticated;
EXCEPTION
  WHEN undefined_table OR undefined_object OR insufficient_privilege THEN
    RAISE NOTICE '086: spatial_ref_sys grants left as-is (%)', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
      RAISE NOTICE '086: RLS enabled on public.%', r.relname;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '086: could not enable RLS on public.%: %', r.relname, SQLERRM;
    END;
  END LOOP;
END $$;
