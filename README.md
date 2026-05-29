# TrackFlow

Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at a lower price point.

Track vehicles (OBD2), heavy equipment (GPS), personnel, and small tools (Bluetooth) on a live map.

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Supabase** — Postgres + PostGIS, Auth, Realtime
- **MapLibre GL JS** — open-source map renderer (no per-tile license fees)
- **Tailwind CSS + shadcn/ui** — mobile-first components

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

BLE tags pair with a companion mobile app that scans nearby BLE beacons and POSTs their location to `/api/ingest/location`.

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
