-- 082: one ACTIVE owner per IMEI, platform-wide (sec-check, Aug 28).
--
-- The per-company UNIQUE (company_id, tracker_id) from 001 lets two
-- companies register the SAME device IMEI. The platform ingest paths
-- resolve devices with an unscoped tracker_id lookup, so a second
-- registration made .single() match two rows and the REAL device's
-- readings were silently dropped — company A (typo or mischief) could
-- kill company B's telemetry without anyone seeing an error. Now the
-- second registration fails loudly at scan/create time (23505 → the
-- "already on another asset" message) instead.
--
-- Scope deliberately narrow:
--   · 15-digit IMEIs only — BLE tool tags (UUID:major:minor) ship with
--     factory-default UUID+Major and small Minor numbers, so DIFFERENT
--     companies legitimately hold identical tag ids; tags never resolve
--     through the unscoped device lookups (they ride gateway payloads,
--     scoped per company), so they stay per-company unique only.
--   · active = true only — deactivating an asset releases its IMEI,
--     which is exactly the resale/hand-me-down flow (old owner retires
--     the asset, new owner scans the box).
CREATE UNIQUE INDEX IF NOT EXISTS assets_imei_one_active_owner
  ON assets (tracker_id)
  WHERE tracker_id ~ '^\d{15}$' AND active = true;
