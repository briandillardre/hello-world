# HammerTrack — Project Handoff

## What This Is
Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at lower price.
Tracks vehicles (OBD2), heavy equipment (GPS), personnel, small tools (Bluetooth) on a live map.
Owner: Brian Dillard / Dillard Construction Group (Greenville, SC area).

## Live Site (updated Jul 2026 — app moved to Vercel)
- **Live app:** https://hammertrack.ai (Vercel — auto-deploys `master`; hammertrackjune28.vercel.app is the same deployment)
- **Database:** Supabase project **"Hammertrack 2026"** — 9 migrations: 001–005 applied Jul 6 2026, 006–009 pending in SQL Editor (see Pending); env vars set in Vercel (Production + Preview)
- **hammertrack.ai** DNS cutover ✅ DONE Aug 5 2026 — apex + www on Vercel (Valid Configuration), hammertrackai.com 301s to it, Google Workspace MX (smtp.google.com) verified intact post-cutover
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
App works fully with zero env vars — 10 mock assets mirroring the DCG fleet
(Chevy 1500, RAM 3500 Dump, Peterbilt 567, Link-Belt 130X2, Sakai SW990,
Takeuchi TB235…) staged WEST of the river on the Nashville grid. Vehicles/
equipment follow hand-authored waypoint loops (`MOCK_PATHS` in lib/mock-data.ts
— edit there to change the demo story; no more random walks across water).
Black 'Property Boundary' zone rings the stage. /live shows the real product
sidebar (locked rows → /register). `isMock` flag checks
`NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'`.

## Pricing sync rule (Brian, Aug 5)
Any change to tiers, founding-25 terms, or the pilot offer updates ALL of:
/pricing, the splash ladder + hero microcopy, docs/PRICING-TIERS.md — in the
SAME commit. Run tier platform price stays UNPUBLISHED ("talk to us").

