-- 110: Airport boards — what flew in and out of a field.
--
-- Brian, Sep 12, after sending FlightRadar24's Greenville Downtown departures
-- board (which FR24 locks past 12 hours behind a paid tier).
--
-- No upstream sells this, and no free endpoint answers "what used KGMU
-- today" — so we assemble it from what we already do. A flight we have
-- already derived knows both its ends; recording the airport CODE beside the
-- label turns the board into a query over `aircraft_flights` rather than a
-- second pipeline. The only genuinely new work is DISCOVERY: a cron that
-- looks near each watched field to find out which aircraft to go and read.
ALTER TABLE aircraft_flights
  ADD COLUMN IF NOT EXISTS from_ident TEXT,
  ADD COLUMN IF NOT EXISTS to_ident   TEXT;

-- The board reads "everything that touched this field, newest first" — one
-- index per end, because a departure and an arrival are different questions.
CREATE INDEX IF NOT EXISTS aircraft_flights_from_ident_idx
  ON aircraft_flights (from_ident, started_at DESC) WHERE from_ident IS NOT NULL;
CREATE INDEX IF NOT EXISTS aircraft_flights_to_ident_idx
  ON aircraft_flights (to_ident, started_at DESC) WHERE to_ident IS NOT NULL;

-- Which fields a company watches. Same bargain as saving a plane: the board
-- starts filling the day you add it, because nobody was writing it down
-- before that.
CREATE TABLE IF NOT EXISTS airports_saved (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- ICAO-ish identifier as OurAirports spells it: KGMU, 5J9.
  ident       TEXT NOT NULL CHECK (ident ~ '^[A-Z0-9]{3,4}$'),
  name        TEXT,
  label       TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_swept_at TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS airports_saved_one_idx
  ON airports_saved (company_id, ident) WHERE active;
CREATE INDEX IF NOT EXISTS airports_saved_company_idx
  ON airports_saved (company_id) WHERE active;

ALTER TABLE airports_saved ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'airports_saved' AND policyname = 'company saved airports') THEN
    CREATE POLICY "company saved airports" ON airports_saved
      FOR ALL USING (company_id = current_company_id());
  END IF;
END $$;
