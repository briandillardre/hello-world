-- Backfill the THEFT alert rules that never existed.
--
-- Zone creation only ever wrote 'enter' and 'exit' rules. Both are info-severity
-- (logged, never dispatched), so a company could have every zone drawn, the
-- alerts page looking healthy, and STILL have no rule capable of firing the
-- product's headline alert — "your excavator left at 2 AM". Found Jul 30 while
-- setting up the live after-hours test: there was literally nothing to fire.
--
-- Two rules make the theft posture real:
--   left_site            — per zone; ingest fires it only on a true
--                          inside→outside transition, so per-zone is correct.
--   after_hours_movement — ONE per company. The engine ignores the zone for
--                          this trigger (any moving asset outside work hours
--                          qualifies), so a rule per zone would text the owner
--                          once per zone for the same truck.
--
-- Personal zones (owner_id set) are excluded: they're private reference only
-- and never drive company alerts. Idempotent — safe to re-run.

-- 1. left_site on every global zone that lacks one.
INSERT INTO alert_rules (company_id, geofence_id, asset_id, trigger, idle_minutes, active)
SELECT g.company_id, g.id, NULL, 'left_site', NULL, TRUE
FROM geofences g
WHERE g.owner_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM alert_rules r
    WHERE r.geofence_id = g.id AND r.trigger = 'left_site'
  );

-- 2. Exactly one after_hours_movement per company that has none, anchored to
--    that company's oldest global zone (geofence_id is NOT NULL and the
--    trigger doesn't read it).
INSERT INTO alert_rules (company_id, geofence_id, asset_id, trigger, idle_minutes, active)
SELECT DISTINCT ON (g.company_id) g.company_id, g.id, NULL, 'after_hours_movement', NULL, TRUE
FROM geofences g
WHERE g.owner_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM alert_rules r
    WHERE r.company_id = g.company_id AND r.trigger = 'after_hours_movement'
  )
ORDER BY g.company_id, g.created_at;
