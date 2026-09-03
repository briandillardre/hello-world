-- 089: pin search_path on the trail rollup functions (sec-check P3 on 087).
--
-- build_trail_daily / trail_backfill (077/078) and build_trail_recent (087)
-- are SECURITY INVOKER and REVOKEd from anon/authenticated, so this is
-- hygiene rather than a hole — but Supabase's linter flags every function
-- without a fixed search_path (function_search_path_mutable), and Brian
-- was asked to re-run that linter after 086. Same setting the ledger's
-- DEFINER functions already carry.
ALTER FUNCTION build_trail_daily(DATE) SET search_path = public;
ALTER FUNCTION trail_backfill(INTEGER) SET search_path = public;
ALTER FUNCTION build_trail_recent() SET search_path = public;
