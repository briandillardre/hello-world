-- 053: georeferenced placement for zone imagery — the map overlay.
--
-- bounds = the image's four ground corners, MapLibre image-source order
-- [[TL],[TR],[BR],[BL]] as [lng,lat]. Set via the zone page's "place on
-- map" tool; NULL = timeline-only photo (not placed). The live map draws
-- the latest PLACED image per zone under the Site imagery layer toggle.

ALTER TABLE zone_imagery ADD COLUMN IF NOT EXISTS bounds JSONB;
