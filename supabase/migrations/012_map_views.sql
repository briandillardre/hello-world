-- 012: named, saveable map views per user.
-- profiles.map_views stores { views: [{id, name, cfg}], defaultId } — the
-- user's saved layer/style snapshots; defaultId applies on map open.
-- App tolerates this column being absent (falls back to device-local saves).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS map_views JSONB;
