-- 108: Flight log — saved aircraft and their banked flight history.
--
-- Brian, Sep 12: "I want plane flight log history added. Should be able to
-- search tail numbers, see all prior flights, save planes etc. Also altitude
-- and ground speed and vertical speed charts."
--
-- WHY THERE ARE TABLES HERE AT ALL, when the whole thing could be a proxy:
-- the upstream archive (adsb.lol globe_history) keeps a ROLLING ~30 DAYS —
-- verified by probe the day this shipped: 12 Aug answered, 5 Aug was gone.
-- Searching a tail reads that window live and needs nothing stored. But
-- "all prior flights" cannot be true beyond day 30 unless somebody was
-- writing it down, so SAVING a plane is what starts writing it down: a
-- nightly cron banks each saved aircraft's completed flights here, and they
-- outlive the upstream window. That is the whole point of the save button.
--
-- Nothing here is customer telemetry — it is public ADS-B about aircraft the
-- company chose to watch. It is still scoped per company like everything
-- else, because whose planes you watch is nobody else's business.

CREATE TABLE IF NOT EXISTS aircraft_saved (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- icao24, lowercase hex. The only identifier that never changes: a tail
  -- number can be sold onto another airframe, the hex is burned into the
  -- transponder.
  hex         TEXT NOT NULL CHECK (hex ~ '^[0-9a-f]{6}$'),
  -- Identity as of the last time we looked, for showing a list without
  -- hitting the network. Refreshed by the cron; never the source of truth.
  reg         TEXT,
  type_code   TEXT,
  descr       TEXT,
  owner       TEXT,
  -- What the crew calls it ("the boss's plane"), shown instead of the tail.
  label       TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set by the cron so a plane that stops reporting is visible as stale
  -- rather than silently empty.
  last_synced_at TIMESTAMPTZ,
  last_flight_at TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- One row per airframe per company; re-saving is an update, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS aircraft_saved_one_idx
  ON aircraft_saved (company_id, hex) WHERE active;
CREATE INDEX IF NOT EXISTS aircraft_saved_company_idx
  ON aircraft_saved (company_id) WHERE active;

-- Banked flights. Shared across companies ON PURPOSE and keyed by airframe,
-- not by company: this is public ADS-B, two companies watching the same jet
-- must not make us fetch and store it twice. Reads go through the API, which
-- only ever answers for a hex the caller asked about.
CREATE TABLE IF NOT EXISTS aircraft_flights (
  -- "<hex>-<takeoff epoch>" — the same flight re-derived from the same trace
  -- lands on the same id, so re-running the cron is idempotent.
  id           TEXT PRIMARY KEY,
  hex          TEXT NOT NULL CHECK (hex ~ '^[0-9a-f]{6}$'),
  callsign     TEXT,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ NOT NULL,
  duration_sec INTEGER NOT NULL,
  from_lat     DOUBLE PRECISION NOT NULL,
  from_lng     DOUBLE PRECISION NOT NULL,
  to_lat       DOUBLE PRECISION NOT NULL,
  to_lng       DOUBLE PRECISION NOT NULL,
  from_label   TEXT,
  to_label     TEXT,
  distance_nm  REAL NOT NULL DEFAULT 0,
  max_alt_ft   INTEGER NOT NULL DEFAULT 0,
  max_gs_kt    INTEGER NOT NULL DEFAULT 0,
  fix_count    INTEGER NOT NULL DEFAULT 0,
  -- The downsampled track, as the array of Fix objects lib/aircraft-log.ts
  -- produces. JSONB because it is read whole, for one flight, to draw three
  -- charts and a line on the map — never queried into.
  track        JSONB,
  -- Did we actually see it on the ground either side? Neither = a coverage
  -- fragment, and the UI labels it rather than calling it a short flight.
  departed     BOOLEAN NOT NULL DEFAULT TRUE,
  arrived      BOOLEAN NOT NULL DEFAULT TRUE,
  -- TRUE while the flight still touches the edge of its day file: it may
  -- gain a second half when tomorrow's archive lands, so the cron is allowed
  -- to rewrite it. A closed flight is final.
  open_ended   BOOLEAN NOT NULL DEFAULT FALSE,
  banked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aircraft_flights_hex_idx
  ON aircraft_flights (hex, started_at DESC);
-- The cron re-reads only what might still change.
CREATE INDEX IF NOT EXISTS aircraft_flights_open_idx
  ON aircraft_flights (hex, started_at) WHERE open_ended;

ALTER TABLE aircraft_saved ENABLE ROW LEVEL SECURITY;
ALTER TABLE aircraft_flights ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'aircraft_saved' AND policyname = 'company saved aircraft') THEN
    CREATE POLICY "company saved aircraft" ON aircraft_saved
      FOR ALL USING (company_id = current_company_id());
  END IF;
  -- Banked flights carry no company column, so sessions get NO policy at
  -- all: RLS on with nothing granted means the anon/authed roles read
  -- nothing directly. The service role (the cron and the API route) is the
  -- only way in, and the API only ever answers for one requested hex.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'aircraft_flights' AND policyname = 'no direct session access') THEN
    CREATE POLICY "no direct session access" ON aircraft_flights
      FOR SELECT USING (FALSE);
  END IF;
END $$;
