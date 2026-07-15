# HammerTrack — Project Handoff

## What This Is
Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at lower price.
Tracks vehicles (OBD2), heavy equipment (GPS), personnel, small tools (Bluetooth) on a live map.
Owner: Brian Dillard / Dillard Construction Group (Greenville, SC area).

## Live Site (updated Jul 2026 — app moved to Vercel)
- **Live app:** https://hammertrackjune28.vercel.app (Vercel — auto-deploys `master`)
- **Database:** Supabase project **"Hammertrack 2026"** — 9 migrations: 001–005 applied Jul 6 2026, 006–009 pending in SQL Editor (see Pending); env vars set in Vercel (Production + Preview)
- **hammertrackai.com** (Namecheap) still points at the OLD Netlify site (stately-heliotrope-0b2bff) — pending: add domain to the Vercel project
- **Repo:** github.com/briandillardre/hello-world
- **Branch:** master (main working branch — all v2 features merged)
- **Dev branch convention:** `claude/...` branches, open PR → squash merge to master
- **Pilot status:** T1-a live in Brian's Chevy 1500 since Jul 6 2026 (Greenville, SC area) — full pipeline verified: OBD → Hologram → flespi → webhook → Supabase → map

## Tech Stack
- Next.js 14 (App Router, TypeScript)
- Supabase — Postgres + PostGIS, Auth, Realtime (demo mode when env vars absent)
- MapLibre GL JS — open-source map, CARTO free tiles
- Tailwind CSS + shadcn/ui
- Vercel deployment (moved from Netlify Jul 2026; netlify.toml remains for the old site)

## Demo Mode
App works fully with zero env vars — 10 mock assets at a Nashville construction site.
`isMock` flag checks `NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'`.

## Key Files
- `lib/types.ts` — all TypeScript types
- `lib/mock-data.ts` — demo data (Dillard Construction Group)
- `lib/flespi.ts` — normalizes Teltonika + Digital Matter telemetry
- `lib/aemp.ts` / `lib/aemp-client.ts` / `lib/aemp-ingest.ts` — ISO 15143-3 (AEMP 2.0) OEM telematics: parser, Fleet HTTP client + OEM presets, asset-mapping/persistence (see `docs/OEM-TELEMATICS.md`)
- `lib/alerts-engine.ts` — pure alert evaluation (after-hours theft, left-site, etc.)
- `lib/qbo.ts` — QuickBooks Online OAuth2 + invoice generation
- `lib/db/tools.ts` — BLE tool association / location inheritance
- `lib/db/maintenance.ts` — service schedules + overdue tracking
- `app/api/ingest/flespi/route.ts` — flespi webhook (Teltonika/Digital Matter)
- `app/api/ingest/aemp/route.ts` + `app/api/cron/oem-sync/route.ts` — ISO 15143-3 OEM telematics push endpoint + 2-hourly pull cron
- `app/api/ingest/obd2/route.ts` — direct OBD2 ingestion
- `app/api/ingest/location/route.ts` — direct GPS ingestion
- `app/(dashboard)/map/page.tsx` — live map with tool gateway resolution
- `app/demo/page.tsx` — public marketing landing page (theft-hook funnel)
- `app/pricing/page.tsx` — public pricing page (Tenna comparison)
- `marketing/lead-funnel-infographic.html` — GTM funnel infographic
- `marketing/ad-variants.md` — Google Search, dealer, cold email ad copy
- `docs/BUSINESS-PLAN.md` — full operating plan: pricing, phases, hires, cash curve, exit scenarios (update at phase gates)
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
- OEM telematics ingestion — ISO 15143-3 / AEMP 2.0 pull of Komatsu/Link-Belt/Cat/CNH/Bomag/Wirtgen (hours, GPS, fuel, idle, faults) into the same map/timeline/maintenance, no hardware (`docs/OEM-TELEMATICS.md`)
- Pricing page with Tenna comparison
- Demo landing page at /demo (ad funnel landing page)
- PWA (manifest.json)
- Mobile bottom nav with "More" drawer

## Hardware Stack (Decided)
| Role | Device | Notes |
|------|--------|-------|
| Trucks | Teltonika FMM003/FMM00A | OBD2 plug-in, Cat-M1, BLE gateway, $86 (KORE) |
| Equipment | Teltonika TAT141 | Cat-M1, BLE 5.2, IP68, battery, $83 (KORE) |
| Equipment (CAN, Phase 2) | Teltonika FMM650 + CAN adapter | wired 8-32V, J1939 true hours/fuel/faults, $112+$118 (KORE) |
| Tool tags | BlueCharm BC021 / Feasycom / Teltonika BLE | BLE iBeacon, ~$20 (Amazon or KORE) |
| SIM cards | Hologram (pilot) / KORE pooled | Cat-M1; KORE quoted $0.70-1.56/mo (Jul 13, Felix — docs/HARDWARE-PRICING.md, confidential) |

### Live pilot units (T1 = FMM00A OBD units, deployed Jul 2026)
| Unit | IMEI suffix | Hologram SIM | Installed in |
|------|-------------|--------------|--------------|
| T1-a | …02222 | 44398 | **Brian's Chevy 1500 — LIVE since Jul 6 2026** (asset "Chevy 1500 - Brian", tracker_id = full IMEI 868996068802222) |
| T1-b | …00200 | 44406 | (charged in Atlas) |

