-- 093: one registry may list a given 15-digit IMEI, platform-wide.
--
-- sec-check on 092 (Sep 4): the new ingest buffer delivered fixes for an
-- unassigned IMEI to EVERY company whose device_onboarding listed it, and
-- nothing stopped a tenant from listing an IMEI they do not own — a box's
-- IMEI is printed on it, and the TAC + Luhn space is enumerable. The ingest
-- now buffers for one company only (the last asset that carried the IMEI,
-- else a registry that is the sole lister); this index closes the other
-- half so a second tenant cannot list a live IMEI at all. Mirrors 084's
-- shape on assets.tracker_id. Beacon ids (hex, not 15 digits) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS device_onboarding_imei_one_registry
  ON device_onboarding (imei)
  WHERE imei ~ '^\d{15}$';
