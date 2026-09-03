\set ON_ERROR_STOP on
SELECT truth('2026-08-12 23:00Z'); SELECT snapshot('truth');
SELECT simulate('new', '2026-08-01 01:00Z', '2026-08-12 23:00Z'); SELECT snapshot('newinc');
\echo '=== truth vs NEW incremental: differences by kind (expect 0 rows) ==='
SELECT side, kind, count(*) FROM diff('truth','newinc') GROUP BY 1,2 ORDER BY 1,2;
SELECT * FROM diff('truth','newinc') LIMIT 20;
\echo '=== sanity: session + daily counts, sample sessions ==='
SELECT (SELECT count(*) FROM truth_s) AS sessions, (SELECT count(*) FROM truth_d) AS daily_rows;
SELECT zone, asset, entered_at, exited_at FROM truth_s WHERE asset IN ('F edge','T1 tool','E night') ORDER BY asset, entered_at LIMIT 14;