- flespi channel: `ch1401177.flespi.gw:24397` TCP · Codec 8 Extended · APN `hologram` (no user/pass, roaming on)
- flespi webhook `hammertrack-ingest` (#16402) → POST https://hammertrackjune28.vercel.app/api/ingest/flespi with `x-flespi-token` header (= FLESPI_WEBHOOK_TOKEN in Vercel)
- **Webhook topic GOTCHA (cost a night of debugging):** trigger topic must be `flespi/message/gw/channels/1401177/+` — the last MQTT level is the device IMEI, so a literal `.../message` suffix silently matches nothing. Also verify the webhook's Enabled toggle actually saved.
- Engine-off behavior: device sleeps and checks in ~hourly; ignition-on switches to active tracking (records every few seconds when moving). Zero flespi traffic for an hour with engine off is normal, not a fault.
- Naming convention: T1 = OBD truck unit, T2 = equipment unit, T3 = tool tags. Model numbers stay out of vendor dashboards/marketing.
- FMM00A gotcha: internal battery ships DISCONNECTED — open case, click battery plug in, close case fully (case is the OBD plug housing; won't power open).

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
# ── Alerts delivery (optional; unset = in-app only) ──
TWILIO_ACCOUNT_SID=            # SMS theft alerts
TWILIO_AUTH_TOKEN=
TWILIO_FROM=                   # your Twilio number, E.164
ALERT_SMS_TO=                  # fallback recipient if company alert_phone unset
NOTIFY_WEBHOOK_URL=            # optional: POST every alert to any URL
RESEND_API_KEY=                # optional: emails team invites (free at resend.com; verify hammertrack.ai domain)
EMAIL_FROM=                    # optional sender override, default "HammerTrack <team@hammertrack.ai>"
SUPABASE_DB_URL=               # optional: session-pooler Postgres URI — enables `npm run migrate` (auto-migrations)
CRON_SECRET=                   # optional: locks /api/cron/digest (Vercel cron sends it automatically)
SHARE_LINK_SECRET=             # optional: signs public replay links (unset = derived from service-role key)
WINDY_WEBCAMS_KEY=             # optional: Webcams map layer (free key at api.windy.com/webcams)
NEXT_PUBLIC_TOMTOM_KEY=        # optional: Traffic map layer (free key at developer.tomtom.com, 2.5k tiles/day)
# ── Home weather station (optional; unset = hidden) ──
PWS_PROVIDER=                  # ambient | tempest | wunderground (inferred from keys if unset)
PWS_API_KEY=                   # ambient + wunderground
PWS_APP_KEY=                   # ambient only (application key)
PWS_TOKEN=                     # tempest only
PWS_STATION_ID=                # tempest + wunderground
PWS_MAC=                       # ambient only, optional: pick one of several stations
ANTHROPIC_API_KEY=            # optional: natural-language AI dispatcher (Haiku)
```

## Business Entity (Jul 2026)
- **HAMMERTRACK LLC** — SC single-member LLC, formed Jul 2026; EIN issued Jul 14 2026 (CP 575 G on file with Brian — keep EIN out of the repo)
- Unblocked: Twilio A2P 10DLC (SMS theft alerts), business bank → Stripe billing, Plaid (receipt-chase), D-U-N-S → Apple/Google developer org accounts
- **App wrapper:** Capacitor shell committed (capacitor.config.ts, mobile-shell/, android/, ios/) loading hammertrack.ai remotely — web deploys update the apps instantly. Full checklist + architecture: `docs/APP-STORE-PLAYBOOK.md`

## Pending / Next Steps
1. ~~flespi account + webhook~~ ✅ DONE Jul 6 2026 (see webhook gotcha above)
2. ~~Supabase production~~ ✅ DONE Jul 6 2026 — project "Hammertrack 2026", migrations 001–005 applied. **Run in SQL Editor: 006 (asset-photos bucket), 007 (asset cost columns), 008 (weather default), 009 (alert phone/email), and `supabase/cleanup_demo_data.sql` (removes seeded TN assets/zones — keeps real IMEI trackers).** Fresh installs: paste `supabase/setup.sql` (all 9). See `docs/GO-LIVE.md`.
3. ~~Env vars~~ ✅ DONE — all set in Vercel (Production + Preview) since Jun 28–30
4. **Point hammertrackai.com at Vercel** — add domain in Vercel project settings, update Namecheap DNS (currently still on Netlify)
5. **Remaining hardware** — install T1-b; order TAT141 + solar accessory (equipment), BC021 tool tags
6. **After-hours theft alert live test** — move the truck outside work hours (07:00–17:00) and confirm the alert fires
7. **QuickBooks** — create app at developer.intuit.com, add QBO_ env vars
8. **Solar question** — confirm TAT141 solar accessory availability with Teltonika Americas
9. **hammertrack.ai domain** — buy when business proves out ($185.96/2yr at Namecheap)
10. **Trails/playback timezone** — scrubber clock labels; see `docs/TRACKER-DATA.md` for tracker data reference + per-asset reporting-profile design

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

## Testing rule (Brian, Jul 2026)
Any change touching the timeline, radar, or history data: click through EVERY
time range (Live / Today / Yesterday / 7d / 30d / YTD / All) on BOTH /map and
/command before shipping. Weather layers must obey the scrubber — nothing on
the map may animate on its own while the timeline is stopped (radar loops only
on Live; manual pause wins everywhere).

## Notes
- All HMAC secrets use `hammertrack-*` prefix (previously trackflow-*)
- flespi normalizer handles both Teltonika Codec 8/8E and Digital Matter field conventions
- Tool tracking: tools have no GPS, inherit gateway (truck/equipment) location via tool_associations table
- Timing-safe API auth on all ingest endpoints (createHmac + timingSafeEqual)
