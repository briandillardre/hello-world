-- 098: reverse-geocode cache for "where is it" labels.
--
-- Brian, Sep 4 2026 (assets list): "I would like to easily and quickly see
-- where each asset is — first in geofence sites or zones, then if they are
-- not there default to a close address, if that is not available let me know
-- what city they are in and State."
--
-- Zones are answered from our own polygons. Off-site positions ask a free
-- community geocoder (Photon/OSM, BigDataCloud as the city fallback) ONCE per
-- ~100 m cell and keep the answer here, so the list stays instant, repeat
-- visits to the same lot cost nothing, and we stay polite to the free
-- services (lib/reverse-geocode.ts). Not company-scoped on purpose — a
-- street is a street; the key is a rounded coordinate, nothing about who
-- asked. Read/written by the server only (service role); PostgREST roles see
-- nothing (086 rule: RLS on, no policies, grants revoked).
CREATE TABLE IF NOT EXISTS geocode_cache (
  key TEXT PRIMARY KEY,                 -- '34.852,-82.394' (3-decimal cell, ~100 m)
  street TEXT,                          -- '304 North Church Street' or a road name, when known
  city TEXT,
  state TEXT,                           -- 'SC' (US states abbreviated), else the region name
  source TEXT NOT NULL DEFAULT 'photon',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON geocode_cache FROM PUBLIC, anon, authenticated;
