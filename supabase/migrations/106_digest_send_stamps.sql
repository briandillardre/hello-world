-- 106 · Per-company send stamps for the three summaries that never had any.
--
-- Brian, Sep 11 2026, after two evening digests landed on his phone in the
-- same minute — one of them a different company's day:
-- "Fix whatever is causing this. I need to cut down on clients feeling too
--  spammed from this app."
--
-- The cause: /api/cron/digest, /api/cron/agenda and /api/cron/nag each looped
-- over EVERY company and POSTed the result to the single global
-- NOTIFY_WEBHOOK_URL. One founder ntfy topic received one notification per
-- company per night, carrying that company's fleet, crew and safety notes;
-- the company itself received nothing and could not switch it off.
--
-- Those three now deliver per company, gated on companies.digest_prefs
-- (evening / monday / nag keys, added in the same commit) at the company's
-- own local hour — the pattern 047's Friday digest and 054's briefing have
-- always used. These columns are the dedupe: the crons move to hourly so
-- they can honor a per-company hour + timezone, and the stamp is what stops
-- an hourly cron, a retry, or a manual poke from sending the same summary
-- twice in one day.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_evening_digest_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_agenda_at         TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_nag_at            TIMESTAMPTZ;

-- The companies deny-list trigger (096) governs which columns a member may
-- write. These are cron-owned, exactly like last_briefing_at: leave them out
-- of any member-writable path. Nothing to grant here — the crons write with
-- the service role.