## Splash truth rule (Brian, Aug 5)
Nothing on the splash/marketing pages may depict or claim functionality that
doesn't exist. Mocked product screens are banned (the CSS "console" is gone —
RealCinema + /live are the real thing). Roadmap items must be labeled ROADMAP;
shipped items may say LIVE. Every session that ships or re-scopes a feature
re-audits the splash claims in the same commit.

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
- Live map with clustering (MapLibre GL JS) — Google-Maps parity: double-tap-hold one-finger zoom, Navigate/Street View/share-pin handoffs on asset+zone panels, imperial scale bar, tap-a-parcel owner/address/acreage from free county ArcGIS data (`NEXT_PUBLIC_PARCEL_SERVICE_URL`). Future (tasks 161–166): KMZ/shapefile import, map markup, offline areas, drive-time ETA, long-press pin, county auto-discovery + owner search
- BLE tool tracking — tools inherit location of truck/equipment that detects them
- Geofences (draw on map) + alerts engine — kinds: site, boundary, yard, vendor (supply houses: deterministic stop names, never job time, receipt handshake — migration 051 pre-fills the capture page's job from the truck's vendor visit + last site)
- After-hours theft alerts + left-site alerts (red "THEFT ALERT" styling)
- Maintenance schedules (engine hours / mileage / days) + service history
- Work orders (migration 050) — auto-opened from overdue schedules with the machine's live reading, assign/status/priority/due, parts+labor costs, complete → service record + schedule clock reset. Fault-code → WO wiring is the recorded next step
- Utilization reports (engine hours, idle %, miles, hours per job site)
- Driver safety grades (A–F per vehicle on /reports) from the speed stream — sustained 70+/80+ share, top-speed spikes, night driving; feeds "Worth a look" flags. Zone speeding alerts separate (043). Harsh accel/brake needs Teltonika Green Driving IO enabled — recorded next step
- QuickBooks Online integration (OAuth2, asset sync, job-cost invoices, expenses)
- flespi connector — Teltonika FMM series + Digital Matter normalized to same schema
- OEM telematics ingestion — ISO 15143-3 / AEMP 2.0 pull of Komatsu/Link-Belt/Cat/CNH/Bomag/Wirtgen (hours, GPS, fuel, idle, faults) into the same map/timeline/maintenance, no hardware (`docs/OEM-TELEMATICS.md`)
- Instant receipt chase — card-alert email forwarding (Chase/CapOne/Amex parsers) → expense within seconds of the swipe → push to the mapped cardholder → magic capture link /r/{token} (camera, no login) → nag ladder (+1 h, +4 h, nightly) — migration 045, `docs/RECEIPT-CHASE.md`
- Project Hub per zone — punch list (assignee/due/priority), milestones with schedule strip, budget vs tracked actuals — migration 046, `docs/PROJECT-MANAGEMENT.md` (competitor deep dive + scope-by-client-size)
- Zone imagery timeline + map overlays (migrations 052–053) — dated drone/site photos per zone with a date slider on the zone page (Brian's Mavic Air 2 flies daily); evidence locker for closeout/pay apps. "Place on map" pins a shot to ground corners (pan/size/rotate against satellite base) → latest placed shot per zone renders on /map under the Site imagery layer toggle. Next: SkyFi order button; **HammerTrack Aerial** (task #169) = wrap OpenDroneMap as our own processor — zone-page flight upload → self-hosted NodeODM worker → georeferenced ortho auto-places itself + DSM → in-app 3D view → dated-flight differencing = "X yd³ moved" ($10–25/flight vs DroneDeploy $329/mo; gate = Brian's manual WebODM trial of the first Creekside grid; Mavic Air 2 has no DJI Fly waypoints — Dronelink/Litchi for automated grids)
- Weekly owner digests — Friday wrap-up (email/SMS) + Sunday week-ahead email, per-company day/hour/channel/tz editable in Settings → Weekly summaries — migration 047, hourly Fri/Sat/Sun cron `/api/cron/weekly`
- Daily morning site briefing (ForeFlight-style) — workday mornings (default 6 AM local): today's weather at each active site (Open-Meteo, keyless), yesterday's tracked hours/cost + who was there per zone, punch items due today, milestones this week, silent hardware trackers, overdue service, open WOs. Settings → Weekly summaries row; migration 054 stamp, hourly cron `/api/cron/briefing`, `lib/briefing.ts`
- Financials page (/finance, cost-permission gated) — LY/YTD revenue, revenue/employee + net margin vs trade benchmark bands (17 trades incl. trucking/ag/rental/field services), 3-method valuation (income=SDE×multiple, market=revenue comps, asset=fleet+assets−debt) with blended range. Owner types a plain-English company description → AI (Haiku) classifies the benchmark trade, keyword fallback without a key — migration 048, `lib/valuation.ts` (Growth Platform layer 1 v1; QBO auto-fill later)
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
| SIM cards | Hologram (pilot T1-a/b) / KORE **SuperSIM** (Aug 2026 order) | Multi-carrier triple-punch (2FF/3FF/4FF); KORE quoted $0.70-1.56/mo (Jul 13, Felix — docs/HARDWARE-PRICING.md, confidential). ⚠ SuperSIM APN/config ≠ Hologram — confirm settings with Matt before the 13 new SIMs arrive |

### KORE order #1 (signed via DocuSign, PAID $1,818 Aug 5 2026 — in fulfillment)
5× FMM00A ($86) · 6× TAT141 ($83) · 2× FMM650 ($112) · 2× ALL-CAN300 ($118) · 10× Eye Beacon BLE ($20) · 13× SuperSIM. Connectivity agreement still pending in KORE's system. **Matt confirmed KORE will PRE-CONFIGURE devices before shipping** (SIMs enabled+tested, connectivity verified, plug-and-play) — the zero-touch provisioning ask is agreed in principle; supply them our flespi config profile. Contacts: Matt Ferrans (Channel Partner Relationship Director, runs point; 470-237-4658, mferrans@korewireless.com, team OEM@korewireless.com) · Felix Alfaro OOO until Aug 10 · Billy Stalder, Teltonika Regional Mgr Telematics, 682-480-3782. KORE Console account created (login = brian@dillardconstructiongroup.com; port to brian@hammertrack.ai requested — KORE must change it server-side).

