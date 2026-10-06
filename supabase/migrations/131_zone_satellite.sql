-- 131 — Satellite pictures of a site (Oct 6 2026).
--
-- Brian: "Need to check on the cost of daily aerials from Planet Labs and
-- implement with per zone cost or whatever makes the most sense there."
--
-- A site can be WATCHED from space: Sentinel-2 (free, 10 m, a pass every few
-- days) or PlanetScope (daily, 3 m, only when PL_API_KEY is set — and only
-- under a licence that lets us show it to customers; docs/SATELLITE.md).
-- The daily cron (/api/cron/satellite, lib/satellite/run.ts) turns each clear
-- pass into an ordinary dated, PLACED zone_imagery photo — so the zone page's
-- photo timeline and the map's timeline-aware Site imagery layer show it with
-- no change of their own.
--
-- WHY NO NEW zone_imagery KIND: a satellite picture IS a dated site photo —
-- it must ride the same timeline and scrubber as a drone shot, and every
-- reader already treats "not 'plan'" as a photo. 'satellite' has been a legal
-- `source` since 052 (and the zone page already labels it 🛰). Swapping
-- 055's CHECK on a live table would buy nothing. Provider, resolution and
-- cost live on satellite_scenes; the caption names source, date, resolution
-- and the licence notice.
--
-- zone_satellite   one row per watched site; company-scoped reads, service-
--                  role writes (lib/actions/satellite.ts checks edit, the
--                  add-on and the site first).
-- satellite_scenes every scene the cron looked at: the dedupe (one picture
--                  per site per day), the Planet orders in flight, and what
--                  each picture cost US. Members read it company-scoped but
--                  NOT the cost/billing/storage columns (column grants) —
--                  our wholesale cost is not a customer's business.
-- Prospects: neither table is on 119's allow-list (a prospect's pages never
-- draw them). They still see the pictures — zone_imagery is allow-listed.
-- Bucket `satellite` (private): licensed pictures (Planet) — never a public
-- link; served by the signed-in /api/satellite/image/<id> route.
-- company_addons learns the 'satellite' add-on.
--
-- All statements are small (new, empty tables; a CHECK swap on a handful of
-- add-on rows). No backfill.

-- ── company_addons: allow 'satellite' without dropping any other key ──────
-- Rebuilt from the CURRENT constraint's own list, so a key another migration
-- added meanwhile survives this one.
DO $$
DECLARE
  def  text;
  vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.company_addons'::regclass AND c.conname = 'company_addons_addon_check';
  IF def IS NULL THEN
    vals := ARRAY['dirt'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(def, '''([^'']+)''', 'g') AS m;
  END IF;
  IF NOT ('satellite' = ANY (vals)) THEN
    vals := vals || 'satellite'::text;
    ALTER TABLE public.company_addons DROP CONSTRAINT IF EXISTS company_addons_addon_check;
    -- An IN-list (stored as ARRAY['a'::text, …]) keeps every key quoted on its
    -- own, so the next migration can read the list back the same way.
    EXECUTE format('ALTER TABLE public.company_addons ADD CONSTRAINT company_addons_addon_check CHECK (addon IN (%s))',
      (SELECT string_agg(quote_literal(v), ', ' ORDER BY v) FROM unnest(vals) AS v));
  END IF;
END $$;

-- ── zone_satellite ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_satellite (
  zone_id          UUID PRIMARY KEY REFERENCES geofences(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'sentinel2' CHECK (provider IN ('sentinel2', 'planet')),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at  TIMESTAMPTZ,
  last_scene_at    TIMESTAMPTZ,
  last_error       TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zone_satellite_company_idx ON public.zone_satellite (company_id);
-- The cron's queue: watched sites, longest unchecked first.
CREATE INDEX IF NOT EXISTS zone_satellite_due_idx ON public.zone_satellite (last_checked_at NULLS FIRST) WHERE enabled;

ALTER TABLE public.zone_satellite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company zone satellite read" ON public.zone_satellite;
CREATE POLICY "company zone satellite read" ON public.zone_satellite
  FOR SELECT USING (company_id = current_company_id());
-- No member write policy: every write is the service role behind the action.
REVOKE ALL ON public.zone_satellite FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.zone_satellite FROM authenticated;
SELECT ht_prospect_lockdown('zone_satellite', false);

-- ── satellite_scenes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.satellite_scenes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  zone_id         UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('sentinel2', 'planet')),
  scene_id        TEXT NOT NULL CHECK (char_length(scene_id) BETWEEN 1 AND 160),
  acquired_at     TIMESTAMPTZ NOT NULL,
  -- The calendar day the scene shows at the site (local solar date): the
  -- one-picture-per-site-per-day key.
  acquired_on     DATE NOT NULL,
  cloud_pct       REAL,                      -- the whole scene / tile, 0–100
  zone_cloud_pct  REAL,                      -- measured over the site itself
  gsd_m           REAL,
  billed_km2      REAL NOT NULL DEFAULT 0,
  est_cost_usd    NUMERIC(10, 4) NOT NULL DEFAULT 0,
  imagery_id      UUID REFERENCES zone_imagery(id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('ingested', 'cloudy', 'nodata', 'pending', 'failed')),
  order_id        TEXT CHECK (order_id IS NULL OR order_id ~ '^[0-9a-f-]{36}$'),
  storage_path    TEXT CHECK (storage_path IS NULL OR storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$'),
  attempts        SMALLINT NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 0 AND 100),
  detail          TEXT CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_id, provider, scene_id)
);

CREATE INDEX IF NOT EXISTS satellite_scenes_zone_day_idx ON public.satellite_scenes (zone_id, provider, acquired_on DESC);
CREATE INDEX IF NOT EXISTS satellite_scenes_pending_idx ON public.satellite_scenes (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS satellite_scenes_imagery_idx ON public.satellite_scenes (imagery_id) WHERE imagery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS satellite_scenes_company_idx ON public.satellite_scenes (company_id, created_at DESC);

ALTER TABLE public.satellite_scenes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company satellite scenes read" ON public.satellite_scenes;
CREATE POLICY "company satellite scenes read" ON public.satellite_scenes
  FOR SELECT USING (company_id = current_company_id());
REVOKE ALL ON public.satellite_scenes FROM anon, authenticated;
GRANT SELECT (id, company_id, zone_id, provider, scene_id, acquired_at, acquired_on,
              cloud_pct, zone_cloud_pct, gsd_m, imagery_id, status, created_at)
  ON public.satellite_scenes TO authenticated;
SELECT ht_prospect_lockdown('satellite_scenes', false);

-- ── Private bucket for licensed pictures ─────────────────────────────────
-- No storage.objects policies on purpose: the cron writes with the service
-- role and /api/satellite/image hands out two-minute signed links.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('satellite', 'satellite', false, 10485760, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
