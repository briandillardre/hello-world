-- 132 — Location privacy by place and shift.
--
-- From the market brief Brian forwarded (Oct 2026): Motive now uses
-- geofences to decide what its devices may COLLECT, not just to fire entry
-- alerts, and the driver can see when recording stopped. HammerTrack applies
-- the same principle to workforce location (docs/LOCATION-PRIVACY.md):
--
--   • off the clock: no worker-location collection. The always-on tag
--     listener (PhoneGateway) used to write the person's own fix onto their
--     `phone-<uid>` asset every time it heard a tag — on or off the clock (a
--     14-day read on Oct 6: every one of 294 phone gateway fixes, from two
--     phones, was off the clock). Off the clock it now files only the TAG,
--     anonymously, on a ~250 m grid cell: `tool_sightings` below.
--   • privacy zones: inside a zone an Admin marks private, no worker-phone
--     point is kept (shift recorder, tag listener, Go Live); tags heard there
--     sit at the zone's centre.
--   • recovery: an Admin/owner can put an asset in recovery (a reason, 7 days,
--     extendable, audited) — off-the-clock phones then report its tag's
--     EXACT spot, still without saying whose phone heard it.
--
-- Company trucks and machines are company property; their own trackers are
-- untouched by every rule here. The pure rule is lib/location-policy.ts
-- (harness: node scripts/location-policy-test.mjs).
--
-- Bounded and idempotent: one instant ADD COLUMN (constant default — no
-- rewrite), a view swap, two new empty tables. No backfill.

-- ── A. Privacy zones ────────────────────────────────────────────────────────
-- A flag, not a new zone kind: every screen that switches on kind (map
-- colours, the draw dialog, the ledger's site/yard loop, reports, the
-- simulator) stays untouched, and a private place is drawn as a Boundary
-- (or a Vendor) like any other outline. The server reads the flag only on
-- boundary/vendor zones: sites and yards are where crews work and time cards
-- check phones against them, so a flag left on a zone later turned into a
-- site is inert (lib/location-policy.ts `privacyZonesFromRows`).
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS privacy_zone BOOLEAN NOT NULL DEFAULT false;

-- Only the server turns it on or off (lib/actions/privacy-zones.ts, service
-- role, after an Admin/owner check). The company policy lets any member
-- write zones through PostgREST; this keeps that door shut for this column.
CREATE OR REPLACE FUNCTION ht_guard_privacy_zone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(auth.role(), 'postgres') NOT IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    IF (TG_OP = 'INSERT' AND NEW.privacy_zone)
       OR (TG_OP = 'UPDATE' AND NEW.privacy_zone IS DISTINCT FROM OLD.privacy_zone) THEN
      RAISE EXCEPTION 'privacy zones are set on the zone page by an Admin' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS geofences_guard_privacy ON geofences;
CREATE TRIGGER geofences_guard_privacy BEFORE INSERT OR UPDATE ON geofences
  FOR EACH ROW EXECUTE FUNCTION ht_guard_privacy_zone();

-- Every zone read goes through geofences_json (046 → 123: explicit column
-- list, so a new geofences column must be appended to it). Appended to
-- WHATEVER the view holds when this runs — a parallel branch may have added
-- its own column first, and a hard-coded list would try to drop it (42P16).
-- CREATE OR REPLACE keeps the grants; security_invoker is restated.
DO $$
DECLARE def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'geofences_json' AND column_name = 'privacy_zone') THEN
    def := pg_get_viewdef('public.geofences_json'::regclass, true);
    def := regexp_replace(def, '\s*FROM\s+(public\.)?geofences\s*;?\s*$', E',\n    privacy_zone\n   FROM \\1geofences');
    IF def !~ 'privacy_zone' THEN
      RAISE EXCEPTION '132: could not append privacy_zone to geofences_json: %', def;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.geofences_json WITH (security_invoker = true) AS ' || def;
  END IF;
END $$;

