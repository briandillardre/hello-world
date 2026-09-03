\set ON_ERROR_STOP on
\echo '=== HARDENING: late data (72 h), hybrid tool — hourly incremental vs from-scratch (NEW fn) ==='
SELECT truth_new('2026-08-12 23:00Z'); SELECT snapshot('truth2');
SELECT simulate('new', '2026-08-01 01:00Z', '2026-08-12 23:00Z'); SELECT snapshot('inc2');
SELECT side, kind, count(*) FROM diff('truth2','inc2') GROUP BY 1,2 ORDER BY 1,2;
SELECT * FROM diff('truth2','inc2') LIMIT 12;
\echo '--- sanity: B split on Aug 6, T2 presence ends Aug 10 01:00 then GPS ---'
SELECT zone, asset, entered_at, exited_at FROM truth2_s WHERE asset = 'B excavator' ORDER BY entered_at;
SELECT zone, asset, entered_at, exited_at FROM truth2_s WHERE asset = 'T2 tool' AND entered_at >= '2026-08-09 20:00Z' ORDER BY entered_at LIMIT 4;
\echo '--- B late engine time banked (Aug 4 active must equal the from-scratch value) ---'
SELECT asset, day, on_site_secs, active_secs FROM inc2_d WHERE asset='B excavator' AND day IN ('2026-08-04','2026-08-06') ORDER BY day;
\echo '=== duplicate injection: a doubled straddler heals on the next hourly run ==='
INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
SELECT company_id, geofence_id, asset_id, entered_at, exited_at FROM zone_sessions s
 WHERE s.asset_id = (SELECT id FROM assets WHERE name='B excavator') ORDER BY entered_at LIMIT 1;
SELECT count(*) AS b_sessions_after_injection FROM zone_sessions WHERE asset_id = (SELECT id FROM assets WHERE name='B excavator');
SELECT run_all('new', '2026-08-12 23:00Z'::timestamptz - INTERVAL '48 hours', '2026-08-12 23:00Z');
SELECT snapshot('dedup');
SELECT side, kind, count(*) FROM diff('truth2','dedup') GROUP BY 1,2;
