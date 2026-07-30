-- Recorded SMS consent — the proof carriers ask for.
--
-- Toll-Free Verification (and 10DLC audits) require that the recipient
-- ACTIVELY opted in: "checkbox must be actively selected by the user, not
-- pre-checked." Displaying consent text beside the phone field isn't enough on
-- its own, and if a carrier ever challenges a message we need to be able to
-- say WHO consented, for WHICH number, and WHEN — not "there was some wording
-- on the page at the time."
--
-- So the checkbox is a real record, not just a UI gate: saving an alert phone
-- stamps these columns. Clearing the phone clears them, because consent is
-- tied to a specific number and doesn't carry over to a different one.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_consent_at    TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_consent_by    UUID;
-- The exact number consent was given for. If alert_phone later differs from
-- this, consent no longer covers it and the UI re-asks.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_consent_phone TEXT;

COMMENT ON COLUMN companies.sms_consent_at IS
  'When an admin ticked the SMS consent box. Carrier proof-of-consent record.';
COMMENT ON COLUMN companies.sms_consent_phone IS
  'Number consent was granted for; consent does not transfer to a new number.';
