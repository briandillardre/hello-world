# Showroom company (simulator)

A REAL production company whose devices are simulated — the demo Brian can
log into and reshape like any customer ("I want the simulator company as the
example so I can make it what it needs to be", Aug 23).

## How it works

- `companies.simulated = true` marks a showroom company (migration 075).
- `/api/cron/simulator` (every 5 min, CRON_SECRET) generates flespi-shaped
  messages for the fleet and POSTs them to the app's own
  `/api/ingest/flespi` webhook with `FLESPI_WEBHOOK_TOKEN`. Simulated trucks
  are indistinguishable from Teltonika hardware, so alerts, zone sessions,
  tool pairing (BLE beacons ride the trucks' messages), stops and the cost
  ledger all run the production code path.
- The engine (`lib/sim/engine.ts`) is deterministic and stateless: positions
  are a pure function of (asset, local day, minute), and each run catches up
  from the fleet's newest stored fix (capped at 6 h). Killing or missing
  cron runs loses nothing.
- Routes between zones come from the public OSRM router (real roads),
  cached in `sim_routes` keyed by rounded zone centroids — **move a zone in
  the app and trucks route to the new spot** on the next run. OSRM down =
  gently bowed fallback lines until it recovers.
- Day story: trucks leave the yard ~7, supervisor runs rounds between
  sites (+ vendor some days, lunch engine-off), the dump truck loops
  site ↔ quarry, machines run serpentine passes with idle blocks
  7:15–15:30, people ping phone-style (no ignition) on site, everything
  sleeps after hours (hourly check-ins — honest Night Watch).

## Setting it up (Brian)

1. Create a FRESH account (e.g. showroom@hammertrack.ai) — the seed refuses
   to touch a company that has real hardware, so DCG is safe.
2. Make sure that email is in `PLATFORM_OWNER_EMAILS` (or use an
   @hammertrack.ai address).
3. Visit `/model` → **Showroom company** card → Seed.
4. Within ~5 minutes the simulator backfills 6 h of history and keeps going.
5. Shape it: drag/redraw zones, rename assets, add zones (kind matters —
   `yard` = home base, `site` = where machines work, `vendor` = haul
   destination). New `site`/`vendor` zones join the story automatically.

## Knobs

- `SIM_INGEST_URL` (env, optional) — override the self-POST base URL.
- Per-asset `metadata.sim`: `role: 'hauler' | 'rounds'` (vehicles),
  `zoneIdx` (machines/people — which site, in zone-creation order),
  `carrier` (tools — the tracker_id whose BLE messages carry the tag).
- Company `work_days` drives which days the fleet runs.

Removing a showroom: set `companies.simulated = false` (stops the feed);
delete the company to drop its data entirely.
