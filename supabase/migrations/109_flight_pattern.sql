-- 109: Pattern work — touch-and-goes and circuits inside one flight.
--
-- Brian, Sep 12, describing his own flight: "Also need a way to show how many
-- touch and gos were done etc. Vs categorizing as multiple flights. For
-- example yesterday I went gmu to grd and did a bunch of touch and gos then
-- back to gmu. Would be a nice feature to show traffic pattern consistency."
--
-- The "vs categorizing as multiple flights" half already held — segmentation
-- keeps that trip as ONE flight, because a touch-and-go never produces the
-- four-minute ground stop that ends one. What was missing was saying what
-- happened in the middle.
--
-- Stored rather than recomputed because detection runs on the FULL-resolution
-- fix stream at bank time; the `track` column is downsampled to 400 points,
-- which is enough to draw a chart but thins a two-minute circuit past the
-- point the dips are visible.
ALTER TABLE aircraft_flights
  ADD COLUMN IF NOT EXISTS pattern JSONB;

COMMENT ON COLUMN aircraft_flights.pattern IS
  'Array of PatternWork (lib/pattern.ts): per airfield, the approaches flown, '
  'the circuits between them and how consistent they were. Null for flights '
  'banked before 109; empty array for a plain A-to-B trip.';
