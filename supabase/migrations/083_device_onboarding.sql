-- 083: device onboarding tracker
--
-- (Renumbered from 082 the same evening: a parallel session landed
-- 082_tracker_uniqueness.sql. Every statement below is idempotent —
-- IF NOT EXISTS / DROP POLICY IF EXISTS — so re-applying under the new
-- filename is a no-op even where the 082-named file already ran on a
-- preview build. Fix-ups still go in a NEW file; this is a rename, not
-- an edit to an applied migration.)
--
-- The single pane that replaces four vendor consoles (Brian, Aug 28:
-- "this process should be much simpler...").
--
-- Bringing up KORE order #1 meant bouncing between KORE One (activate the
-- SIM), FOTA WEB (upload the config, queue the task), flespi Toolbox (did the
-- IMEI reach the channel?) and HammerTrack (create the asset) — with no place
-- showing whether a given device was actually working. Worse, every failure
-- mode looked the same from outside: an unactivated SIM, a SIM in the wrong
-- deck of a stacked holder, an un-flipped TAT141 switch, swapped antennas and
-- a beacon still on Eddystone ALL present as "the device doesn't show up".
--
-- Half of the checklist ticks itself — whether the device has reached our
-- ingest, has a fix, is hearing tags — because that lives in our own tables.
-- The other half is physical or lives behind a vendor login we can't read, so
-- it's a human check-off. THAT is what this table stores: the manual half,
-- plus the IMEI↔ICCID pairing that nothing else in the system records.
--
-- `steps` is a JSONB map of step key → ISO timestamp of when it was checked
-- off (null/absent = not done). Deliberately schemaless: the per-model step
-- lists live in lib/devices.ts and will keep changing as we learn more
-- hardware, and none of that churn should need a migration.

CREATE TABLE IF NOT EXISTS device_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- The device's IMEI. Also the value an asset carries as tracker_id, which
  -- is how a row joins to live telemetry — we intentionally do NOT hard-FK to
  -- assets, because logging a device BEFORE registering its asset is the
  -- normal order of work in the field.
  imei TEXT NOT NULL,
  -- 'FMM00A' | 'TAT141' | 'FMM650' | 'EYE_BEACON' | 'OTHER' (lib/devices.ts)
  model TEXT NOT NULL DEFAULT 'OTHER',
  -- Free text: where this unit is going ("Chevy 1500", "tool trailer").
  label TEXT,
  -- The SIM that went in, captured at insertion time. Nothing else links a
  -- ICCID to an IMEI: packing slips list IMEIs, cards carry ICCIDs, and
  -- reconciling them afterwards means power-cycling units one at a time.
  iccid TEXT,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per device per company; re-adding a known IMEI updates in place
  -- rather than creating a duplicate checklist.
  UNIQUE (company_id, imei)
);

CREATE INDEX IF NOT EXISTS device_onboarding_company_idx
  ON device_onboarding(company_id, created_at DESC);

ALTER TABLE device_onboarding ENABLE ROW LEVEL SECURITY;

-- Members of the company manage their own device list. Same shape as the
-- other member-managed tables (046): scoped by current_company_id() on both
-- read and write, so a row can never be created into, or moved to, another
-- tenant. WITH CHECK is spelled out rather than left implicit on FOR ALL so
-- an UPDATE cannot rewrite company_id to someone else's id.
DROP POLICY IF EXISTS "device onboarding rw" ON device_onboarding;
CREATE POLICY "device onboarding rw" ON device_onboarding
  FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