### White-label (Teltonika, Billy — Aug 4 2026)
Possible at **200-unit MOQ**; first run +2–3 weeks lead, then ~4 weeks per run. The gray regulatory text on the device top CANNOT change (else recertification ≈ $10k + months). Options sheet attached to Billy's Aug 4 email. Decision deferred to Founding-25 scale.

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
- **PRIMARY domain: hammertrack.ai** — OWNED, and running **Google Workspace**
  (brian@hammertrack.ai, "Managed by hammertrack.ai", confirmed Jul 30 2026).
  This is the real front door: `BRAND_DOMAIN` in `lib/brand.ts`, the Capacitor
  app's remote URL, and the Resend sender all resolve here.
- **Secondary:** hammertrackai.com — ✅ 301 → hammertrack.ai via Vercel
  (Aug 5 2026). Also owned: hammertracks.com, hammertrax.com.
- **Public addresses** (sales@ / hello@ / support@ @hammertrack.ai) must exist
  as Workspace aliases or groups — the code points at them either way.
- Old Netlify site (stately-heliotrope-0b2bff) is dead; ignore it.

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
QBO_REDIRECT_URI=https://hammertrack.ai/api/qbo/callback
QBO_ENVIRONMENT=production
# ── Alerts delivery (optional; unset = in-app only) ──
TWILIO_ACCOUNT_SID=            # SMS theft alerts
TWILIO_AUTH_TOKEN=
TWILIO_FROM=+18883739004       # toll-free alert sender, bought Jul 30 2026 (Voice enabled, no greeting yet)
ALERT_SMS_TO=                  # fallback recipient if company alert_phone unset
NOTIFY_WEBHOOK_URL=            # optional: POST every alert to any URL
FCM_SERVER_KEY=               # optional: native push to the phone lock screen (Firebase → Cloud Messaging). Devices self-register via the Capacitor app → /api/push/register (migration 029). Unset = no push.
RESEND_API_KEY=                # optional: emails team invites (free at resend.com; verify hammertrack.ai domain)
RESEND_INBOUND_SECRET=         # optional: whsec_… signing secret for the Resend inbound webhook → /api/inbound/receipts (instant receipt chase; fails closed unset)
EMAIL_FROM=                    # optional sender override, default "HammerTrack <team@hammertrack.ai>"
SUPABASE_DB_URL=               # optional: session-pooler Postgres URI — enables `npm run migrate` (auto-migrations)
CRON_SECRET=                   # optional: locks /api/cron/digest (Vercel cron sends it automatically)
# ── Stripe subscription billing (optional; unset = billing card says so, nothing throws) ──
STRIPE_SECRET_KEY=             # sk_live_… (sk_test_… against test mode)
STRIPE_WEBHOOK_SECRET=         # whsec_… from the /api/stripe/webhook endpoint in Stripe
STRIPE_PRICE_MACHINE=          # price_… recurring $6/mo, "Tracked machine"
STRIPE_PRICE_TAG=              # price_… recurring $3/mo, "Tool tag"
SHARE_LINK_SECRET=             # optional: signs public replay links (unset = derived from service-role key)
WINDY_WEBCAMS_KEY=             # optional: Webcams map layer (free key at api.windy.com/webcams)
NEXT_PUBLIC_TOMTOM_KEY=        # optional: Traffic map layer (free key at developer.tomtom.com, 2.5k tiles/day)
NEXT_PUBLIC_PARCEL_SERVICE_URL= # optional: county ArcGIS parcel layer URL (…/MapServer/<n>); enables Parcel lines + tap-for-owner. Greenville SC: gcgis.org ArcGIS REST directory
# ── Home weather station (optional; unset = hidden) ──
PWS_PROVIDER=                  # ambient | tempest | wunderground (inferred from keys if unset)
PWS_API_KEY=                   # ambient + wunderground
PWS_APP_KEY=                   # ambient only (application key)
PWS_TOKEN=                     # tempest only
PWS_STATION_ID=                # tempest + wunderground
PWS_MAC=                       # ambient only, optional: pick one of several stations
ANTHROPIC_API_KEY=            # optional: natural-language AI dispatcher (Haiku)
# ── Plaid bank/card auto-import for missing-receipts (optional; unset = CSV paste only) ──
PLAID_CLIENT_ID=             # from dashboard.plaid.com
PLAID_SECRET=                # per-environment secret
PLAID_ENV=                   # sandbox | development | production (default sandbox)
PLAID_WEBHOOK_URL=           # optional: /api/... for SYNC_UPDATES_AVAILABLE
```

## Business Entity (Jul 2026)
- **HAMMERTRACK LLC** — SC single-member LLC, formed Jul 2026; EIN issued Jul 14 2026. CP 575 G confirmation PDF is on Brian's phone (Downloads) — **keep the EIN itself out of the repo**. The IRS issues that PDF once and never again; a lost copy means a 147C call.
- Unblocked: Twilio A2P 10DLC (SMS theft alerts), business bank → Stripe billing, Plaid (receipt-chase), D-U-N-S → Apple/Google developer org accounts
- **App wrapper:** Capacitor shell committed (capacitor.config.ts, mobile-shell/, android/, ios/) loading hammertrack.ai remotely — web deploys update the apps instantly. Full checklist + architecture: `docs/APP-STORE-PLAYBOOK.md`

### Vendor accounts (status Jul 30 2026)
| Account | State | Notes |
|---|---|---|
| **Twilio** | toll-free **+1 888 373 9004** bought; compliance profile **approved**; Toll-Free Verification **In Review** | Use case Security Alert + Account Notifications, 100 msg/mo. Opt-in proof = https://hammertrack.ai/sms + the consent checkbox on Settings → Company. Verdict emails brian@hammertrack.ai. Voice is enabled and needs no registration, but has **no greeting** — don't publish the number until it does (inbound toll-free minutes are billed to us). |
| **Mercury** | **APPROVED — live Aug 5 2026**; vendor migration underway (KORE first, via per-vendor virtual cards on the IO) | Partner bank Column N.A. $3,000 first deposit = **owner capital contribution, not income**. IO card issued. Rule: one named virtual card per vendor, limit set per vendor. No cash deposits ever; paper checks go to a mail-in lockbox. |
| **Supabase** | Pro; billing entity **HAMMERTRACK LLC**, EIN on file | |
| **Google Workspace** | live on hammertrack.ai | sales@ / hello@ / support@ all verified receiving (Jul 30) |
| **D-U-N-S** | refiled, awaiting number | Gates Apple + Google **organization** developer accounts. D&B does not require an EIN — the thing that must match Apple's enrollment exactly is legal name + address. Verify the record when the number lands; never file a third time (duplicate records are slow to merge). |

## Pending / Next Steps
1. ~~flespi account + webhook~~ ✅ DONE Jul 6 2026 (see webhook gotcha above)
2. ~~Supabase production~~ ✅ DONE Jul 6 2026 — project "Hammertrack 2026", migrations 001–005 applied. **Run in SQL Editor: 006 (asset-photos bucket), 007 (asset cost columns), 008 (weather default), 009 (alert phone/email), and `supabase/cleanup_demo_data.sql` (removes seeded TN assets/zones — keeps real IMEI trackers).** Fresh installs: paste `supabase/setup.sql` (all 9). See `docs/GO-LIVE.md`.
3. ~~Env vars~~ ✅ DONE — all set in Vercel (Production + Preview) since Jun 28–30
4. ~~Point hammertrack.ai at Vercel~~ ✅ DONE Aug 5 2026 (task 173) — apex A → Vercel (216.150.1.1 is Vercel's current anycast IP), www CNAME → cname.vercel-dns.com, hammertrackai.com 301 → hammertrack.ai, Workspace MX intact. Unblocks final QBO_REDIRECT_URI + app-store remote URL. Follow-up: set Supabase Auth → URL Configuration Site URL to https://hammertrack.ai (else auth emails/redirects still point at vercel.app).
5. **Remaining hardware** — ~~install T1-b~~ ✅ reporting since Aug 4 (…00200); finish pucks (task 160: Minors 3+5 configured, tool assets created; last puck = Minor 4); KORE order #1 in fulfillment (see Hardware section) — on arrival: SuperSIM APN settings ≠ Hologram (task 171)
6. ~~After-hours theft alert live test~~ ✅ verified in production Aug 4–5 — real after-hours alerts fired on the RAM 3500 (phone tracker) at 6:33 AM/7:01 PM
7. **QuickBooks** — create app at developer.intuit.com, add QBO_ env vars
8. **Solar question** — confirm TAT141 solar accessory availability with Teltonika Americas
9. ~~hammertrack.ai domain~~ ✅ OWNED + Google Workspace live (confirmed Jul 30 2026)
10. **Trails/playback timezone** — scrubber clock labels; see `docs/TRACKER-DATA.md` for tracker data reference + per-asset reporting-profile design
11. **Move ALL vendor payments to Mercury + the Mercury IO credit card** once the account is approved — Vercel, Supabase, Twilio, Hologram, Google Workspace, Namecheap, Resend, KORE, Anthropic, MapTiler/TomTom/Windy keys. Nothing stays on Brian's personal cards (clean books; the $3,000 opening deposit is owner capital contribution, not income).
12. ~~Real-time receipt chase via card-alert email forwarding~~ ✅ BUILT Aug 1 2026 (migration 045, `/api/inbound/receipts`, `/r/{token}`, nag ladder). Plaid SKIPPED ($1,000/mo quoted Aug 1; declined — sandbox-only unless a non-QBO customer demands it, then pay-as-you-go only). **Brian to activate:** (a) Resend dashboard → enable inbound email on hammertrack.ai → point webhook at `https://hammertrackjune28.vercel.app/api/inbound/receipts` → copy the `whsec_…` signing secret into Vercel as `RESEND_INBOUND_SECRET` + redeploy; (b) on /receipts hit Enable, add card last-4 → cardholder mappings; (c) turn on Chase/CapOne per-transaction email alerts (threshold $0) pointed at the inbound address; (d) swipe a card and confirm the push + /r capture round-trip.
13. **PM competitive build-out** — tiers, COI tracking, T&M tickets, closeout binder, full Procore-parity map: `docs/PROJECT-MANAGEMENT.md` → "Competitive roadmap". Next up when Brian calls it: Tier 1 money loop (estimates → e-sign proposals → change orders → pay apps).
14. **The $100M → $1B path** — staged plan (Founding 25 → $1M ARR → $10M ≈ $100M valuation → $100M ARR ≈ $1B): channels, gates, kill-risks, funding decision points: `docs/PATH-TO-1B.md`
15. **Growth Platform (the endgame)** — Ramp-style card + spend, partner-first lending, live company valuation + exit suite, benchmarks, insurance arm (discount referrals → embedded agency → maybe MGA; never carry risk), AI "what lever next" advisor (hires/equipment/office/geography/protect): `docs/GROWTH-PLATFORM.md`. Supersedes the old "financing = never" note. Order: charts/benchmarks → valuation card → HammerTrack Card → referral lending → insurance referrals. Gated on PM Tier 1 + Founding-25 + Mercury/Stripe live.

