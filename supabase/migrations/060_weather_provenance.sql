-- 060: weather-log provenance — WHERE each day's numbers actually came from.
-- Open-Meteo answers with the model grid point it used (snapped from our
-- requested zone centroid) + its elevation. Storing them lets the zone page
-- state the source location and its distance from the site center — the
-- detail a rain-delay claim gets challenged on.

ALTER TABLE site_weather
  ADD COLUMN IF NOT EXISTS src_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS src_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS src_elev_m DOUBLE PRECISION;
