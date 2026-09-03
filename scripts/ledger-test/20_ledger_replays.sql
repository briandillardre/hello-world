\set ON_ERROR_STOP on
\echo '=== sessions per asset in truth (tools must be present) ==='
SELECT asset, count(*) AS sessions FROM truth_s GROUP BY asset ORDER BY asset;
\echo '=== idempotency: re-run the final hour twice on the NEW state → no change ==='
SELECT run_all('new', '2026-08-12 23:00Z'::timestamptz - INTERVAL '48 hours', '2026-08-12 23:00Z');
SELECT run_all('new', '2026-08-12 23:00Z'::timestamptz - INTERVAL '48 hours', '2026-08-12 23:00Z');
SELECT snapshot('twice');
SELECT side, kind, count(*) FROM diff('truth','twice') GROUP BY 1,2;
\echo '=== zone reshape replay (1 year window) on top of incremental state → still truth ==='
SELECT run_all('new', '2026-08-12 23:00Z'::timestamptz - INTERVAL '365 days', '2026-08-12 23:00Z');
SELECT snapshot('replay');
SELECT side, kind, count(*) FROM diff('truth','replay') GROUP BY 1,2;
\echo '=== zone drawn today over existing history (no sessions yet) → truth ==='
DELETE FROM zone_sessions; DELETE FROM usage_daily;
SELECT run_all('new', '2026-08-12 23:00Z'::timestamptz - INTERVAL '365 days', '2026-08-12 23:00Z');
SELECT snapshot('fresh');
SELECT side, kind, count(*) FROM diff('truth','fresh') GROUP BY 1,2;
