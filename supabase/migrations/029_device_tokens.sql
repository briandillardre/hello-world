-- Native push device tokens. The Capacitor app registers each install's push
-- token here so theft/critical alerts reach the lock screen — the killer
-- feature and Apple's "minimum functionality" (4.2) mitigation. Sending is
-- gated on Firebase creds (FCM), mirroring the optional-Twilio pattern.

CREATE TABLE IF NOT EXISTS device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID,
  platform    TEXT,                 -- 'ios' | 'android' | 'web'
  token       TEXT NOT NULL UNIQUE, -- one row per install; re-register updates last_seen
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_tokens_company_idx ON device_tokens(company_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company device tokens" ON device_tokens
  FOR ALL USING (company_id = current_company_id());
