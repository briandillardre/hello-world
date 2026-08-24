-- 078: trail-rollup performance + late-data correctness (ship-check on 077).
--
-- P1: build_trail_daily's "timestamp >= day AND < day+1" predicate had NO
-- usable index (001 only indexes (asset_id, timestamp)), so every build was
-- a full seq scan of asset_locations — and trail_backfill's per-day EXISTS
-- probe re-scanned ping-less days on every hourly run, forever, with the
-- set growing over time. One btree on the raw timestamp makes each day's
-- build a cheap range scan at any table size.
CREATE INDEX IF NOT EXISTS asset_locations_timestamp_idx
  ON asset_locations ("timestamp");

-- P1: replace the "day missing from trail_daily?" probe with a watermark.
-- The old check was day-GLOBAL (any company's row marked the day done) and
-- ping-less days never got a row, so they were re-probed hourly forever.
-- The watermark walks history forward exactly once — empty days advance it
-- too and are never touched again. Late-arriving raw data is handled by the
-- cron's trailing-window rebuild, not the backfill. To force a full
-- re-drain (e.g. after importing old history), delete the state row.
CREATE TABLE IF NOT EXISTS trail_backfill_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  done_through DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Service-role/cron only — no policies on purpose.
ALTER TABLE trail_backfill_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trail_backfill_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trail_backfill(p_days INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_day DATE;
  v_min DATE;
  v_built INTEGER := 0;
BEGIN
  SELECT done_through + 1 INTO v_day FROM trail_backfill_state WHERE id;
  IF v_day IS NULL THEN
    SELECT min("timestamp")::date INTO v_min FROM asset_locations;
    IF v_min IS NULL THEN RETURN 0; END IF;
    v_day := v_min;
  END IF;
  WHILE v_day <= current_date - 1 AND v_built < GREATEST(1, p_days) LOOP
    -- Idempotent per day; a no-ping day simply upserts nothing.
    PERFORM build_trail_daily(v_day);
    v_built := v_built + 1;
    v_day := v_day + 1;
  END LOOP;
  IF v_built > 0 THEN
    INSERT INTO trail_backfill_state (id, done_through)
    VALUES (TRUE, v_day - 1)
    ON CONFLICT (id) DO UPDATE
      SET done_through = EXCLUDED.done_through, updated_at = now();
  END IF;
  RETURN v_built;
END $$;

REVOKE ALL ON FUNCTION trail_backfill(INTEGER) FROM PUBLIC, anon, authenticated;
