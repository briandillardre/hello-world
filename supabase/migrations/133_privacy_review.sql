-- 133 — Review pass on 132 (location privacy), Oct 6 2026.
--
-- ship-check + sec-check findings on the day 132 shipped. The code half is
-- lib/location-policy.ts (pure — node scripts/location-policy-test.mjs),
-- lib/location-privacy.ts, lib/phone-location.ts and the routes; this file
-- is the database half (harness: scripts/privacy-sql-test/run.sh).
--
--   A. tool_sightings
--      • a privacy-zone sighting is never finer than the 250 m off-the-clock
--        grid (132 put the tag at a house lot's exact centre ±25 m): the
--        leaky rows are removed and a CHECK keeps every non-recovery row at
--        ≥ 250 m;
--      • a recovery's exact spot is read by Admins and the owner only
--        (visible_rank ≥ 3) — it was readable by every crew member;
--      • place_since: when a row arrived at its current place, so a moving
--        run updates ONE row instead of a row per 250 m cell (the fold's
--        "settled" test);
--      • ht_tool_sightings_latest(): the newest row per tool, under the
--        caller's own RLS — the map read the company's newest 1,000 rows and
--        deduped them, so a busy tool pushed quieter ones off the map.
--   B. geofences: once a zone is private, its shape, kind, owner and company,
--      and the zone itself, change only for Admins and the owner (132 guarded
--      the flag alone; any member could redraw, re-kind, re-own or delete a
--      privacy zone and switch collection back on).
--   C. asset_recovery
--      • the REASON leaves what members may read (column grants; the server
--        reads it for Admins and the owner);
--      • at most 30 days from the start, extensions included;
--      • every extension is a row of its own, append-only
--        (asset_recovery_extensions) — 132 overwrote extended_by/at;
--      • never a person (personnel asset).
--
-- tool_sightings and asset_recovery are empty in production today, so every
-- cleanup and CHECK below is instant; nothing scans a big table. Idempotent.

-- ── A. tool_sightings ───────────────────────────────────────────────────────
-- Leaky shapes from 132's first hours, if any: a privacy-zone row finer than
-- the grid goes (its exact place cannot be re-derived honestly from a centre
-- that was the point of the leak); a recovery row is raised to Admins.
DELETE FROM tool_sightings WHERE reason <> 'recovery' AND precision_m < 250;
UPDATE tool_sightings SET visible_rank = 3 WHERE reason = 'recovery' AND visible_rank < 3;

ALTER TABLE tool_sightings DROP CONSTRAINT IF EXISTS tool_sightings_rough_enough;
ALTER TABLE tool_sightings ADD CONSTRAINT tool_sightings_rough_enough
  CHECK (reason = 'recovery' OR precision_m >= 250);
ALTER TABLE tool_sightings DROP CONSTRAINT IF EXISTS tool_sightings_recovery_admins;
ALTER TABLE tool_sightings ADD CONSTRAINT tool_sightings_recovery_admins
  CHECK (reason <> 'recovery' OR visible_rank >= 3);

-- When the row arrived at its current place (NULL = it never moved: since
-- first_seen). lib/location-policy.ts `anonFold`.
ALTER TABLE tool_sightings ADD COLUMN IF NOT EXISTS place_since TIMESTAMPTZ;
ALTER TABLE tool_sightings DROP CONSTRAINT IF EXISTS tool_sightings_place_since;
ALTER TABLE tool_sightings ADD CONSTRAINT tool_sightings_place_since
  CHECK (place_since IS NULL OR (place_since >= first_seen AND place_since <= last_seen));

-- The newest sighting per tool the CALLER may read (SECURITY INVOKER: the
-- company, 111's ladder on both ends and the prospect lockdown all still
-- apply), at most `p_max_rank` — a "view app as" preview reads at the
-- previewed rank, which RLS (the REAL viewer) cannot know. One row per tool.
CREATE OR REPLACE FUNCTION ht_tool_sightings_latest(p_company UUID, p_since TIMESTAMPTZ, p_max_rank INTEGER DEFAULT 4)
RETURNS TABLE (
  tool_asset_id UUID, lat DOUBLE PRECISION, lng DOUBLE PRECISION, precision_m INTEGER, reason TEXT,
  first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ, heard_n INTEGER, visible_rank SMALLINT
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (s.tool_asset_id)
         s.tool_asset_id, s.lat, s.lng, s.precision_m, s.reason, s.first_seen, s.last_seen, s.heard_n, s.visible_rank
  FROM tool_sightings s
  WHERE s.company_id = p_company
    AND s.last_seen >= p_since
    AND s.visible_rank <= LEAST(GREATEST(COALESCE(p_max_rank, 0), 0), 4)
  ORDER BY s.tool_asset_id, s.last_seen DESC, s.id
  LIMIT 5000
$$;
REVOKE ALL ON FUNCTION ht_tool_sightings_latest(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ht_tool_sightings_latest(UUID, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

-- ── B. A privacy zone stays one ─────────────────────────────────────────────
-- Did the outline really move? Every zone save rewrites geometry from the
-- GeoJSON the page read (9 decimals), so an unchanged shape comes back a few
-- 1e-10° off — that is a rename, not a redraw. 1e-6° ≈ 10 cm.
CREATE OR REPLACE FUNCTION ht_zone_shape_moved(a geometry, b geometry)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN a IS NULL OR b IS NULL THEN a IS DISTINCT FROM b
              ELSE ST_HausdorffDistance(a, b) > 1e-6 END
$$;

-- 132's guard, extended. The flag itself: the server only (the zone page's
-- action, after an Admin/owner check). A zone that IS private: its kind,
-- outline, owner and company — and deleting it — only for Admins and the
-- owner (ht_viewer_rank() ≥ 3) or the server. Name, colour, notes, dates
-- and the rest stay editable for anyone who could edit the zone before.
CREATE OR REPLACE FUNCTION ht_guard_privacy_zone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.role(), 'postgres') IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.privacy_zone)
     OR (TG_OP = 'UPDATE' AND NEW.privacy_zone IS DISTINCT FROM OLD.privacy_zone) THEN
    RAISE EXCEPTION 'privacy zones are set on the zone page by an Admin' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.privacy_zone AND COALESCE(ht_viewer_rank(), -1) < 3 THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'only an Admin can delete a privacy zone' USING ERRCODE = '42501';
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR ht_zone_shape_moved(OLD.geometry, NEW.geometry) THEN
      RAISE EXCEPTION 'only an Admin can change a privacy zone''s outline, kind or owner' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS geofences_guard_privacy ON geofences;
CREATE TRIGGER geofences_guard_privacy BEFORE INSERT OR UPDATE ON geofences
  FOR EACH ROW EXECUTE FUNCTION ht_guard_privacy_zone();
DROP TRIGGER IF EXISTS geofences_guard_privacy_delete ON geofences;
CREATE TRIGGER geofences_guard_privacy_delete BEFORE DELETE ON geofences
  FOR EACH ROW EXECUTE FUNCTION ht_guard_privacy_zone();

-- ── C. asset_recovery ───────────────────────────────────────────────────────
-- The reason (why an Admin authorized exact-spot reporting) is for Admins and
-- the owner: members read every other column; lib/db/recovery.ts reads the
-- reason with the service role for a caller who manages recovery. A REVOKE on
-- the table also drops column grants, so this pair is idempotent.
REVOKE SELECT ON asset_recovery FROM authenticated;
GRANT SELECT (id, company_id, asset_id, started_by, started_at, expires_at,
              extended_by, extended_at, ended_by, ended_at, alert_event_id)
  ON asset_recovery TO authenticated;

-- 7 days, extendable — but never past 30 days from the start. Past that,
-- stop it and start a fresh one with a reason (lib/actions/recovery.ts).
ALTER TABLE asset_recovery DROP CONSTRAINT IF EXISTS asset_recovery_at_most_30_days;
ALTER TABLE asset_recovery ADD CONSTRAINT asset_recovery_at_most_30_days
  CHECK (expires_at <= started_at + interval '30 days');

-- Recovery finds equipment, never a person: a personnel asset (a phone) is
-- tracked by the time clock or by its owner's own choice.
CREATE OR REPLACE FUNCTION ht_recovery_not_people()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assets a WHERE a.id = NEW.asset_id AND a.type = 'personnel') THEN
    RAISE EXCEPTION 'recovery is for equipment, not people' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS asset_recovery_not_people ON asset_recovery;
