\set ON_ERROR_STOP on
\echo '=== HEAL (091): corrupt a proven ledger, then heal_on_site_from_sessions + ledger_heal_step → truth ==='
SELECT truth_new('2026-08-13 00:00Z'); SELECT snapshot('truth3');
-- Corrupt like the pre-087 decay did: drop rows, shrink others, wrong active; plus a duplicate session.
DELETE FROM usage_daily WHERE (extract(day from day)::int % 3) = 0;
UPDATE usage_daily SET on_site_secs = on_site_secs / 2 WHERE (extract(day from day)::int % 3) = 1;
UPDATE usage_daily SET active_secs = 12345 WHERE (extract(day from day)::int % 3) = 2;
INSERT INTO zone_sessions (company_id, geofence_id, asset_id, entered_at, exited_at)
SELECT company_id, geofence_id, asset_id, entered_at, exited_at FROM zone_sessions ORDER BY entered_at LIMIT 3;
SELECT count(*) AS corrupted_daily_rows FROM usage_daily;
DELETE FROM zone_sessions a USING zone_sessions b
 WHERE a.geofence_id = b.geofence_id AND a.asset_id = b.asset_id
   AND a.entered_at = b.entered_at AND a.exited_at = b.exited_at AND a.id > b.id;
SELECT heal_on_site_from_sessions() AS on_site_rows_touched;
DELETE FROM ledger_heal_state;
SELECT ledger_heal_step(100) AS days_healed;
SELECT ledger_heal_step(100) AS days_healed_second_call_expect_0;
SELECT snapshot('healed');
SELECT side, kind, count(*) FROM diff('truth3','healed') GROUP BY 1,2 ORDER BY 1,2;
SELECT * FROM diff('truth3','healed') LIMIT 10;
