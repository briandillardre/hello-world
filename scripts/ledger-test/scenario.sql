-- Synthetic 12-day fleet, Aug 1 (Sat) .. Aug 12 2026 UTC. Sundays: Aug 2, Aug 9.
CREATE TABLE pings_all (asset_id UUID, company_id UUID, lat float8, lng float8, speed real, ts timestamptz, created_at timestamptz);
CREATE TABLE pairing_final (LIKE pairing_log INCLUDING ALL);
DO $$
DECLARE
  co UUID; a UUID; b UUID; c UUID; d UUID; e UUID; f UUID; t1 UUID; t2 UUID; t3 UUID;
  t0 TIMESTAMPTZ := '2026-08-01 00:00Z'; day INT; h INT; m INT; ts TIMESTAMPTZ; wd BOOLEAN; late INTERVAL;
  yard_lng float8 := 0.5; site1 float8 := 10.5; site2 float8 := 20.5; road float8 := 5; far float8 := 30;
BEGIN
  INSERT INTO companies (name) VALUES ('Test Co') RETURNING id INTO co;
  INSERT INTO geofences (company_id, name, kind, geometry) VALUES
    (co, 'Yard', 'yard', ARRAY[0,0,1,1]::float8[]::geometry),
    (co, 'Site1', 'site', ARRAY[10,10,11,11]::float8[]::geometry),
    (co, 'Site2', 'site', ARRAY[20,20,21,21]::float8[]::geometry),
    (co, 'Vendor', 'vendor', ARRAY[40,40,41,41]::float8[]::geometry);
  INSERT INTO assets (company_id, name, type) VALUES (co,'A truck','vehicle') RETURNING id INTO a;
  INSERT INTO assets (company_id, name, type) VALUES (co,'B excavator','equipment') RETURNING id INTO b;
  INSERT INTO assets (company_id, name, type) VALUES (co,'C truck','vehicle') RETURNING id INTO c;
  INSERT INTO assets (company_id, name, type) VALUES (co,'D dead','equipment') RETURNING id INTO d;
  INSERT INTO assets (company_id, name, type) VALUES (co,'E night','vehicle') RETURNING id INTO e;
  INSERT INTO assets (company_id, name, type) VALUES (co,'F edge','vehicle') RETURNING id INTO f;
  INSERT INTO assets (company_id, name, type) VALUES (co,'T1 tool','tool') RETURNING id INTO t1;
  INSERT INTO assets (company_id, name, type) VALUES (co,'T2 tool','tool') RETURNING id INTO t2;
  INSERT INTO assets (company_id, name, type) VALUES (co,'T3 tool','tool') RETURNING id INTO t3;

  FOR day IN 0..11 LOOP
    wd := EXTRACT(DOW FROM t0 + day * INTERVAL '1 day') <> 0;
    FOR h IN 0..23 LOOP FOR m IN 0..59 LOOP
      ts := t0 + day * INTERVAL '1 day' + h * INTERVAL '1 hour' + m * INTERVAL '1 minute';
      -- A: yard nights (hourly), road 7 & 16 (per minute), site1 8-15 (per minute, moving first half hour)
      late := CASE WHEN day = 5 AND h BETWEEN 8 AND 9 THEN INTERVAL '30 hours' ELSE INTERVAL '0' END;
      IF wd THEN
        IF h <= 6 OR h >= 17 THEN
          IF m = 0 THEN INSERT INTO pings_all VALUES (a, co, yard_lng, yard_lng, 0, ts, ts + late); END IF;
        ELSIF h = 7 OR h = 16 THEN INSERT INTO pings_all VALUES (a, co, road, road, 30, ts, ts + late);
        ELSE INSERT INTO pings_all VALUES (a, co, site1, site1, CASE WHEN m < 30 THEN 10 ELSE 0 END, ts, ts + late);
        END IF;
      ELSIF m = 0 THEN INSERT INTO pings_all VALUES (a, co, yard_lng, yard_lng, 0, ts, ts);
      END IF;
      -- B: parked/working at site1 every 5 min
      IF m % 5 = 0 THEN
        late := CASE WHEN day = 7 AND h BETWEEN 10 AND 11 THEN INTERVAL '20 hours' ELSE INTERVAL '0' END;
        INSERT INTO pings_all VALUES (b, co, site1, site1, CASE WHEN wd AND h BETWEEN 9 AND 14 THEN 3 ELSE 0 END, ts, ts + late);
      END IF;
      -- C: far hourly; noon 2-min drive-through of site1; 13:00-15:58 site2 every 2 min
      IF h = 12 AND m <= 1 THEN INSERT INTO pings_all VALUES (c, co, site1, site1, 20, ts, ts);
      ELSIF h BETWEEN 13 AND 15 AND m % 2 = 0 THEN INSERT INTO pings_all VALUES (c, co, site2, site2, 5, ts, ts);
      ELSIF m = 0 THEN INSERT INTO pings_all VALUES (c, co, far, far, 0, ts, ts);
      END IF;
      -- D: yard hourly, dies after day 2
      IF day <= 2 AND m = 0 THEN INSERT INTO pings_all VALUES (d, co, yard_lng, yard_lng, 0, ts, ts); END IF;
      -- E: site2 22:00-02:00 per minute (crosses midnight), road 02:01-02:30, else far hourly
      IF h >= 22 OR h < 2 OR (h = 2 AND m = 0) THEN INSERT INTO pings_all VALUES (e, co, site2, site2, 4, ts, ts);
      ELSIF h = 2 AND m <= 30 THEN INSERT INTO pings_all VALUES (e, co, road, road, 25, ts, ts);
      ELSIF m = 0 THEN INSERT INTO pings_all VALUES (e, co, far, far, 0, ts, ts);
      END IF;
      -- F: 23:58-00:01 inside site1 (exactly 3 min), 00:02-00:10 road, else far hourly
      IF (h = 23 AND m >= 58) OR (h = 0 AND m <= 1) THEN INSERT INTO pings_all VALUES (f, co, site1, site1, 5, ts, ts);
      ELSIF h = 0 AND m <= 10 THEN INSERT INTO pings_all VALUES (f, co, road, road, 20, ts, ts);
      ELSIF m = 0 THEN INSERT INTO pings_all VALUES (f, co, far, far, 0, ts, ts);
      END IF;
    END LOOP; END LOOP;
  END LOOP;

  -- Tools: T1 rides A (two episodes with a 7h gap on day 3), T2 rides E from day 1, T3 rides C from day 4.
  INSERT INTO pairing_final (company_id, kind, member_asset_id, carrier_asset_id, started_at, last_seen, ended_at) VALUES
    (co, 'tool', t1, a, t0 + INTERVAL '1 day 06:00', t0 + INTERVAL '3 days 03:00', t0 + INTERVAL '3 days 03:00'),
    (co, 'tool', t1, a, t0 + INTERVAL '3 days 10:00', t0 + INTERVAL '12 days', NULL),
    (co, 'tool', t2, e, t0 + INTERVAL '00:30', t0 + INTERVAL '12 days', NULL),
    (co, 'tool', t3, c, t0 + INTERVAL '4 days 12:30', t0 + INTERVAL '9 days 14:15', t0 + INTERVAL '9 days 14:15');
END $$;
SELECT count(*) AS pings, count(*) FILTER (WHERE created_at > ts) AS late FROM pings_all;
