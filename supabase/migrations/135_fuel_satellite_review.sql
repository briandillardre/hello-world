-- 135 — Review pass on 130 (fuel check pilot) and 131 (satellite site
-- pictures), Oct 6 2026. 130 and 131 shipped the same day and are frozen;
-- what the review found in SQL lands here.
--
-- Fuel tables: 130 created fuel_pilot, fuel_card_assets, fuel_transactions
-- and fuel_exceptions with Supabase's DEFAULT table grants — anon and
-- authenticated held SELECT/INSERT/UPDATE/DELETE/TRUNCATE (checked in
-- production before this was written). RLS denies every one of those today
-- (read policies only, no write policy, no anon policy), but TRUNCATE is not
-- governed by RLS at all and every other new table revokes them, so the
-- privileges go: anon gets nothing, a signed-in session keeps SELECT (the
-- read policies) and loses every write. All writes are the service role
-- behind lib/actions/fuel-check.ts. fuel_merchant_places was already
-- revoked from both in 130; restated here so the five read alike.
--
-- Satellite (131): the review's findings were all in code (the cron's
-- deadline, an order written down before it is placed, an idempotent
-- picture per scene, finished sites skipped, Planet behind the Billing
-- permission, the map preferring a recent drone shot) — no SQL needed.
--
-- Idempotent (REVOKE of a privilege not held is a no-op), five catalog
-- updates, no data touched, no backfill.

REVOKE ALL ON TABLE
  public.fuel_pilot,
  public.fuel_card_assets,
  public.fuel_transactions,
  public.fuel_exceptions,
  public.fuel_merchant_places
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.fuel_pilot,
  public.fuel_card_assets,
  public.fuel_transactions,
  public.fuel_exceptions,
  public.fuel_merchant_places
FROM authenticated;

NOTIFY pgrst, 'reload schema';
