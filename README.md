# TrackFlow

Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at a lower price point.

Track vehicles (OBD2), heavy equipment (GPS), personnel, and small tools (Bluetooth) on a live map.

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Supabase** — Postgres + PostGIS, Auth, Realtime
- **MapLibre GL JS** — open-source map renderer (no per-tile license fees)
- **Tailwind CSS + shadcn/ui** — mobile-first components

## Features

- **Live map** — vehicles, equipment, personnel, Bluetooth tools with clustering
- **Bluetooth tool tracking** — tools are located by the truck/equipment that detects them ("Drill Kit is in Truck #1")
- **Geofences & alerts** — including **after-hours movement (theft)** and **left-site** alerts
- **Maintenance** — service schedules (engine hours / mileage / days) with overdue tracking + service history
- **Utilization reports** — engine hours, idle %, miles, and hours-per-job-site
- **QuickBooks Online** — sync assets, allocate equipment cost to job sites, auto-bill usage, record service expenses
- **Real device ingestion** — Teltonika & Digital Matter via flespi; plus direct OBD2/location APIs
- **Pricing page** — public `/pricing`

## Quick Start

```bash
npm install
cp .env.example .env.local   # edit to add real keys, or leave as-is for demo mode
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Demo mode is active until you add real Supabase credentials — 10 mock assets appear at a Nashville, TN construction site.

## Setting Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Copy your project URL and keys into `.env.local`
3. Run the migration: paste `supabase/migrations/001_initial.sql` into the Supabase SQL editor
4. Done — auth, RLS, and realtime are active

## Connecting Real Trackers

All tracker types push to the ingestion API. API key shown in Settings page.

### OBD2 (Vehicles)

```
POST /api/ingest/obd2
x-api-key: YOUR_API_KEY

{ "tracker_id": "obd-001", "lat": 36.16, "lng": -86.78, "speed": 45, "engine_on": true }
```

Compatible: Bouncie, AutoPi, Optimus 2.0, Calamp LMU2630, any webhook OBD2 dongle.

### GPS Equipment Trackers

```
POST /api/ingest/location
x-api-key: YOUR_API_KEY

{ "tracker_id": "gps-002", "lat": 36.16, "lng": -86.78, "battery": 72 }
```

### Bluetooth Tools

Register each tool asset with its **BLE beacon ID/MAC as the `tracker_id`**. When a truck/equipment gateway (Teltonika/Digital Matter) detects the beacon, the tool is automatically associated with that gateway and inherits its location on the map.

## Connecting Cat-M1 trackers via flespi (recommended for production)

Professional Cat-M1 trackers — **Teltonika FMM130** (vehicles, OBD2 + BLE gateway) and **Digital Matter Oyster3** (equipment, 10-yr battery + BLE gateway) — stream through [flespi](https://flespi.com), which parses their protocol and forwards normalized JSON to TrackFlow.

1. Add your devices in flespi (by IMEI) — flespi auto-detects Teltonika/Digital Matter.
2. Set each device's flespi `ident` (IMEI) to match the asset's `tracker_id` in TrackFlow.
3. Create a flespi **stream** of type *webhook* pointing at:
   ```
   POST https://<your-app>/api/ingest/flespi
   Header: x-flespi-token: <FLESPI_WEBHOOK_TOKEN>
   ```
4. The endpoint accepts a single message or an array, parses GPS/battery/speed, and registers any detected BLE beacons as tool→gateway associations.

In demo mode (no `FLESPI_WEBHOOK_TOKEN`), the endpoint accepts requests and returns `mode: "demo"` without persisting.

## QuickBooks Online integration

1. Create an app at [developer.intuit.com](https://developer.intuit.com) with scope `com.intuit.quickbooks.accounting`.
2. Set the redirect URI to `https://<your-app>/api/qbo/callback`.
3. Add `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, and `QBO_ENVIRONMENT` to `.env.local`.
4. Visit **Settings → Connect QuickBooks**, or the **Accounting** page.

What it does:
- **Assets → QuickBooks** fixed-asset items
- **Job sites (geofences) → Customers/Projects**, with equipment-usage invoices built from utilization × hourly rates
- **Service records → expenses**

Without `QBO_CLIENT_ID`, QuickBooks runs in **demo mode** (mock connection + invoice previews, nothing sent to Intuit).

## PWA Install

Installable as a Progressive Web App. On iOS: Share → Add to Home Screen. On Android: browser menu → Install App.

## Deployment

```bash
vercel deploy        # Vercel (recommended)
npm run build && npm start   # self-hosted
```

## Pricing vs Tenna

| Feature | TrackFlow | Tenna |
|---|---|---|
| Live map | ✅ | ✅ |
| Geofencing & alerts | ✅ | ✅ |
| OBD2 vehicles | ✅ | ✅ |
| Bluetooth tools | ✅ | Add-on |
| Price per asset/mo | ~$3–8 | $15–25 |
| Setup fee | $0 | $500+ |
