-- OAuth support for OEM telematics connections (KOMTRAX, Jul 23 2026).
--
-- Komatsu's ISO 15143-3 API doesn't take basic auth on the Fleet URL — it
-- issues account credentials plus a TOKEN URL (…/provider/token) that mints
-- short-lived bearer tokens. Store the token endpoint per connection and
-- allow the new auth flavor.

ALTER TABLE oem_connections ADD COLUMN IF NOT EXISTS token_url TEXT;

ALTER TABLE oem_connections DROP CONSTRAINT IF EXISTS oem_connections_auth_type_check;
ALTER TABLE oem_connections ADD CONSTRAINT oem_connections_auth_type_check
  CHECK (auth_type IN ('basic', 'bearer', 'apikey', 'oauth'));
