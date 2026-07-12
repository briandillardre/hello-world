-- 016: store GNSS altitude (meters) per fix. The panel already shows live
-- altitude from raw params; this makes elevation queryable and chartable
-- (haul-route profiles, cut/fill context). Ingest writes it from this
-- migration forward — historical rows keep altitude only inside `raw`.

ALTER TABLE asset_locations ADD COLUMN IF NOT EXISTS altitude REAL;