-- ── B. Anonymous tag sightings ──────────────────────────────────────────────
-- A tag heard by a phone whose fix is NOT kept (off the clock, or inside a
-- privacy zone). Deliberately NOT custody: tool_associations and pairing_log
-- name the carrier, and a person's name + a place + a time is exactly the
-- record this migration stops keeping — and pairing_log feeds the hours
-- ledger's tool presence (057/090), which must not move. One row per tool
-- per place: repeat sightings extend it (lib/location-policy.ts `anonFold`).
--   precision_m  how rough the place is ON PURPOSE (250 = the off-the-clock
--                grid cell, a zone's radius for a privacy zone); NULL = the
--                exact spot, which only a recovery may carry.
--   visible_rank who may read it: the REPORTING phone's own 111 level (0
--                everyone, 2 managers, 3 admins, 4 owner only). The row
--                never says whose phone heard the tag, but a tag the
--                owner's hidden phone hears is still a rough fix on the
--                owner — on Oct 6, 293 of the 294 off-the-clock gateway fixes
--                were the owner's own phone, marked owner-only since Sep 18.
-- Kept 30 days: the ingest trims a company's older rows when it adds one.
CREATE TABLE IF NOT EXISTS tool_sightings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tool_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  precision_m   INTEGER CHECK (precision_m IS NULL OR precision_m BETWEEN 1 AND 100000),
  reason        TEXT NOT NULL CHECK (reason IN ('off_shift', 'privacy_zone', 'recovery')),
  first_seen    TIMESTAMPTZ NOT NULL,
  last_seen     TIMESTAMPTZ NOT NULL,
  heard_n       INTEGER NOT NULL DEFAULT 1 CHECK (heard_n >= 1),
  visible_rank  SMALLINT NOT NULL DEFAULT 0 CHECK (visible_rank BETWEEN 0 AND 4),
  CONSTRAINT tool_sightings_span CHECK (last_seen >= first_seen),
  -- An exact spot is a recovery's and nothing else's.
  CONSTRAINT tool_sightings_exact_only_in_recovery CHECK ((reason = 'recovery') = (precision_m IS NULL))
);
CREATE INDEX IF NOT EXISTS tool_sightings_tool_idx ON tool_sightings (tool_asset_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS tool_sightings_company_idx ON tool_sightings (company_id, last_seen DESC);

ALTER TABLE tool_sightings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tool_sightings FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tool_sightings FROM authenticated;
GRANT SELECT ON tool_sightings TO authenticated;
GRANT ALL ON tool_sightings TO service_role;
-- Members read; only the ingest (service role) writes — no write policies.
DROP POLICY IF EXISTS "company tool sightings read" ON tool_sightings;
CREATE POLICY "company tool sightings read" ON tool_sightings
  FOR SELECT USING (company_id = current_company_id());
-- 111's ladder, both ends: a hidden tag's sightings are hidden with it, and
-- so is anything a hidden phone heard.
DROP POLICY IF EXISTS "follows asset visibility" ON tool_sightings;
CREATE POLICY "follows asset visibility" ON tool_sightings AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = tool_sightings.tool_asset_id));
DROP POLICY IF EXISTS "follows the reporting phone's visibility" ON tool_sightings;
CREATE POLICY "follows the reporting phone's visibility" ON tool_sightings AS RESTRICTIVE FOR ALL
  USING (visible_rank <= ht_viewer_rank());
-- Made from crew phones: a Prospective Client sees none of it (118/119).
SELECT ht_prospect_lockdown('tool_sightings', false);

-- ── C. Recovery ─────────────────────────────────────────────────────────────
-- Explicitly authorized recovery tracking, one audited row per episode. An
-- Admin/owner starts it with a reason; it ends when someone stops it or on
-- its own at expires_at (7 days, extendable — lib/actions/recovery.ts). An
-- expired row is closed lazily (ended_at = expires_at, ended_by NULL = it
-- ran out) the next time anyone starts one on that asset. Kept for good.
CREATE TABLE IF NOT EXISTS asset_recovery (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  started_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason         TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  expires_at     TIMESTAMPTZ NOT NULL,
  extended_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  extended_at    TIMESTAMPTZ,
  ended_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at       TIMESTAMPTZ,
  -- The theft alert it was started from, when it was (no FK: alert rows age out).
  alert_event_id UUID,
  CONSTRAINT asset_recovery_window CHECK (expires_at > started_at),
  CONSTRAINT asset_recovery_ended CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- One open recovery per asset.
CREATE UNIQUE INDEX IF NOT EXISTS asset_recovery_one_open ON asset_recovery (asset_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS asset_recovery_company_idx ON asset_recovery (company_id, started_at DESC);

ALTER TABLE asset_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asset_recovery FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON asset_recovery FROM authenticated;
GRANT SELECT ON asset_recovery TO authenticated;
GRANT ALL ON asset_recovery TO service_role;
DROP POLICY IF EXISTS "company asset recovery read" ON asset_recovery;
CREATE POLICY "company asset recovery read" ON asset_recovery
  FOR SELECT USING (company_id = current_company_id());
DROP POLICY IF EXISTS "follows asset visibility" ON asset_recovery;
CREATE POLICY "follows asset visibility" ON asset_recovery AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_recovery.asset_id));
SELECT ht_prospect_lockdown('asset_recovery', false);

-- PostgREST caches each relation's columns; make it read the new ones now.
NOTIFY pgrst, 'reload schema';
