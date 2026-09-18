-- 111 — Per-asset visibility ladder.
--
-- Brian, Sep 18 2026, with three trackers riding in his own truck: "No one
-- else should see those devices right now … Need to be able to easily toggle
-- who has visibility to certain assets."
--
-- assets.metadata.visibility ∈ 'managers' | 'admins' | 'master'; absent means
-- everyone in the company (so every existing asset is unchanged). Same
-- no-schema pattern as metadata.icon / color.
--
-- Enforced HERE, in RLS, rather than in each reader: the map, the lists, the
-- command center, replays, Ask AI and the reports all read as the signed-in
-- person, so one restrictive policy covers every surface — including the
-- ones nobody remembers. Service-role paths (ingest, crons, the company-key
-- MCP door) bypass RLS by design and keep seeing everything; a Master's
-- "view app as" preview is handled in code (RLS sees the REAL uid).
--
-- Everything keyed to an asset follows it: a hidden machine's pings, trails,
-- alerts, site hours, service history, photos and tag pairings are hidden
-- with it. Those policies run EXISTS against assets under the caller's own
-- RLS, so the ladder is decided in exactly one place.

CREATE OR REPLACE FUNCTION ht_viewer_rank() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN p.id = p.company_id THEN 4   -- the Master: profile id == company id (Roles v2)
                WHEN p.role = 'admin'    THEN 3
                WHEN p.role = 'manager'  THEN 2
                WHEN p.role = 'foreman'  THEN 1
                ELSE 0 END
    FROM profiles p WHERE p.id = auth.uid()), -1)
$$;
REVOKE ALL ON FUNCTION ht_viewer_rank() FROM public;
GRANT EXECUTE ON FUNCTION ht_viewer_rank() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION ht_visibility_rank(meta jsonb) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE meta->>'visibility' WHEN 'master' THEN 4 WHEN 'admins' THEN 3 WHEN 'managers' THEN 2 ELSE 0 END
$$;
GRANT EXECUTE ON FUNCTION ht_visibility_rank(jsonb) TO authenticated, anon, service_role;

-- The ladder itself. WITH CHECK means nobody can WRITE a level above their
-- own rank either — an Admin cannot mark a machine "owner only", and a
-- Manager cannot hide one from Admins.
DROP POLICY IF EXISTS "asset visibility ladder" ON assets;
CREATE POLICY "asset visibility ladder" ON assets AS RESTRICTIVE FOR ALL
  USING (ht_visibility_rank(metadata) <= ht_viewer_rank())
  WITH CHECK (ht_visibility_rank(metadata) <= ht_viewer_rank());

-- Children follow the asset. NULL asset_id (a company-wide alert rule) passes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_locations','trail_daily','alert_events','alert_rules','zone_sessions','usage_daily',
                           'maintenance_schedules','service_records','work_orders','equipment_checks','asset_photos']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "follows asset visibility" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "follows asset visibility" ON %I AS RESTRICTIVE FOR ALL USING (asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = %I.asset_id))',
      t, t);
  END LOOP;
END $$;

-- A tag aboard a hidden truck is hidden with it (its location IS the
-- truck's), and a hidden tag stays hidden wherever it rides.
DROP POLICY IF EXISTS "follows asset visibility" ON tool_associations;
CREATE POLICY "follows asset visibility" ON tool_associations AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = tool_associations.tool_asset_id)
     AND EXISTS (SELECT 1 FROM assets a WHERE a.id = tool_associations.gateway_asset_id));
