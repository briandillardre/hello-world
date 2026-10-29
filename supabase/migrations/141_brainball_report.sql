-- 141: Brain Ball daily parent report (Brian, Oct 29: "sends reports max 1
-- daily if marshall or Lincoln played to my email … benchmarks and where
-- they stack similar to what we got from school").
--
-- /api/cron/brainball-report reads brainball_profiles with the service role,
-- builds an AMIRA-style standings email per kid who played since the last
-- report, sends it to the parent account's own email, and stamps the send
-- here (compare-and-set claim, so two runners can't double-send).
-- report_optout lets a parent turn the emails off (owner-writable via the
-- existing RLS update policy; no UI yet — flip it in the table if asked).

alter table public.brainball_profiles
  add column if not exists last_report_at timestamptz,
  add column if not exists report_optout boolean not null default false;
