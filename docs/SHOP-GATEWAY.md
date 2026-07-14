# Fixed BLE Gateway for the Shop / Yard — Spec

*Jul 14 2026. Goal: every tagged tool inside the shop stays visible 24/7 with
no truck present, and a tool leaving the building timestamps immediately.
Internal doc — vendor names OK here.*

## Recommended unit

**Minew MG4 (BLE 5.1 → WiFi + Ethernet gateway), ~$70–90**
- Scans all nearby BLE advertisements (iBeacon + Eddystone TLM — so it hears
  our FeasyBeacon tags AND their battery telemetry, which the truck units may
  not forward).
- Pushes JSON over HTTP POST or MQTT to any URL on an interval you set
  (5–60 s). Powered by USB-C or PoE. Range ~50–80 m indoors — one unit covers
  a typical shop; add a second for a big yard.
- Alternative: **INGICS iGS03W** (~$80–100, same idea, very reliable, WiFi;
  iGS03E for ethernet/PoE). Either works — buy whichever ships faster.
- Budget option: a spare FMM00A on a 12V bench supply is a zero-integration
  gateway TODAY (same flespi path), at the cost of ~$1/mo SIM data — a fine
  stopgap until the WiFi unit arrives.

## How it plugs into HammerTrack

1. Create a **"Shop" asset** (type equipment) with a fixed location (one
   manual location row at the shop's coordinates).
2. New endpoint `/api/ingest/ble-gateway` (build when the unit ships):
   - Auth: `x-api-key` = INGEST_API_KEY (same fail-closed pattern as
     /api/ingest/obd2).
   - Payload: the gateway's JSON array of sightings
     `{beacon id/mac, rssi, battery}` + the gateway's serial.
   - Server maps serial → the Shop asset, then runs the SAME beacon matcher,
     strongest-signal arbitration, tool_associations upsert, and pairing_log
     episodes as the truck path. The shop is just another carrier.
3. Result: tools in the shop show "with Shop", the Shop dot wears the tool
   count badge, pairing history reads "Tool A rode with Chevy → Shop", and
   walking out the door flips the association to whichever truck it left in.

## Why this beats WiFi tags

The tags stay $20 BLE (no per-tool WiFi radios, no per-tool credentials);
the building gets ONE radio that speaks to all of them. Same model as the
trucks — coverage grows by adding ears, not by changing tags.

## Order list

| Item | Qty | Est. |
|---|---|---|
| Minew MG4 (or INGICS iGS03W) | 1 (shop) + 1 optional (yard) | $70–90 ea |
| USB-C power brick or PoE drop | 1 per unit | on hand |

When it arrives: plug in, join shop WiFi, point HTTP push at the endpoint,
send me the gateway serial — I wire the Shop asset + endpoint the same day.
