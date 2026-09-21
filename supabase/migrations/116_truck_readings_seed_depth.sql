-- 116 — Truck readings: seed deeper.
--
-- 115 seeded each asset from its newest 400 fixes. A parked truck's newest
-- 400 fixes are hourly check-ins that carry no engine data, so the F350 —
-- which sent RPM, coolant, fuel level and FIVE check-engine codes in 2,783
-- of the last three days' rows — came up on hammertrack.ai with a lone 12 V
-- gauge, and "Not reported by this truck" listed exactly the readings it
-- reports (caught on the live check, Sep 21). Live merges since 115 only add
-- what arrives, and a parked truck sends nothing new.
--
-- Re-seed every active asset from up to 15,000 newest fixes inside 30 days:
-- bounded per asset (the (asset_id, timestamp DESC) index feeds it), and the
-- row is REPLACED — the merges since 115 all sit inside that window, so the
-- counts stay honest. Ingest keeps it current from here.

INSERT INTO public.asset_telemetry_latest (asset_id, company_id, readings, updated_at)
SELECT a.id, a.company_id, r.readings, now()
FROM public.assets a
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(s.key, jsonb_build_object('v', s.v, 't', s.t, 'n', s.n, 'since', s.since)) AS readings
  FROM (
    SELECT e.key,
           (array_agg(e.value ORDER BY w.ts DESC))[1] AS v,
           to_char(max(w.ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t,
           count(*) AS n,
           to_char(min(w.ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS since
    FROM (
      SELECT al."timestamp" AS ts, al.raw
      FROM public.asset_locations al
      WHERE al.asset_id = a.id
        AND al.raw IS NOT NULL
        AND al."timestamp" >= now() - interval '30 days'
      ORDER BY al."timestamp" DESC
      LIMIT 15000
    ) w
    CROSS JOIN LATERAL jsonb_each(w.raw) e
    WHERE e.key NOT IN ('ident', 'device.id', 'timestamp', 'position.latitude', 'position.longitude', 'position.speed', 'position.direction', 'position.altitude', 'ble.beacons')
      AND jsonb_typeof(e.value) IN ('number', 'string', 'boolean')
    GROUP BY e.key
  ) s
) r
WHERE a.active AND r.readings IS NOT NULL
ON CONFLICT (asset_id) DO UPDATE
  SET readings = EXCLUDED.readings, company_id = EXCLUDED.company_id, updated_at = now();
