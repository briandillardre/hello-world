# HammerTrack — Project Handoff

## What This Is
Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at lower price.
Tracks vehicles (OBD2), heavy equipment (GPS), personnel, small tools (Bluetooth) on a live map.
Owner: Brian Dillard / Dillard Construction Group (Nashville, TN area).

## Live Site
- **URL:** https://hammertrackai.com
- **Host:** Netlify (project: stately-heliotrope-0b2bff)
- **Repo:** github.com/briandillardre/hello-world
- **Branch:** master (main working branch — all v2 features merged)
- **Dev branch convention:** `claude/...` branches, open PR → squash merge to master

## Tech Stack
- Next.js 14 (App Router, TypeScript)
- Supabase — Postgres + PostGIS, Auth, Realtime (demo mode when env vars absent)
- MapLibre GL JS — open-source map, CARTO free tiles
- Tailwind CSS + shadcn/ui
- Netlify deployment (netlify.toml + @netlify/plugin-nextjs)

## Demo Mode
App works fully with zero env vars — 10 mock assets at a Nashville construction site.
`isMock` flag checks `NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'`.

## Key Files
- `lib/types.ts` — all TypeScript types
- `lib/mock-data.ts` — demo data (Dillard Construction Group)
- `lib/flespi.ts` — normalizes Teltonika + Digital Matter telemetry
- `lib/alerts-engine.ts` — pure alert evaluation (after-hours theft, left-site, etc.)
- `lib/qbo.ts` — QuickBooks Online OAuth2 + invoice generation
- `lib/db/tools.ts` — BLE tool association / location inheritance
- `lib/db/maintenance.ts` — service schedules + overdue tracking
- `app/api/ingest/flespi/route.ts` — flespi webhook (Teltonika/Digital Matter)
- `app/api/ingest/obd2/route.ts` — direct OBD2 ingestion
- `app/api/ingest/location/route.ts` — direct GPS ingestion
- `app/(dashboard)/map/page.tsx` — live map with tool gateway resolution
- `app/demo/page.tsx` — public marketing landing page (theft-hook funnel)
- `app/pricing/page.tsx` — public pricing page (Tenna comparison)
- `marketing/lead-funnel-infographic.html` — GTM funnel infographic
- `marketing/ad-variants.md` — Google Search, dealer, cold email ad copy
- `supabase/migrations/001_initial.sql` — full schema with PostGIS + RLS
- `supabase/migrations/002_v2.sql` — tool_associations, maintenance, QBO tables

## Features Built
- Live map with clustering (MapLibre GL JS)
- BLE tool tracking — tools inherit location of truck/equipment that detects them
- Geofences (draw on map) + alerts engine
- After-hours theft alerts + left-site alerts (red "THEFT ALERT" styling)
- Maintenance schedules (engine hours / mileage / days) + service history
- Utilization reports (engine hours, idle %, miles, hours per job site)
- QuickBooks Online integration (OAuth2, asset sync, job-cost invoices, expenses)
- flespi connector — Teltonika FMM series + Digital Matter normalized to same schema
- Pricing page with Tenna comparison
- Demo landing page at /demo (ad funnel landing page)
- PWA (manifest.json)
- Mobile bottom nav with "More" drawer

## Hardware Stack (Decided)
| Role | Device | Notes |
|------|--------|-------|
| Trucks | Teltonika FMM003 | OBD2 plug-in, Cat-M1, BLE 4.0 gateway |
| Equipment | Teltonika TAT141 | Cat-M1, BLE 5.2, IP68, Li-SOCl2 battery |
| Tool tags | BlueCharm BC021 | BLE iBeacon, IP67, $20, Amazon Prime |
| SIM cards | Hologram (hologram.io) | nano SIM, Cat-M1, ~$1-2/mo per device |

### TAT141 Battery Note
At active tracking rates (5-min intervals when moving), battery alone is insufficient.
**Need solar accessory** for equipment left outside, or wire to 12V/24V aux on machines that have it.
Ask Teltonika Americas for TAT141 solar charging accessory.

### CAN Bus — Phase 2
Start with GPS/battery. Add J1939 CAN readers on high-value machines later for:
true engine hours, fuel consumption, fault codes, accurate utilization billing.

## Domain & DNS
- **Primary domain:** hammertrackai.com (Namecheap)
- **Also owned:** hammertracks.com, hammertrax.com (redirect to primary)
- **Deferred:** hammertrack.ai ($185.96 for 2yr min — buy when business is proven)
- DNS: A record @ → 75.2.60.5, CNAME www → stately-heliotrope-0b2bff.netlify.app
- SSL: Let's Encrypt via Netlify, auto-renews Aug 27

## Env Vars Needed for Production
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPTILER_KEY=       # optional, falls back to CARTO free tiles
FLESPI_WEBHOOK_TOKEN=           # from flespi stream config (ingest fails closed without it)
INGEST_API_KEY=                 # x-api-key for /api/ingest/obd2 + location (random secret; NOT the service-role key)
QBO_CLIENT_ID=                  # from developer.intuit.com
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=https://hammertrackai.com/api/qbo/callback
QBO_ENVIRONMENT=production
```

## Pending / Next Steps
1. **Hardware order** — FMM003 (trucks), TAT141 + solar accessory (equipment), BC021 (tools), Hologram SIMs
2. **flespi account** — flespi.com, add device IMEIs, create webhook stream → hammertrackai.com/api/ingest/flespi
3. **Supabase production** — create project, run 001_initial.sql then 002_v2.sql
4. **Add Netlify env vars** — paste Supabase keys into Netlify dashboard
5. **QuickBooks** — create app at developer.intuit.com, add QBO_ env vars
6. **Solar question** — confirm TAT141 solar accessory availability with Teltonika Americas
7. **hammertrack.ai domain** — buy when business proves out ($185.96/2yr at Namecheap)

## Go-to-Market
- Lead funnel: FB/IG theft-hook ad → hammertrackai.com/demo → /register
- Primary hook: after-hours theft alert ("Your excavator left at 2 AM")
- Price position: $3-8/asset/mo vs Tenna $15-25/asset/mo + $500 setup
- Beachhead: Nashville metro, local contractor Facebook groups + equipment dealer referrals
- Ad variants ready in marketing/ad-variants.md

## Competitors
- Tenna: $15-25/asset + $500 setup, enterprise, no Bluetooth tools, no QuickBooks
- Samsara: $20-40, built for trucking, overkill for GCs
- Verizon Connect: $20-35, sticky contracts, dated UX
- GPS Trackit: $15-25, vehicle-centric, weak on tools/equipment

## Notes
- All HMAC secrets use `hammertrack-*` prefix (previously trackflow-*)
- flespi normalizer handles both Teltonika Codec 8/8E and Digital Matter field conventions
- Tool tracking: tools have no GPS, inherit gateway (truck/equipment) location via tool_associations table
- Timing-safe API auth on all ingest endpoints (createHmac + timingSafeEqual)
