-- 070: per-USER bottom-bar order (Brian, Aug 22 — "this order should
-- automatically save for next open per user"). The phone nav's tile order
-- follows the user across devices instead of living in one browser's
-- localStorage. Written via the service role only (profiles UPDATE was
-- revoked from authenticated in migration 068).
alter table profiles add column if not exists nav_order text[];
