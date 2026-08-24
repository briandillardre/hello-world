-- 075: Showroom simulator (Brian, Aug 23 — "I want the simulator company as
-- the example so I can make it what it needs to be").
--
-- A showroom company is a REAL company row whose "devices" are driven by
-- /api/cron/simulator through the ordinary flespi ingest pipeline — alerts,
-- zone sessions, tool pairing and stops all behave exactly as they do for
-- hardware. The owner logs in like any customer and shapes zones/assets;
-- the simulator follows whatever the zones currently are.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS simulated BOOLEAN NOT NULL DEFAULT false;

-- OSRM road geometry cache between zone pairs, keyed by rounded centroids —
-- move a zone and the key changes, so the next cron run re-routes on real
-- roads to the new spot.
CREATE TABLE IF NOT EXISTS sim_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  geometry JSONB NOT NULL,            -- [[lng,lat], ...] road polyline
  meters DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

-- Service-role only (the simulator cron); no client policies on purpose.
ALTER TABLE sim_routes ENABLE ROW LEVEL SECURITY;
