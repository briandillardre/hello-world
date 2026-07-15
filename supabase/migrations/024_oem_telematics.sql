-- OEM telematics connections (ISO 15143-3 / AEMP 2.0).
-- Most construction OEMs — Komatsu (KOMTRAX), Link-Belt (RemoteCARE), Cat
-- (VisionLink), CNH (FleetForce), Bomag (Telematic), Wirtgen (WITOS) — expose
-- engine hours, location, fuel, idle and fault codes over ONE standardized REST
-- feed. Each row is one such feed: the customer-provisioned Fleet URL + the
-- dealer-issued credentials. The oem-sync cron pulls every enabled row on a
-- schedule and maps machines to assets by serial / `aemp:<serial>` tracker_id.
--
-- Secrets live here (server-only). The service-role cron reads them; the
-- dashboard policy scopes management to the owning company, and the settings UI
-- must never select the `secret` column back to the browser.

CREATE TABLE IF NOT EXISTS oem_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,                          -- komatsu | linkbelt | cat | cnh | bomag | wirtgen | custom
  label        TEXT,                                   -- optional friendly name
  base_url     TEXT NOT NULL,                          -- page 1 of the ISO 15143-3 Fleet endpoint
  auth_type    TEXT NOT NULL DEFAULT 'basic' CHECK (auth_type IN ('basic', 'bearer', 'apikey')),
  username     TEXT,                                   -- basic auth
  secret       TEXT,                                   -- basic password / bearer token / api key
  header_name  TEXT,                                   -- apikey: header to send (default x-api-key)
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync    TIMESTAMPTZ,                            -- last successful pull
  last_status  TEXT,                                   -- 'ok: N machines' | error string
  last_count   INTEGER,                                -- machines matched on the last pull
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oem_connections_company_idx ON oem_connections(company_id);
CREATE INDEX IF NOT EXISTS oem_connections_enabled_idx ON oem_connections(company_id) WHERE enabled;

ALTER TABLE oem_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company oem connections" ON oem_connections
  FOR ALL USING (company_id = current_company_id());
