-- 106: Divisions — one company, several operating units.
--
-- Brian, Sep 11: "need to add a section of different divisions of a company —
-- this applies to all assets, geofences, etc. Need a way to filter and also
-- keep track of DCG Coastal vs Upstate for example."
--
-- A division is an operating unit INSIDE one company: same login, same books,
-- same trackers — a label that says which half of the business a truck, a job
-- site or a saved place belongs to, so the map, the lists and (later) the
-- money can be filtered down to it.
--
-- Deliberately NOT a second company: crews move between divisions, the fleet
-- is shared, and a tracker that goes from Upstate to Coastal must keep its
-- history. Deliberately NOT the free-text `category` on assets either — that
-- groups machines by kind ("Dozers"), applies to nothing else, and can't be
-- renamed in one place.
--
-- NULL division_id = unassigned, which every existing row is: nothing changes
-- until someone creates a division and starts labelling.

CREATE TABLE IF NOT EXISTS divisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Drives the chip + the map filter's swatch. Hex, validated in the UI.
  color       TEXT NOT NULL DEFAULT '#2dd4bf',
  -- Owner-written: "Charleston + Beaufort counties", "the old shop".
  notes       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  -- Archived divisions keep their rows (history stays readable) but leave the
  -- pickers. Deleting one would orphan every label it ever applied.
  archived_at TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live "Coastal" per company; an archived one doesn't block the name.
CREATE UNIQUE INDEX IF NOT EXISTS divisions_company_name_idx
  ON divisions (company_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS divisions_company_idx ON divisions (company_id);

ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'divisions' AND policyname = 'company divisions') THEN
    CREATE POLICY "company divisions" ON divisions
      FOR ALL USING (company_id = current_company_id());
  END IF;
END $$;

-- The label itself. ON DELETE SET NULL, not CASCADE: losing a division must
-- never delete a truck.
ALTER TABLE assets     ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE geofences  ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'places') THEN
    ALTER TABLE places ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The filter reads "everything in this division" on every list and the map.
CREATE INDEX IF NOT EXISTS assets_division_idx    ON assets (company_id, division_id) WHERE active;
CREATE INDEX IF NOT EXISTS geofences_division_idx ON geofences (company_id, division_id);