CREATE TRIGGER asset_recovery_not_people BEFORE INSERT OR UPDATE OF asset_id ON asset_recovery
  FOR EACH ROW EXECUTE FUNCTION ht_recovery_not_people();

-- Every extension, one row each — who, when, from what expiry to what.
-- Append-only: no API role (the server's included) may update or delete one;
-- it goes only with its recovery (company / asset deletion cascades, which
-- run as the table owner).
CREATE TABLE IF NOT EXISTS asset_recovery_extensions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id    UUID NOT NULL REFERENCES asset_recovery(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  extended_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  extended_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_before TIMESTAMPTZ NOT NULL,
  expires_after  TIMESTAMPTZ NOT NULL,
  CONSTRAINT asset_recovery_extensions_later CHECK (expires_after > expires_before)
);
CREATE INDEX IF NOT EXISTS asset_recovery_extensions_recovery_idx ON asset_recovery_extensions (recovery_id, extended_at);

ALTER TABLE asset_recovery_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asset_recovery_extensions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON asset_recovery_extensions TO authenticated;
GRANT SELECT, INSERT ON asset_recovery_extensions TO service_role;
DROP POLICY IF EXISTS "company recovery extensions read" ON asset_recovery_extensions;
CREATE POLICY "company recovery extensions read" ON asset_recovery_extensions
  FOR SELECT USING (company_id = current_company_id());
DROP POLICY IF EXISTS "follows asset visibility" ON asset_recovery_extensions;
CREATE POLICY "follows asset visibility" ON asset_recovery_extensions AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_recovery_extensions.asset_id));
SELECT ht_prospect_lockdown('asset_recovery_extensions', false);

-- PostgREST caches each relation's columns and functions; read them now.
NOTIFY pgrst, 'reload schema';
