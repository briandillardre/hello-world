-- Where theft / geofence alerts get delivered. Both optional; if unset the
-- notifier falls back to the ALERT_SMS_TO / ALERT_EMAIL_TO env vars (pilot use).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS alert_phone TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS alert_email TEXT;
