-- 047: weekly owner digests — Friday recap + Sunday week-ahead.
--
-- Brian, Aug 1: "a Friday afternoon email and/or text, plus a Sunday
-- afternoon/evening email of what needs to be done this week — editable in
-- Settings." Prefs ride one JSONB column; NULL means the defaults apply
-- (both on, email only, Fri 4 PM / Sun 6 PM, America/New_York).
--
-- Shape: { "friday": {"enabled":true,"email":true,"sms":false,"hour":16},
--          "sunday": {"enabled":true,"hour":18},
--          "tz": "America/New_York" }

ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest_prefs JSONB;

-- Send-once guards: the cron runs hourly on Fri/Sun and stamps these, so a
-- redeploy or retry inside the send hour can't double-mail the owner.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_friday_digest_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_sunday_digest_at TIMESTAMPTZ;
