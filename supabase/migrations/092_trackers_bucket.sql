-- 092: trackers as first-class things — the unassigned bucket, a 30-day
-- safety net for mistakes, and the audit trail that makes swaps undoable.
--
-- Brian, Sep 4 2026, after a real two-way swap (the OBD unit came out of the
-- 2003 Silverado 2500HD whose port had died and went into the F750; a TAT141
-- went into the Silverado): "we need an 'unassigned trackers' bucket …
-- think thru all potential switches and use cases … we need to hold data
-- for a certain period of time for fall back protection of mistakes."
--
-- Until now a tracker existed only as a string on an asset. Pull it out of a
-- truck and it vanished from the product; its pings, if the device kept
-- reporting from the drawer, were dropped on the floor at ingest. And both
-- Delete and Reassign were one-way doors.
--
-- Model (deliberately small):
--   * assets.tracker_id stays THE source of truth for "which box is in which
--     machine". Nothing here duplicates it.
--   * device_onboarding (083) is the registry of trackers the company OWNS.
--     A registry row whose imei is on no active asset is "in the drawer" —
--     the bucket is DERIVED, never stored, so it can't drift.
--   * unassigned_locations buffers pings that arrive for a registered IMEI
--     nobody is wearing. Assigning the tracker later pulls them onto the
--     asset from the chosen moment — "put it in the truck now, name it
--     later, lose nothing".
--   * tracker_moves records every attach/detach/swap with the exact history
--     cut, so it can be reversed row-for-row for 30 days.
--   * assets.deleted_at turns Delete into a 30-day soft delete. The map and
--     every live reader already filter active = true; a deleted asset is
--     simply inactive with a timestamp, and its tracker is released the
--     same way a deactivated asset's is (084's index is on ACTIVE rows).
--   * purge_retention() is the one place the 30 days are enforced, called
--     from the hourly health cron.

-- ── Soft delete ────────────────────────────────────────────────────────────
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS assets_deleted_idx
  ON assets (company_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- ── Registry: when a tracker went into the drawer ──────────────────────────
ALTER TABLE device_onboarding ADD COLUMN IF NOT EXISTS unassigned_since TIMESTAMPTZ;

-- ── Pings for registered trackers nobody is wearing ────────────────────────
CREATE TABLE IF NOT EXISTS unassigned_locations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  imei TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  battery DOUBLE PRECISION,
  ignition BOOLEAN,
  timestamp TIMESTAMPTZ NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unassigned_locations_imei_idx
  ON unassigned_locations (company_id, imei, timestamp DESC);

ALTER TABLE unassigned_locations ENABLE ROW LEVEL SECURITY;
-- Members read their own company's buffer (the /trackers page shows "last
-- seen" for drawer devices). Writes come from ingest on the service role
-- and from the assign action; no member write policy on purpose.
DROP POLICY IF EXISTS "unassigned locations read" ON unassigned_locations;
CREATE POLICY "unassigned locations read" ON unassigned_locations
  FOR SELECT USING (company_id = current_company_id());

-- ── Audit trail for every tracker change, reversible ───────────────────────
CREATE TABLE IF NOT EXISTS tracker_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- 'attach' | 'detach' | 'swap' | 'move' | 'split_history'
  kind TEXT NOT NULL,
  tracker_id TEXT NOT NULL,
  -- The asset the tracker left (null on a first attach) and the one it
  -- joined (null on a detach to the drawer).
  from_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  to_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  -- The history cut: pings >= swap_at moved from from_asset to to_asset.
  swap_at TIMESTAMPTZ NOT NULL,
  moved_locations INT NOT NULL DEFAULT 0,
  -- Buffered drawer pings pulled onto to_asset by this move (they get
  -- pushed back on undo).
  moved_buffered INT NOT NULL DEFAULT 0,
  -- For a swap: the box that went INTO from_asset as tracker_id came out.
  replacement_tracker_id TEXT,
  note TEXT,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tracker_moves_company_idx
  ON tracker_moves (company_id, created_at DESC);

ALTER TABLE tracker_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tracker moves read" ON tracker_moves;
CREATE POLICY "tracker moves read" ON tracker_moves
  FOR SELECT USING (company_id = current_company_id());

-- ── The 30 days ────────────────────────────────────────────────────────────
-- Everything a mistake can be walked back from lives for `keep_days`, then
-- goes. Bounded statements (one DELETE each, indexed), safe for the cron.
CREATE OR REPLACE FUNCTION purge_retention(keep_days INT DEFAULT 30)
RETURNS TABLE (deleted_assets INT, buffered_pings INT, old_moves INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a INT; b INT; m INT;
BEGIN
  -- Soft-deleted assets past the window: the FK cascade takes locations,
  -- tool associations, maintenance and alert events with them (001).
  DELETE FROM assets
   WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS a = ROW_COUNT;

  DELETE FROM unassigned_locations
   WHERE created_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS b = ROW_COUNT;

  -- Moves stay 3× longer than they are undoable: the trail is worth keeping
  -- even after the undo window closes ("when did the OBD go in the F750?").
  DELETE FROM tracker_moves
   WHERE created_at < now() - make_interval(days => keep_days * 3);
  GET DIAGNOSTICS m = ROW_COUNT;

  RETURN QUERY SELECT a, b, m;
END;
$$;
