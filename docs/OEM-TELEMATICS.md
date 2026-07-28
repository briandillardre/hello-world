# OEM Telematics Ingestion (ISO 15143-3 / AEMP 2.0)

*Built Jul 15 2026 (task #92). Pulls equipment telematics — engine hours, GPS,
fuel, idle, DEF, fault codes — straight from OEM APIs into HammerTrack, with no
on-machine hardware. Komatsu (KOMTRAX) and Link-Belt (RemoteCARE) are the first
two feeds; the same connector serves Cat, CNH, Bomag, and Wirtgen.*

## Why this exists
Most major construction OEMs already stream machine data to their own portals
(My Komatsu, RemoteCARE, VisionLink, FleetForce…) and expose it over ONE
standardized REST feed: **ISO 15143-3**, also called **AEMP 2.0**. Instead of
buying a CAN kit for every machine, we pull those feeds directly. A mixed fleet
(Komatsu + Cat + Link-Belt + Bomag) shows up on one map with real hours feeding
the maintenance meters — the premium aggregation feature enterprise platforms
(Tenna) charge for. See `docs/FLEET-TELEMATICS.md` for the per-machine matrix.

**Caveat:** OEM feeds are low-frequency snapshots (minutes–hours), so real-time
theft still needs a live tracker. Pair API-pull with a TAT141 on high-value
machines.

## Architecture
| Piece | File | Role |
|---|---|---|
| Parser | `lib/aemp.ts` | ISO 15143-3 Fleet JSON → normalized `AempReading` (tolerant of OEM casing/alias drift); pagination via `nextLink` |
| HTTP client + presets | `lib/aemp-client.ts` | Fetches every Fleet page with basic/bearer/apikey auth; `OEM_PRESETS` carry each OEM's auth style + where to get creds |
| Persistence | `lib/aemp-ingest.ts` | Maps OEM machine → HammerTrack asset by serial; writes `asset_locations` (map/timeline) + `assets.metadata` (hours/fuel/faults); logs active faults to `alert_events` |
| Pull cron | `app/api/cron/oem-sync/route.ts` | Runs every 2h (`vercel.json`); pulls each enabled `oem_connections` row; records `last_status`; nudges owner about unregistered machines |
| Push endpoint | `app/api/ingest/aemp/route.ts` | `POST /api/ingest/aemp?company=<id>&provider=<p>` (x-api-key) for aggregator push, backfill, and testing |
| Connections table | `supabase/migrations/024_oem_telematics.sql` | `oem_connections` — one row per OEM feed (URL + credentials), company-scoped RLS, secrets server-only |

## How a machine links to an asset
The cron matches each OEM machine to a HammerTrack asset by, in order:
1. `tracker_id = aemp:<SerialNumber>`  ← **the registration convention**
2. `tracker_id = aemp:<PIN>` or `aemp:<EquipmentID>`
3. `assets.serial` equals the machine's SerialNumber or PIN (case/format-insensitive)

So the simplest path: register the machine as an asset and either set its
**Serial/VIN** field to the OEM serial, or set its **tracker_id** to
`aemp:<serial>`. Machines the OEM reports but that aren't registered are listed
in the cron result and trigger a once-daily "link these" nudge to the owner.

## Setup — adding the Komatsu & Link-Belt feeds
1. **Get API access from the OEM** (one-time, via the dealer/portal):
   - **Komatsu** — My Komatsu → Admin → API Access → request the ISO 15143-3
     (AEMP 2.0) API. Komatsu issues a **Fleet URL** + basic-auth username/password.
   - **Link-Belt** — ask the dealer to enable the RemoteCARE ISO 15143-3 feed;
     it's served through ORBCOMM, which returns a Fleet URL + credentials.
2. **Insert a connection row** (Supabase SQL Editor — service-role only):
   ```sql
   -- Komatsu (KOMTRAX): OAuth — the dealer email includes a Fleet URL, an
   -- Account + Password, AND a Token URL. Needs migration 038.
   insert into oem_connections (company_id, provider, label, base_url, auth_type, username, secret, token_url)
   values ('<company_id>', 'komatsu', 'Komatsu KOMTRAX',
           'https://isoapi.komtrax.komatsu/provider/v1/<acct#>/Fleet/1',
           'oauth', '<Account>', '<Password>',
           'https://isoapi.komtrax.komatsu/provider/token');

   -- Link-Belt (ORBCOMM): plain basic auth.
   insert into oem_connections (company_id, provider, label, base_url, auth_type, username, secret)
   values ('<company_id>', 'linkbelt', 'Link-Belt RemoteCARE',
           'https://<orbcomm-fleet-url>/1', 'basic', '<user>', '<pass>');
   ```
   `base_url` is page 1 of the Fleet endpoint; the client follows `Links.Next`
   to the end. Auth flavors: `oauth` (token URL mints short-lived bearers —
   the client tries client-credentials then password grants), `basic`,
   `bearer`, or `apikey` + `header_name`.
3. **Register the machines** as assets with `tracker_id = aemp:<serial>` (or just
   fill in the Serial field). Confirmed DCG serials: Link-Belt 130X2 = `EFCK2-6671`.
4. **Wait for the cron** (runs at :15 every 2h) or trigger a pull manually:
   ```
   GET /api/cron/oem-sync   with header  Authorization: Bearer $CRON_SECRET
   ```
   Check `oem_connections.last_status` — `ok: N matched / M reported` means it's live.

## Testing without live OEM creds
Push a sample ISO 15143-3 payload straight in:
```
POST /api/ingest/aemp?company=<id>&provider=komatsu
Header: x-api-key: $INGEST_API_KEY
Body:  { "Equipment": [ { "EquipmentHeader": {...}, "Location": {...}, ... } ] }
```
In demo mode (no Supabase env) it echoes the parsed reading without persisting.

## What lands where
- **Map / timeline** — each snapshot with a GPS fix writes an `asset_locations`
  row (`raw.source = "aemp:<provider>"`), so OEM machines appear alongside
  flespi/OBD assets.
- **`assets.metadata`** — `engine_hours`, `idle_hours`, `odometer_km`/`odometer`
  (mi), `fuel_pct`, `fuel_used_l`, `def_pct`, `engine_on`, `oem`, `oem_faults`,
  `last_oem_sync`.
- **Faults** — active fault codes log an `alert_events` row (`kind='oem_fault'`,
  deduped 24h) and page the owner (warning severity).

## Env
No new env vars. Uses the existing `CRON_SECRET` (cron auth) and `INGEST_API_KEY`
(push auth). Credentials for each OEM live in the `oem_connections` row.
