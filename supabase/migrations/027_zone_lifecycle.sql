-- Zone lifecycle + personal zones.
--
-- 1) owner_id — a PERSONAL zone belongs to one user (owner_id = their uid) and
--    is visible only to them; a GLOBAL zone (owner_id NULL, the default) is
--    company-wide as before.
-- 2) active_from / active_until — a job site's optional start/end window. NULL
--    = perpetual (yards, boundaries). When set, the app scopes job-cost totals
--    to the window and can auto-archive finished sites off the live map.
--
-- The RLS policy is widened so users see global zones + their own personal
-- ones, and the upsert RPC gains p_personal / p_active_from / p_active_until.

ALTER TABLE geofences ADD COLUMN IF NOT EXISTS owner_id     UUID;
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS active_from  TIMESTAMPTZ;
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS active_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS geofences_owner_idx ON geofences(owner_id) WHERE owner_id IS NOT NULL;

-- Visibility: company scope AND (global OR mine). A single FOR ALL policy keeps
-- global zones editable company-wide (owner_id NULL passes) while hiding other
-- users' personal zones from select/update/delete alike.
DROP POLICY IF EXISTS "company geofences" ON geofences;
CREATE POLICY "company geofences" ON geofences
  FOR ALL
  USING (company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid()))
  WITH CHECK (company_id = current_company_id() AND (owner_id IS NULL OR owner_id = auth.uid()));

-- Rebuild the GeoJSON view with the new columns (DROP first — 42P16).
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  owner_id,
  name,
  color,
  parent_id,
  kind,
  notes,
  active_from,
  active_until,
  created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;

-- Widen the upsert RPC. p_personal NULL = keep existing on edit / global on
-- create; TRUE = mine; FALSE = global. Dates: NULL keeps existing on edit.
CREATE OR REPLACE FUNCTION upsert_geofence(
  p_id           UUID,
  p_name         TEXT,
  p_color        TEXT,
  p_geometry     JSONB,
  p_parent_id    UUID DEFAULT NULL,
  p_kind         TEXT DEFAULT NULL,
  p_personal     BOOLEAN DEFAULT NULL,
  p_active_from  TIMESTAMPTZ DEFAULT NULL,
  p_active_until TIMESTAMPTZ DEFAULT NULL,
  p_clear_dates  BOOLEAN DEFAULT FALSE
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO geofences (company_id, name, color, parent_id, geometry, kind, owner_id, active_from, active_until)
    VALUES (current_company_id(), p_name, p_color, p_parent_id,
            ST_GeomFromGeoJSON(p_geometry::text), COALESCE(p_kind, 'site'),
            CASE WHEN p_personal IS TRUE THEN auth.uid() ELSE NULL END,
            p_active_from, p_active_until)
    RETURNING id INTO v_id;
  ELSE
    UPDATE geofences SET
      name = p_name, color = p_color, parent_id = p_parent_id,
      geometry = ST_GeomFromGeoJSON(p_geometry::text),
      kind = COALESCE(p_kind, kind),
      owner_id = CASE WHEN p_personal IS NULL THEN owner_id
                      WHEN p_personal IS TRUE THEN auth.uid()
                      ELSE NULL END,
      active_from  = CASE WHEN p_clear_dates THEN NULL ELSE COALESCE(p_active_from, active_from) END,
      active_until = CASE WHEN p_clear_dates THEN NULL ELSE COALESCE(p_active_until, active_until) END
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
