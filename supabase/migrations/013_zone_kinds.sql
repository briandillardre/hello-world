-- 013: zone kinds — 'site' (job site: usage, invoicing, site log) vs
-- 'boundary' (perimeter: outline-only render, exit/after-hours alerts,
-- excluded from usage metrics). App tolerates this migration being absent.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'site';

-- Widen the upsert RPC (p_kind defaults NULL → keeps kind unchanged on edit,
-- 'site' on create) and expose kind through the GeoJSON view.
CREATE OR REPLACE FUNCTION upsert_geofence(
  p_id        UUID,
  p_name      TEXT,
  p_color     TEXT,
  p_geometry  JSONB,
  p_parent_id UUID DEFAULT NULL,
  p_kind      TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO geofences (company_id, name, color, parent_id, geometry, kind)
    VALUES (current_company_id(), p_name, p_color, p_parent_id,
            ST_GeomFromGeoJSON(p_geometry::text), COALESCE(p_kind, 'site'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE geofences SET
      name = p_name, color = p_color, parent_id = p_parent_id,
      geometry = ST_GeomFromGeoJSON(p_geometry::text),
      kind = COALESCE(p_kind, kind)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- The pre-013 view has no `kind` column; REPLACE can't insert one mid-list
-- (42P16), so drop and recreate. Views hold no data — this is safe.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  name,
  color,
  parent_id,
  kind,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;
