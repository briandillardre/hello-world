-- Customizable alert rules ("the Trigger needs to be more customizable —
-- not just the 4 options", owner, Jul 31).
--
-- params JSONB carries per-rule tuning, all optional:
--   max_mph   INTEGER — 'speeding': fire when moving faster than this inside the zone
--   start,end TEXT    — 'after_hours_movement': custom watch window ("22:00","05:00")
--                        instead of "outside company work hours"; wraps midnight
--   days      INT[]   — watch-window days (0=Sun..6=Sat); absent = every day
--   critical  BOOL    — escalate an info/warning trigger to critical (SMS path)

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS params JSONB;

-- Widen the trigger vocabulary for 'speeding'.
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_trigger_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_trigger_check
  CHECK (trigger IN ('enter', 'exit', 'idle', 'after_hours_movement', 'left_site', 'speeding'));