## Go-to-Market
- Lead funnel: FB/IG theft-hook ad → hammertrack.ai/demo → /register
- Primary hook: after-hours theft alert ("Your excavator left at 2 AM")
- Price position: $3-8/asset/mo vs Tenna $15-25/asset/mo + $500 setup
- Beachhead: Nashville metro, local contractor Facebook groups + equipment dealer referrals
- Ad variants ready in marketing/ad-variants.md

## Competitors
- Tenna: $15-25/asset + $500 setup, enterprise, no Bluetooth tools, no QuickBooks
- Samsara: $20-40, built for trucking, overkill for GCs
- Verizon Connect: $20-35, sticky contracts, dated UX
- GPS Trackit: $15-25, vehicle-centric, weak on tools/equipment

## Sync rule (Brian, Aug 1 2026)
Any change to the roadmap, to-do list, future/idea items, or cost picture —
adding, building, declining, or re-scoping — must update the graphical views
in the SAME commit:
- `marketing/system-map.html` (the system-map infographic: built/in-progress/
  grayed states, per-piece costs, the Growth Platform section) + republish the
  Claude artifact so Brian's link stays current
- the cost/growth metrics docs it draws from (`docs/COST-SCALE-2026-07.md`,
  `docs/OPERATING-MODEL.md`) whenever a decision changes a dollar figure
The infographic is a rendered view of the roadmap — never let them drift.

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
