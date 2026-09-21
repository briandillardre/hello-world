-- 119 — the follow-up the reviewer pass on 118 demanded (Sep 21 2026).
--
-- (A) The company's ingest/MCP key moves OFF the company row. `companies` is
--     readable by every member's session (any role — and since 118 a
--     Prospective Client), and that key is the ONLY credential the MCP door
--     takes: any login could read `api_key` through PostgREST and then read
--     the whole company (people, hours, dollars, owner-only machines) through
--     the service-role tools behind /api/mcp. It now lives in
--     `company_api_keys` — RLS on, no policies, no session grants; the
--     service role alone reads and writes it — and a trigger seeds one for
--     every new company whichever signup path made the row. The old column
--     is nulled and scrubbed on every future write, so nothing can put a
--     plaintext key back where a session can see it.
--
-- (B) A Prospective Client is DENY-BY-DEFAULT for reads. 118 listed eight
--     people-shaped tables; everything else stayed readable company-wide —
--     QuickBooks/OEM/Plaid credentials, the hours and dollars ledgers, the
--     owner memos, the company row's phone, email and billing ids. An
--     outsider role gets an allow-list (the tables its own pages draw from)
--     and nothing else. ONE helper applies the whole prospect lockdown to a
--     table, so a future table is one call away from correct (docs/ROLES.md).

-- ── A. company_api_keys ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_api_keys (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  api_key    TEXT NOT NULL UNIQUE,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE company_api_keys ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: a session JWT gets "permission denied", never
-- an empty set it could keep probing.
REVOKE ALL ON company_api_keys FROM PUBLIC, anon, authenticated;

INSERT INTO company_api_keys (company_id, api_key)
  SELECT id, api_key FROM companies WHERE api_key IS NOT NULL
  ON CONFLICT (company_id) DO NOTHING;

ALTER TABLE companies ALTER COLUMN api_key DROP NOT NULL;

-- Every new company gets a key here, whichever path created the row (the
-- register page inserts with the user's own session; the OAuth callback with
-- the service role). Same shape lookupCompanyByKey accepts: tf_ + base36.
CREATE OR REPLACE FUNCTION ht_seed_company_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO company_api_keys (company_id, api_key)
  VALUES (NEW.id, 'tf_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ht_seed_company_key() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS companies_seed_key ON companies;
CREATE TRIGGER companies_seed_key AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION ht_seed_company_key();

-- The readable row never carries a key again: a value written by an older
-- build (the register page, the old rotate action) is dropped on the way in.
-- Runs AFTER companies_protected_cols (alphabetical), which still refuses a
-- session that tries to touch the column at all.
CREATE OR REPLACE FUNCTION ht_scrub_company_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.api_key := NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS companies_scrub_key ON companies;
CREATE TRIGGER companies_scrub_key BEFORE INSERT OR UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION ht_scrub_company_key();

UPDATE companies SET api_key = NULL WHERE api_key IS NOT NULL;

-- ── B. Prospective Client: deny by default ──────────────────────────────────
-- The whole prospect lockdown for one table: 118's read-only lock (one
-- restrictive policy per write verb) plus, unless the table is on the
-- allow-list, a restrictive SELECT that hides every row from a prospect.
-- A NEW table calls this once in its own migration:
--   SELECT ht_prospect_lockdown('my_table', false);   -- hidden from prospects
--   SELECT ht_prospect_lockdown('my_table', true);    -- readable, never writable
CREATE OR REPLACE FUNCTION ht_prospect_lockdown(tbl text, allow_read boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (insert)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (insert)" ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (update)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (update)" ON %I AS RESTRICTIVE FOR UPDATE USING (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects read only (delete)" ON %I', tbl);
  EXECUTE format('CREATE POLICY "prospects read only (delete)" ON %I AS RESTRICTIVE FOR DELETE USING (ht_viewer_role() <> ''prospect'')', tbl);
  EXECUTE format('DROP POLICY IF EXISTS "prospects see nothing here" ON %I', tbl);
  IF NOT allow_read THEN
    EXECUTE format('CREATE POLICY "prospects see nothing here" ON %I AS RESTRICTIVE FOR SELECT USING (ht_viewer_role() <> ''prospect'')', tbl);
  END IF;
END $$;
REVOKE ALL ON FUNCTION ht_prospect_lockdown(text, boolean) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  -- What a prospect's pages draw from — the map, the assets list and page,
  -- the zones list and page, the flight log — and their own profile row
  -- (118 already narrows that to one row). NOT the company row: it carries
  -- the owner's phone, email, billing ids and the inbound receipt address,
  -- and the app falls back to plain defaults without it.
  allow text[] := ARRAY[
    'profiles',
    'assets', 'asset_locations', 'trail_daily', 'asset_photos', 'asset_telemetry_latest',
    'tool_associations', 'maintenance_schedules', 'service_records', 'work_orders',
    'alert_events', 'alert_rules',
    'geofences', 'zone_imagery', 'places', 'divisions', 'measurements', 'site_weather', 'geocode_cache',
    'aircraft_saved', 'aircraft_flights', 'airports_saved'
  ];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity AND tablename <> 'spatial_ref_sys'
    ORDER BY tablename
  LOOP
    BEGIN
      PERFORM ht_prospect_lockdown(t, t = ANY(allow));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '119: prospect lockdown skipped on % (%)', t, SQLERRM;
    END;
  END LOOP;
END $$;
