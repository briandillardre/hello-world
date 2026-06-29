-- Editable geofences + sub-zones.
--
-- 1) parent_id lets a zone nest under a parent site (sub-zones).
-- 2) A security_invoker view exposes geometry as GeoJSON so the app (which works
--    in GeoJSON) can read it directly; RLS on the base table still applies.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES geofences(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS geofences_parent_idx ON geofences(parent_id) WHERE parent_id IS NOT NULL;

CREATE OR REPLACE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  name,
  color,
  parent_id,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;

-- Insert/update a geofence from GeoJSON (the app speaks GeoJSON, the table stores
-- PostGIS). SECURITY INVOKER so the caller's RLS still governs the write.
CREATE OR REPLACE FUNCTION upsert_geofence(
  p_id        UUID,
  p_name      TEXT,
  p_color     TEXT,
  p_geometry  JSONB,
  p_parent_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO geofences (company_id, name, color, parent_id, geometry)
    VALUES (current_company_id(), p_name, p_color, p_parent_id, ST_GeomFromGeoJSON(p_geometry::text))
    RETURNING id INTO v_id;
  ELSE
    UPDATE geofences SET
      name = p_name, color = p_color, parent_id = p_parent_id,
      geometry = ST_GeomFromGeoJSON(p_geometry::text)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
