-- 091: replay the ledger once more, now under 090's per-zone lock.
--
-- 088's heal ran at deploy while the hourly usage cron could also be
-- rebuilding the same zones; before 090 two overlapping rebuilds left each
-- zone with a doubled session set and doubled usage_daily hours that the
-- hourly run never healed (ship-check P1). One clean pass from the oldest
-- ping on record puts every zone back to exactly what its pings say.
SELECT rebuild_all_usage(now() - INTERVAL '90 days', now());
