-- Vehicle-health alerts (fuel low, 12V battery weak) fire straight from
-- telemetry — they have no geofence rule behind them, so alert_events needs
-- to stand alone: rule_id becomes nullable and `kind` names the system alert.

ALTER TABLE alert_events ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS kind TEXT;
-- kind: NULL for rule-based events; 'fuel_low' | 'battery_low' for system ones.
CREATE INDEX IF NOT EXISTS alert_events_kind_idx ON alert_events(asset_id, kind, triggered_at DESC);

-- Tag battery: BLE tools broadcast their coin-cell state (Eddystone TLM);
-- the truck relays it. Stored as percent on the live association.
ALTER TABLE tool_associations ADD COLUMN IF NOT EXISTS tag_battery INTEGER;
