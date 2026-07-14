-- Data hygiene, applied automatically on deploy (owner directive Jul 14:
-- one-off SQL ships as migrations — no more SQL-Editor pasting).

-- 1) Every existing zone gets enter + exit rules (all assets) so zone
--    activity logs and alert pins work without manual setup. Idempotent.
INSERT INTO alert_rules (company_id, geofence_id, trigger)
SELECT g.company_id, g.id, t.trigger
FROM geofences g, (VALUES ('enter'), ('exit')) AS t(trigger)
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules r WHERE r.geofence_id = g.id AND r.trigger = t.trigger
);

-- 2) Nashville seed residue. Tools have no GPS — location rows on tools are
--    demo leftovers that pinned Tool A/B to Tennessee.
DELETE FROM asset_locations
WHERE asset_id IN (SELECT id FROM assets WHERE type = 'tool');

-- 3) Leftover seeded placeholder assets (exact seed tracker ids only —
--    never pattern-matching, which would catch real BLE tools).
DELETE FROM assets
WHERE tracker_id IN (
  'obd-001','gps-002','bt-003','bt-004','gps-005',
  'obd-006','bt-007','bt-008','gps-009','obd-010'
);

-- 4) Seeded Nashville demo zones — matched by the exact seeded names AND a
--    Tennessee bounding box, so a real SC zone reusing a name is untouched.
DELETE FROM geofences
WHERE name IN ('Riverfront Tower', 'Maple St Grading', 'Equipment Yard')
  AND ST_Intersects(geometry, ST_MakeEnvelope(-87.2, 35.8, -86.4, 36.5, 4326));

-- 5) Close any open pairing episodes that disagree with the current (signal-
--    arbitrated) associations — e.g. the bogus "Tool A rode the Atlas"
--    episode from before strongest-signal wins. Fresh episodes reopen on the
--    next beacon report.
UPDATE pairing_log p SET ended_at = p.last_seen
WHERE p.ended_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tool_associations ta
    WHERE ta.tool_asset_id = p.member_asset_id
      AND ta.gateway_asset_id = p.carrier_asset_id
  );
