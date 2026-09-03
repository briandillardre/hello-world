-- Drivers: run all billing zones with old/new; snapshot; compare.
CREATE OR REPLACE FUNCTION run_all(p_mode TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS void LANGUAGE plpgsql AS $$
DECLARE z RECORD;
BEGIN
  FOR z IN SELECT id FROM geofences WHERE COALESCE(kind,'site') IN ('site','yard') ORDER BY created_at LOOP
    IF p_mode = 'old' THEN PERFORM rebuild_zone_usage_old(z.id, p_from, p_to);
    ELSE PERFORM rebuild_zone_usage(z.id, p_from, p_to); END IF;
  END LOOP;
END $$;

-- Simulate arrival: pings_all holds every ping with its arrival time; pairing_final holds final episode values.
CREATE OR REPLACE FUNCTION advance_to(p_h TIMESTAMPTZ) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO asset_locations (asset_id, company_id, lat, lng, speed, "timestamp", created_at)
  SELECT asset_id, company_id, lat, lng, speed, ts, created_at FROM pings_all
  WHERE created_at <= p_h AND created_at > (SELECT COALESCE(max(created_at), '-infinity') FROM asset_locations);
  UPDATE pairing_log pl SET
    last_seen = LEAST(f.last_seen, p_h),
    ended_at = CASE WHEN f.ended_at IS NOT NULL AND f.ended_at <= p_h THEN f.ended_at END
  FROM pairing_final f WHERE f.id = pl.id AND f.started_at <= p_h;
END $$;

CREATE OR REPLACE FUNCTION simulate(p_mode TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h TIMESTAMPTZ := p_start;
BEGIN
  TRUNCATE zone_sessions, usage_daily, asset_locations;
  -- pairing rows exist from the start but are "unseen" until started_at passes
  DELETE FROM pairing_log;
  INSERT INTO pairing_log (id, company_id, kind, member_asset_id, carrier_asset_id, started_at, last_seen, ended_at)
  SELECT id, company_id, kind, member_asset_id, carrier_asset_id, started_at, started_at, NULL FROM pairing_final;
  WHILE h <= p_end LOOP
    PERFORM advance_to(h);
    PERFORM run_all(p_mode, h - INTERVAL '48 hours', h);
    h := h + INTERVAL '1 hour';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION truth(p_end TIMESTAMPTZ) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE zone_sessions, usage_daily, asset_locations;
  PERFORM advance_to(p_end);
  DELETE FROM pairing_log;
  INSERT INTO pairing_log SELECT * FROM pairing_final WHERE started_at <= p_end;
  UPDATE pairing_log SET last_seen = LEAST(last_seen, p_end);
  PERFORM run_all('old', p_end - INTERVAL '365 days', p_end);
END $$;

CREATE OR REPLACE FUNCTION snapshot(p_name TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TABLE IF EXISTS %I_s; CREATE TABLE %I_s AS SELECT g.name AS zone, a.name AS asset, s.entered_at, s.exited_at FROM zone_sessions s JOIN geofences g ON g.id=s.geofence_id JOIN assets a ON a.id=s.asset_id', p_name, p_name);
  EXECUTE format('DROP TABLE IF EXISTS %I_d; CREATE TABLE %I_d AS SELECT g.name AS zone, a.name AS asset, u.day, u.on_site_secs, u.active_secs FROM usage_daily u JOIN geofences g ON g.id=u.geofence_id JOIN assets a ON a.id=u.asset_id', p_name, p_name);
END $$;

CREATE OR REPLACE FUNCTION diff(p_a TEXT, p_b TEXT) RETURNS TABLE (side TEXT, kind TEXT, zone TEXT, asset TEXT, a TEXT, b TEXT, c TEXT) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE format($q$
    SELECT 'only_in_%1$s', 'session', zone, asset, entered_at::text, exited_at::text, NULL FROM (SELECT * FROM %1$I_s EXCEPT SELECT * FROM %2$I_s) x
    UNION ALL SELECT 'only_in_%2$s', 'session', zone, asset, entered_at::text, exited_at::text, NULL FROM (SELECT * FROM %2$I_s EXCEPT SELECT * FROM %1$I_s) x
    UNION ALL SELECT 'only_in_%1$s', 'daily', zone, asset, day::text, on_site_secs::text, active_secs::text FROM (SELECT * FROM %1$I_d EXCEPT SELECT * FROM %2$I_d) x
    UNION ALL SELECT 'only_in_%2$s', 'daily', zone, asset, day::text, on_site_secs::text, active_secs::text FROM (SELECT * FROM %2$I_d EXCEPT SELECT * FROM %1$I_d) x
    ORDER BY 2, 3, 4, 5 $q$, p_a, p_b);
END $$;
