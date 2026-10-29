-- 142: Brain Ball daily report — per-account recipient list (Brian, Oct 29:
-- send the report to two specific addresses, not just the login email).
-- Set from the Grown-ups report's parent-account card; the cron validates,
-- dedupes and caps the list, falling back to the account's own email when
-- empty. Owner-writable through 139's own-row RLS policies.

alter table public.brainball_profiles
  add column if not exists report_emails text[];
