-- 069: honest "synced offline" marker (ship-check P1, Aug 22).
-- The /logs badge keyed off idempotency_key — but the ONLINE clock-out path
-- also sends a key on every submit (it's the double-tap guard), so every log
-- since 066 wore "synced offline" and the badge meant nothing. Only the
-- offline queue's replay executor sends _queuedAt, so the server stamps this
-- flag from that signal alone.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS offline_synced BOOLEAN NOT NULL DEFAULT FALSE;
