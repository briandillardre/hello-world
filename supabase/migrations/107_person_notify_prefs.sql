-- 107 · Per-person push preferences.
--
-- Brian, Sep 12 2026, on the notification rework shipped the night before:
-- "No the push need to be per person and admins can go in to change this
--  for people."
--
-- 106 fixed WHERE a summary goes (the right company, once). This fixes WHO in
-- that company gets their phone lit up. Until now `sendPushToCompanyPlain`
-- selected every `device_tokens` row for the company, so the evening digest
-- reached a laborer's lock screen exactly as loudly as the owner's, and the
-- only way out was to switch the summary off for everybody.
--
-- Grain: one row per person per company already exists — `profiles`. The blob
-- holds the five push kinds in lib/person-notify.ts (alerts · receipts ·
-- evening · monday · nag). NULL means "role defaults", which is what every
-- existing row gets: alerts and their own receipts for everyone, the
-- company-wide summaries only for the people who run the company.
--
-- Reads: `profiles` SELECT is already company-wide (010) so the Team page can
-- show each person's switches. Nothing sensitive is in here — it is "does
-- this phone buzz", not a permission.
--
-- Writes: 068 REVOKEd UPDATE on profiles from every session role, so this
-- column can only be written by the service role, behind the ladder check in
-- lib/actions/person-notify.ts (yourself always; other people only if you
-- outrank them and hold the team ability). No new policy — that lockdown is
-- the point.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_prefs JSONB;

COMMENT ON COLUMN profiles.notify_prefs IS
  'Per-person push switches (lib/person-notify.ts). NULL = role defaults. Service-role writes only (068).';
