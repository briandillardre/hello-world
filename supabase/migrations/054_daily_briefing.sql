-- 054: daily site briefing — ForeFlight-style morning brief per company.
-- Weekday mornings (default 6 AM local, editable in Settings → Weekly
-- summaries): today's weather per job site, yesterday's hours/cost per site,
-- what's due today, and anything broken (silent trackers, overdue service,
-- open work orders). The stamp makes the hourly cron idempotent per day.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_briefing_at TIMESTAMPTZ;
