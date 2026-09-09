-- 099 · Receipt chase v2 (Brian, Sep 9 2026: "the pushed notification to the
-- correct person of whomever's card was run and annoy the hell out of them
-- until they take a picture of the receipt … these should also be a layer to
-- be shown on the map").
--
-- Where the SWIPE happened: the truck standing inside the vendor zone at
-- swipe time (051 handshake), else the cardholder's phone. This is the pin
-- the Receipts map layer draws while the receipt is still missing.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS swipe_lat      DOUBLE PRECISION;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS swipe_lng      DOUBLE PRECISION;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS swipe_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
-- The T+24 h rung told the owner/admins about this one (sent once).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS escalated_at   TIMESTAMPTZ;

-- Where the receipt PHOTO was taken (capture page GPS, EXIF for uploads) and
-- when — the captured pin on the map, and evidence beside the charge.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS lat      DOUBLE PRECISION;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS lng      DOUBLE PRECISION;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- A cell number per PERSON so the nag can text the cardholder, not the
-- office (companies.alert_phone stays the office line for alerts/digests).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- The chase cron reads open charges per company every 15 minutes.
CREATE INDEX IF NOT EXISTS expenses_company_status_txn_idx ON expenses (company_id, status, txn_date DESC);
