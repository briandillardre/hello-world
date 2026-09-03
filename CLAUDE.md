# HammerTrack — Project Handoff

## What This Is
Mobile-first asset tracking SaaS for construction companies. Competes with Tenna at lower price.
Tracks vehicles (OBD2), heavy equipment (GPS), personnel, small tools (Bluetooth) on a live map.
Owner: Brian Dillard / Dillard Construction Group (Greenville, SC area).

## Live Site (updated Jul 2026 — app moved to Vercel)
- **Live app:** https://hammertrack.ai (Vercel — auto-deploys `master`; hammertrackjune28.vercel.app is the same deployment)
- **Database:** Supabase project **"Hammertrack 2026"** — **AUTO-MIGRATIONS ARE LIVE**: `SUPABASE_DB_URL` is set in Vercel (Brian confirmed Aug 18) and every `master` build ends with `scripts/migrate.mjs`, so pushing a `supabase/migrations/NNN_*.sql` file IS the migration — never tell Brian to paste SQL into the SQL Editor again. **A migration file is FROZEN the moment ANY push carries it** (Aug 28 burn): PREVIEW builds run migrate against the SAME production DB, so a branch push applies the file as-it-is-then and later edits to it are silently skipped everywhere (migrate tracks by filename). Fix-ups always go in a NEW migration file (see 081). Verify state anytime: Vercel latest build log (migrate step lists applied files) or `select filename from schema_migrations order by filename desc limit 10;`. A failing migration fails the whole build, so a green deploy = schema applied.
- **hammertrack.ai** DNS cutover ✅ DONE Aug 5 2026 — apex + www on Vercel (Valid Configuration), hammertrackai.com 301s to it, Google Workspace MX (smtp.google.com) verified intact post-cutover
- **Repo:** github.com/briandillardre/hello-world
- **Branch:** master (main working branch — all v2 features merged)
- **Dev branch convention:** `claude/...` branches, open PR → squash merge to master
- **Ship-to-live rule (Brian, Aug 26):** once a session's work is validated (production build green + the reviewer agents have run), open the PR and squash-merge it to master YOURSELF — do not ask first. Live on hammertrack.ai is where Brian reviews. Never merge unvalidated work; the checks & balances rule still gates every merge.
- **Pilot status:** T1-a live in Brian's Chevy 1500 since Jul 6 2026 (Greenville, SC area) — full pipeline verified: OBD → Hologram → flespi → webhook → Supabase → map

## Tech Stack
- Next.js 14 (App Router, TypeScript)
- Supabase — Postgres + PostGIS, Auth, Realtime (demo mode when env vars absent)
- MapLibre GL JS — open-source map; basemaps via `cartoTiles()` in lib/map-layers.ts: Esri keyless canvas rasters by default (Sep 2 2026, after CARTO began stamping unkeyed tiles), CARTO retina tiles when NEXT_PUBLIC_CARTO_KEY is set
- Tailwind CSS + shadcn/ui
- Vercel deployment (moved from Netlify Jul 2026; netlify.toml remains for the old site)

## Demo Mode
App works fully with zero env vars — 10 mock assets mirroring the DCG fleet
(Chevy 1500, RAM 3500 Dump, Peterbilt 567, Link-Belt 130X2, Sakai SW990,
Takeuchi TB235…) staged WEST of the river on the Nashville grid. REALISM
REBUILD (Aug 23 — Brian: "I really hate this demo screen"): trucks share ONE
road artery (yard → sites → 'Palmetto Aggregates — Pit 4' vendor/quarry zone)
so overlapping trails read as roads; `MOCK_PATHS` waypoints carry optional
per-segment mph (feeds HUD + speed-colored trails); generateTracks Chaikin-
rounds corners + adds GPS jitter; zones are irregular freehand-looking
polygons, never axis-aligned rectangles; machines run skewed grading/dig
passes inside their site. Edit `MOCK_PATHS`/`MOCK_GEOFENCES` in
lib/mock-data.ts to change the story — index 0 of each path must equal the
asset's live position. Black 'Property Boundary' zone rings the stage. /live
shows the real product sidebar (locked rows → /register). `isMock` flag
checks `NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'`.
Live public feeds (ADS-B planes, transit GTFS) were considered and declined
for the front door: wrong story for a construction fleet + a third-party
outage would break the demo; revisit only as a labeled extras layer.
SHOWROOM COMPANY (Aug 23): a real production company driven by
`/api/cron/simulator` through the real flespi ingest (alerts/sessions/tools
all production paths); Brian logs in and reshapes zones, trucks re-route on
real roads via OSRM. Seed from /model (founder-gated). `docs/SHOWROOM.md`.

## Communication rule (Brian, Sep 2 2026)
"I am busy and a human — keep the responses short and sweet." Every message
to Brian: lead with whether he needs to do anything (yes/no), then short
numbered lists or bullets, one line each. No long paragraphs, no narration of
work in progress, no restating what shipped. Detail lives on /board and in
PR descriptions — link, don't paste.

## Pricing sync rule (Brian, Aug 5; /demo added Aug 17)
Any change to tiers, founding-25 terms, or the pilot offer updates ALL of:
/pricing, the splash ladder + hero microcopy, **/demo's Founding-25 card**,
**the /help/billing guide (app/(dashboard)/help/guides.tsx)**,
docs/PRICING-TIERS.md — in the SAME commit. (/demo drifted to a dead $99-flat
offer for 12 days because it wasn't on this list.) Run tier platform price
stays UNPUBLISHED ("talk to us") — and never publish a typical-customer Run
TOTAL either; the fee leaks by arithmetic. The standard discount claim on
every surface is "about half the price of Tenna, $0 setup" — no other
percentages or per-asset teaser numbers in ads or pages.

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
- `tools/foreclosures/` — Brian's SIDE TOOL (not HammerTrack product): SC Master-in-Equity foreclosure crawler (Greenville/Pickens/Spartanburg/Oconee + coastal stubs) — sale lists → Notice of Sale → Order/Form 4 judgment $ → property card → report. Runs on Brian's PC (court index/qPublic block cloud IPs). `tools/foreclosures/README.md`
- `supabase/migrations/001_initial.sql` — full schema with PostGIS + RLS
- `supabase/migrations/002_v2.sql` — tool_associations, maintenance, QBO tables
- `supabase/migrations/077_trail_daily.sql` + `078_trail_perf.sql` — pre-rolled daily map trails (the 500-device scale fix, Aug 25): see Features Built
- `lib/trails.ts` — track building, speed-class colors, per-horizon tick ladders (`tickMarks`), `mergeHistoryRows` dedupe
- `lib/insights.ts` — the insights engine: daily metrics spine + trend detectors + anti-cry-wolf suppression (migration 079, nightly `/api/cron/insights` + lazy first-run in `/api/insights`)
- `lib/memo.ts` — the monthly owner memo (Growth Platform "what lever next" advisor): computed facts → Opus-composed 3-paragraph read (migration 080, monthly `/api/cron/memo` + lazy `/api/memo`, card on /finance)
- `lib/heat3d.ts` — 3D activity-terrain hex binning (hours/$ hills)

## Features Built
- Live map with clustering (MapLibre GL JS) — Google-Maps parity: double-tap-hold one-finger zoom, Navigate/Street View/share-pin handoffs on asset+zone panels, imperial scale bar, tap-a-parcel owner/address/acreage from free county ArcGIS data (`NEXT_PUBLIC_PARCEL_SERVICE_URL`). Future (tasks 161–166): KMZ/shapefile import, map markup, offline areas, drive-time ETA, long-press pin, county auto-discovery + owner search
- **Map wow-pack (Aug 12 — "where is my money and my day"):** Burn Map (site zones shade green→red vs 046 budget, live $-today chips off the 056 ledger, `/api/zone-burn`, cost-permission gated, live-only per timeline truth) · Idle $ rings (parked machines ring red with idleDays × daily_cost) · wrench badges (🛠 on markers with overdue service/open WOs, always on) · Night Watch (teal 🔒 sleeping in a yard/site/boundary vs amber ⚠ out in the open) · find-my-tool custody trail (map tool sheet shows 30d carrier history, `/api/tool-custody`) · SCDOT road closures layer (`/api/road-closures`, 511sc→SCDOT-ArcGIS→WZDx fallback chain, ?diag in 503s) · Pour planner (per-site next-bad-day chips: rain ≥60% / gusts ≥25 / ≤35°F, `/api/zone-pourcast`, Open-Meteo) · Flyover briefing cards (site zones join the flyover route; dwell shows name + $-today + next bad pour day). Plan-vs-reality = heatmap over Scaled Plans (ordering already correct). Deferred tier 2 (task #15): Bid Ghost, Storm $ ledger, vendor money map, Then/Now split. NOTE: map-data assets now carry maintOverdue/openWorkOrders/idleDays (additive)
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
- Zone imagery timeline + map overlays (migrations 052–055) — dated drone/site photos per zone with a date slider on the zone page (Brian's Mavic Air 2 flies daily); evidence locker for closeout/pay apps. "Place on map" pins a shot to ground corners (pan/size/rotate against satellite base). The map's Site imagery layer is TIMELINE-AWARE: scrubbing shows each zone's newest placed shot as of that day, Live = newest (daily flights = automatic site playback). Uploads pick "90° top-down drone" (auto pre-placed from DJI EXIF/XMP GPS+yaw+altitude via `lib/drone-meta.ts`, exifr) vs "site photo" (timeline-only). Scaled Plans (055): PDF sheets rasterized client-side (pdf.js served from public/pdfjs — webpack must never bundle it), placed with the same tool, ONE map_active sheet per zone (radio) rendered under the Scaled plans layer toggle. Big files upload direct-to-storage via signed URLs (50 MB cap — Vercel's ~4.5 MB action body cap never sees them). Next: SkyFi order button; **HammerTrack Aerial** (task #169) = wrap OpenDroneMap as our own processor — zone-page flight upload → self-hosted NodeODM worker → georeferenced ortho auto-places itself + DSM → in-app 3D view → dated-flight differencing = "X yd³ moved" ($10–25/flight vs DroneDeploy $329/mo; gate = Brian's manual WebODM trial of the first Creekside grid; Mavic Air 2 has no DJI Fly waypoints — Dronelink/Litchi for automated grids)
- Weekly owner digests — Friday wrap-up (email/SMS) + Sunday week-ahead email, per-company day/hour/channel/tz editable in Settings → Weekly summaries — migration 047, hourly Fri/Sat/Sun cron `/api/cron/weekly`
- Daily morning site briefing (ForeFlight-style) — workday mornings (default 6 AM local): today's weather at each active site (Open-Meteo, keyless), yesterday's tracked hours/cost + who was there per zone, punch items due today, milestones this week, silent hardware trackers, overdue service, open WOs. Settings → Weekly summaries row; migration 054 stamp, hourly cron `/api/cron/briefing`, `lib/briefing.ts`
- Financials page (/finance, cost-permission gated) — LY/YTD revenue, revenue/employee + net margin vs trade benchmark bands (17 trades incl. trucking/ag/rental/field services), 3-method valuation (income=SDE×multiple, market=revenue comps, asset=fleet+assets−debt) with blended range. Owner types a plain-English company description → AI (Haiku) classifies the benchmark trade, keyword fallback without a key — migration 048, `lib/valuation.ts` (Growth Platform layer 1 v1; QBO auto-fill later)
- Pricing page with Tenna comparison
- Demo landing page at /demo (ad funnel landing page)
- **Aug 22 wave (AI-resilience build-out):** per-company ingest API keys + rotation (lib/ingest-auth.ts; platform key still works) · **Agent Interface MCP server at /api/mcp** (5 read tools, company-key auth — docs/AGENT-INTERFACE.md) · QBO timesheet push (TimeActivity, claim-lock idempotent, migration 065 — dark until QBO connect) · offline field queue (migration 066, honest replay timestamps) · in-app help center (/help, 6 guides) · provisioning playbook (docs/PROVISIONING.md)
- **Aug 24–25 wave (map scale + polish):** **trail_daily rollups** (migrations 077/078, Brian: "not going to work once we have 500 devices") — each asset-day is compressed ONCE into ≤288 evenly-strided points (36 for >45-day spans) by an hourly cron instead of the live sampler window-scanning raw pings on every 30d/YTD/All request; `asset_locations(timestamp)` btree + a watermark-driven backfill keep the build cheap forever, and the cron rebuilds a trailing 7 days so late tracker uploads (offline buffering) don't leave permanent holes · speed trails got an 8-color ramp matching the app's activity gradient · heatmap physics redone twice (parked/working reads full-weight red, only road-speed passes stay faint) · 3D activity terrain renders as smoothed "hills" in hours or $ (toggle chip), absolute height references so a single drive stays a flat mole-trail and a worked site climbs · scrubber ticks are per-horizon ladders (hour clock → weekday letters → month/day → month names) positioned at their true fraction of the window, memoized with cached `Intl.DateTimeFormat`s (was recomputing on every playback frame) · timeline options condensed to one line on phones · saved/preset **map Views are starting points**: the highlight clears the moment any layer/style diverges from the snapshot, and applying a view no longer forces the marker style (presets configure the map, not the asset glyphs) · replay/trail-head markers now match the live dots (same puck + type silhouette) · MAP TOOLS edge tab mirrors LAYERS (opposite edge, same height, slides with the pullout) · swipe-to-close now actually fires on touch for both side trays (`touch-action` was letting the browser eat the gesture) · asset detail page **streams** (Suspense per section — trip log, diagnostics, pairing, maintenance — instead of one blocking render; was the "far too long to load" page) · map now opens framed to the **fleet's extents** by default, not last-camera or zone bounds · iOS Safari's sticky auto-zoom killed (16px inputs on touch) · Rain totals got an opacity slider · fixed a real bug where the desktop **Ask AI launcher was permanently hidden on /map** (a shared Dialog primitive fired its "a dialog is open" event once on mount instead of keyed to `open`, and the map's always-mounted zone-draw dialog tripped it forever — confirmed against a production build, not just dev)
- **Insights engine (Aug 27 — Brian: "these guys won't know what to ask it"; wow without overload):** deterministic trend watch, zero new model calls. Nightly cron (+ lazy first-run on `/api/insights`) rolls each company's local day into `company_metrics_daily` (cost/hours/per-zone off the 056 ledger, alert counts off alert_events — the whole 35-day window rebuilds every run, so baselines exist from day one), then 8 detectors fire typed findings with evidence + deep link: budget burn ≥80%, week cost ≥40% over 4-wk normal, one-site cost concentration, after-hours-movement trend, equipment idle ≥7d × daily_cost, missing-receipts pile, site-gone-quiet (active job with prior hours, none in 7d), fleet-utilization drop ≥40% vs normal (util_drop shares cost_spike's full-35-day-baseline gate). /command wall gets a "Worth a look" window (≤2 rows, hides when quiet). ONE live row per story (`insights` unique fingerprint): re-fires only when magnitude moves ±20%, dismissal sticks until 1.5× growth — the anti-cry-wolf rule is in the schema. **Owner memo (Aug 27, layered on top):** monthly 3-paragraph "what lever next" read — gatherMemoFacts (30d spine + /finance benchmarks/valuation + live findings + receipts/service debt) → `claude-opus-5` (env `AI_MODEL_DEEP` overrides) with the strict facts-only contract, deterministic plain fallback keyless; stored per company-month (facts snapshot beside the text = audit trail), card on /finance with 30-min-floored Refresh, mailed on the 1st via `/api/cron/memo`. Surfaces (all capped): map Today card gets ≤2 ✨ rows (sev≥2, per-row dismiss; replaces its local idle row when the engine's is live), briefing/Friday/Sunday/evening/Monday emails list ≤3 headlines as facts for the existing AI voice, Ask AI opens with ≤3 tap-to-ask chips built from live findings (grounded intent answers them without a key; agent path + MCP door share the `whats_worth_a_look` tool — money-gated like get_zone_costs). Money rows stripped for non-cost roles at the API (same wire rule as costToday).
- PWA (manifest.json)
- Mobile bottom nav with "More" drawer
- **Scan-to-map onboarding (Aug 28 — Brian: per-device setup "absolutely insane"; wants scan QR → on the map → edit later):** Assets → **Scan trackers** (`/assets/scan`) — camera reads the IMEI barcode on the Teltonika box (native BarcodeDetector where available; typed 15-digit fallback everywhere), `quickAddTrackerAction` creates the asset with a placeholder name (`New truck …2222`) + tracker_id, dot appears at first report, rename/icon/rates later. Batch-first: re-scanning answers "already added" instead of erroring. Vendor side (SIM + config) stays docs/DEVICE-ONBOARDING.md
- **Bulk load, spreadsheet style (Aug 28 — Brian: "need a bulk load option — spreadsheet style. I can then edit the assets later"):** Assets → **Bulk add** (`/assets/import`) — paste a fleet straight out of Excel/Sheets (or upload CSV/TSV) into an editable grid. `lib/bulk-import.ts` is the PURE core both the grid and `bulkCreateAssetsAction` run, so a client that skips validation can't write a row the grid rejected: one parser for TSV/CSV/semicolon incl. quoted fields, header matching by ALIAS (your "Unit Name"/"IMEI"/"VIN" headings map themselves — column order never has to match ours; a data row can't eat itself as a header), type+icon inference from the name (`dump truck` → vehicle/dump-truck, `TB235 Mini-Ex` → equipment/excavator; blank type is an error, never a silent 'vehicle'), money coercion ($1,250.50), IMEI 15-digit+Luhn (BLE tag ids pass as non-numeric), and duplicate detection both WITHIN the sheet and against the existing fleet (name warns, tracker blocks — checked against ACTIVE assets only, matching 082's index so deactivate-to-release still works). Grid: Enter/arrows walk rows, paste anywhere, essentials-vs-all column toggle (cost columns absent entirely without canViewCosts, and stripped again server-side), per-cell red/amber rings + a plain-words error list. Import is chunked 25 at a time and a failed chunk retries ROW BY ROW so one bad line never sinks the batch; imported rows leave the grid, failures stay with the server's reason attached. Capped at 500 rows/import.
- **Per-asset map icons (Aug 28 — Brian: "guys would like to see different options — dump truck, day cab, mower"):** `lib/asset-icons.ts` — ~28 SDF-safe silhouettes across trades (trucks: pickup/service/flatbed/dump/day-cab/semi/box/van/mixer/water · dirt: excavator/dozer/skid-steer/wheel-loader/backhoe/grader/roller/crane/telehandler/forklift/boom-lift · ag: tractor/mower/UTV · support: trailer/generator · person/wrench). Stored as `metadata.icon` (same pattern as metadata.color — NO schema change), validated by `resolveAssetIcon` (bad value → type default, so existing fleets render unchanged). One registry feeds the map's SDF glyphs (live dots + replay heads + tool dots), and the AssetForm "Map icon" picker (grouped grid, live puck-color previews, Auto chip). Drawing rule: every feature ≥8px in 64-space or the SDF threshold erodes it at the final ~12px render
- **Map selection & state language (Aug 28, Brian's trio):** selecting an asset now dims everyone else in EVERY movement view — trails/speed trails (pre-existing sel/dim paint), heatmap (others' `heatmap-weight` ×0.08), 3D terrain (ONE `hexHeatGeoJSON` pass tags each stack `dim` 0/1 — one lattice + one height ref, so selecting never rescales the hills; ghost layer filters `dim:1` at 0.16 opacity) · devices silent >48h (`DEAD_MS`) render **dead-gray** — gray puck/ring/arrow, dimmed glyph+name; precedence alert > dead > idle-$ (a ripped-out tracker is alert+dead and must stay red; the Idle $ overlay's chip also skips dead — its idle math is stale) · selection spotlights only when the pick has a footprint in the window (a tool in live mode / a dark tracker must not ghost 100% of the data) · tools wear the same ring grammar as assets: new `tool-state-ring` (teal sighted / gray left) + the white selected ring + size-up on live dots AND tool dots (`sel` now rides buildGeoJSON/toolsGeoJSON)
- **Navigation wave (Aug 29-30 — Brian: "pins with an actual destination, routing, traffic — an app my guys stay in all day and not have to use Google Maps"):** **Places** (migration 085, `lib/db/places.ts`, `lib/actions/places.ts`) — saved POINT destinations distinct from zones ON PURPOSE (a zone is an AREA the alert engine + hours ledger reason about; a place is somewhere you drive: supply house, dump, shop). Kind-coloured pins (PLACE_KIND_META in `components/map/PlaceSheet.tsx`), tap → sheet, ride /api/map-data + 20s tick. **/api/route** = OSRM directions proxy, `trafficAware:false` — the DirectionsSheet labels every ETA "no-traffic estimate" (never imply modelled traffic; TomTom Traffic layer toggle sits beside it), Google handoff in the footer for voice nav. Directions launch from places, assets, zones, and searched addresses (search drops a candidate pin: Directions / Save as place). Route line = amber over dark casing under the asset stack. **Aircraft smoothing**: `advancePlane` in lib/sat-3d.ts dead-reckons each plane along its own track/speed per frame (ease ~250ms, 30s extrapolation cap) — 6s ADS-B polls read as continuous flight; popup enriches with the ACTUAL airframe's photo (planespotters, credit+link required) + filed route via **adsbdb** (adsb.lol routeset verified broken Aug 30; adsbdb is schedule-derived — label "filed route", query-and-display only, NEVER bulk-import their DB). **Speed callouts**: moving assets wear an amber "36 mph" bubble (`speed-callout` layer, live view only). **Convoys** (`lib/convoy.ts`, Brian: "devices in the truck with me need to be looped in together"): MOTION AGREEMENT groups GPS assets riding together (<120m, both >6mph, headings within 35° — parked yards never group; tools excluded, BLE pairing is better truth) → teal dashed lasso + "Truck 3 +2" on the map, "Traveling together" card in AssetPanel. AI context wiring = task #25. **Location primer** (`components/LocationPrimer.tsx`): first open on a phone explains WHY then fires the OS prompt (this pre-prompt IS Play's required prominent disclosure; denied → per-platform settings path). **Shows ONCE per device** (Brian, Sep 1: "allow location for employees should only be a one time thing") — `ht_locprimer_done` is set the moment it appears; after that the OS asks at point of use and Settings carries the path. The old weekly snooze is gone. AndroidManifest now declares FINE+COARSE location (foreground ONLY, deliberately no background) — needs the next Play release; the primer itself ships on web deploys. BLE stays point-of-use at the tag scanner. **Open-data recon (Aug 30, verified by live probes):** build-ranked: FAA TFR + LAANC drone ceilings (keyless, serves the daily Mavic flights), POI tap-for-phone/hours (Nominatim/Overpass per-tap + FSQ OS Places Apache-2.0 bulk import later — reviews are CLOSED at every price, deep-link out), NWS alerts + USGS river gauges (pour/flood), Amtrak (fun, community API). Honest NOs: live AIS boats (WebSocket-only free tier — needs an always-on relay or paid), freight rail (no public source at any price), live arrivals boards (OpenSky = yesterday only; that layer is FlightAware's licensed moat), station fuel prices.
- **Ask AI entry points (Aug 28 — Brian: floater "covering things everywhere" on PC):** the desktop floating launcher is GONE; every launcher lives in the chrome and opens the panel via the `ht:ask` window event — sidebar-header amber "Ask AI" button (desktop, collapsed = icon square), bottom-nav amber center button (phones), command-banner button. Map tour's askai step now targets whichever launcher is visible (querySelectorAll + first non-zero rect)

## Hardware Stack (Decided)
| Role | Device | Notes |
|------|--------|-------|
| Trucks | Teltonika FMM003/FMM00A | OBD2 plug-in, Cat-M1, BLE gateway, $86 (KORE) |
| Equipment | Teltonika TAT141 | Cat-M1, BLE 5.2, IP68, battery, $83 (KORE) |
| Equipment (CAN, Phase 2) | Teltonika FMM650 + CAN adapter | wired 8-32V, J1939 true hours/fuel/faults, $112+$118 (KORE) |
| Tool tags | BlueCharm BC021 / Feasycom / Teltonika BLE | BLE iBeacon, ~$20 (Amazon or KORE) |
| SIM cards | Hologram (pilot T1-a/b) / KORE **SuperSIM** (Aug 2026 order, arrived) | Multi-carrier triple-punch (2FF/3FF/4FF); KORE’s per-SIM quote is well under $2/mo (Jul 13, Felix — exact figure in the KORE proposal, confidential; do not print it in the repo). SuperSIM APN = **`super`** (printed on card). Onboarding = activate in KORE One (25MB pooled + "Super SIM Standard APNs" feature) → push config via **FOTA WEB** (all order-#1 devices pre-registered there) — full no-cable playbook proven Aug 26: docs/DEVICE-ONBOARDING.md. KORE did NOT pre-load our flespi profile despite Matt's promise (follow up for order #2). |

### KORE order #1 (signed via DocuSign, PAID $1,818 Aug 5 2026 — ARRIVED Aug 20–21; SIMs activating in KORE One; 5/6 OBD units online Aug 28; TAT141s/FMM650s/beacons still to bring up)
5× FMM00A ($86) · 6× TAT141 ($83) · 3× FMM650 ($112) · 3× ALL-CAN300 ($118) · 10× Eye Beacon BLE ($20) · 13× SuperSIM. Order ARRIVED Aug 20–21 (14 devices + 13 SIMs). KORE did NOT pre-configure the devices despite Matt’s promise — provisioning is our no-cable FOTA playbook (docs/DEVICE-ONBOARDING.md); ask for pre-config again on order #2. Connectivity agreement still pending in KORE’s system. Contacts: Matt Ferrans (Channel Partner Relationship Director, runs point; contact in Brian’s phone; team alias OEM@korewireless.com) · Felix Alfaro OOO until Aug 10 · Billy Stalder, Teltonika Regional Mgr Telematics (contact in Brian’s phone). KORE Console account created (login = brian@dillardconstructiongroup.com; port to brian@hammertrack.ai requested — KORE must change it server-side).

### White-label (Teltonika, Billy — Aug 4 2026)
Possible at **200-unit MOQ**; first run +2–3 weeks lead, then ~4 weeks per run. The gray regulatory text on the device top CANNOT change (else recertification ≈ $10k + months). Options sheet attached to Billy's Aug 4 email. Decision deferred to Founding-25 scale.

### Live pilot units (T1 = FMM00A OBD units, deployed Jul 2026)
| Unit | IMEI suffix | Hologram SIM | Installed in |
|------|-------------|--------------|--------------|
| T1-a | …02222 | 44398 | **Brian's Chevy 1500 — LIVE since Jul 6 2026** (asset "Chevy 1500 - Brian", tracker_id = the unit’s full 15-digit IMEI (ends …02222)) |
| T1-b | …00200 | 44406 | **2003 Chevrolet Silverado 2500HD** (Trey's truck) — reported from Aug 4, SILENT since ~Aug 13. /diag read 29,842 min stale on Sep 3. SIM healthy/unpaused in Hologram (5.17 MB of 100), so it is the OBD power path, not config. NOTE: this truck was tracked as two separate to-dos ("T1-b in the 2003 Chevy" and "Trey's 2500HD") until Sep 3 — one device, one problem. |

- flespi channel: the Teltonika TCP channel (host:port in the flespi console — kept out of the repo: host + a known IMEI is all a spoofer needs) · Codec 8 Extended · APN `hologram` (no user/pass, roaming on)
- flespi webhook `hammertrack-ingest` (#16402) → POST https://hammertrackjune28.vercel.app/api/ingest/flespi with `x-flespi-token` header (= FLESPI_WEBHOOK_TOKEN in Vercel)
- **Webhook topic GOTCHA (cost a night of debugging):** trigger topic must be `flespi/message/gw/channels/<channel-id>/+` — the last MQTT level is the device IMEI, so a literal `.../message` suffix silently matches nothing. Also verify the webhook's Enabled toggle actually saved.
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
- ⚠ **www.hammertrack.ai serves the apex-only TLS certificate** (browser
  warning on www) — add www.hammertrack.ai as a redirect domain in the Vercel
  project so it gets its own cert and redirects to the apex.
  www.hammertrackai.com has no DNS record at all.
- **Public addresses** (sales@ / hello@ / support@ @hammertrack.ai) must exist
  as Workspace aliases or groups — the code points at them either way.
- Old Netlify site (stately-heliotrope-0b2bff) is dead; ignore it.

## Env Vars Needed for Production
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPTILER_KEY=       # optional (unused by the current basemaps)
NEXT_PUBLIC_CARTO_KEY=          # optional since Sep 2: without it the map runs on Esri's keyless canvas basemaps (labels via reference overlay); with it CARTO's retina tiles (free 5M tiles/mo at carto.com/basemaps/apikey — email + domain, no account). CARTO stamps UNKEYED CARTO tiles "API KEY REQUIRED", so never point at CARTO without the key
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
FCM_SERVICE_ACCOUNT=          # optional: native push to the phone lock screen — FULL JSON of a Firebase service-account key (Project settings → Service accounts). New projects MUST use this (Google retired the legacy server key); FCM_SERVER_KEY still works as legacy fallback. Devices self-register via the Capacitor app → /api/push/register (migration 029). Unset = no push.
RESEND_API_KEY=                # optional: emails team invites (free at resend.com; verify hammertrack.ai domain)
RESEND_INBOUND_SECRET=         # optional: whsec_… signing secret for the Resend inbound webhook → /api/inbound/receipts (instant receipt chase; fails closed unset)
EMAIL_FROM=                    # optional sender override, default "HammerTrack <team@hammertrack.ai>"
SUPABASE_DB_URL=               # optional: session-pooler Postgres URI — enables `npm run migrate` (auto-migrations)
CRON_SECRET=                   # REQUIRED for /api/cron/usage (fails closed — ledger+trail rollups stop without it); locks the other crons too (Vercel sends it automatically once set)
# ── Stripe subscription billing (optional; unset = billing card says so, nothing throws) ──
STRIPE_SECRET_KEY=             # sk_live_… (sk_test_… against test mode)
STRIPE_WEBHOOK_SECRET=         # whsec_… from the /api/stripe/webhook endpoint in Stripe
STRIPE_PRICE_MACHINE=          # price_… recurring $6/mo, "Tracked machine"
STRIPE_PRICE_TAG=              # price_… recurring $3/mo, "Tool tag"
SHARE_LINK_SECRET=             # optional: signs public replay links (unset = derived from service-role key)
WINDY_WEBCAMS_KEY=             # optional: Webcams map layer (free key at api.windy.com/webcams)
NEXT_PUBLIC_TOMTOM_KEY=        # optional: Traffic map layer (free key at developer.tomtom.com, 2.5k tiles/day)
NEXT_PUBLIC_VERCEL_ANALYTICS=  # optional: '1' turns on Vercel Web Analytics (enable Analytics on the project first, else the script 404s on every page)
NEXT_PUBLIC_PARCEL_SERVICE_URL= # optional: county ArcGIS parcel layer URL (…/MapServer/<n>); enables Parcel lines + tap-for-owner. Greenville SC: gcgis.org ArcGIS REST directory
# ── Home weather station (optional; unset = hidden) ──
PWS_PROVIDER=                  # ambient | tempest | wunderground (inferred from keys if unset)
PWS_API_KEY=                   # ambient + wunderground
PWS_APP_KEY=                   # ambient only (application key)
PWS_TOKEN=                     # tempest only
PWS_STATION_ID=                # tempest + wunderground
PWS_MAC=                       # ambient only, optional: pick one of several stations
ANTHROPIC_API_KEY=            # optional: natural-language AI dispatcher (Haiku)
AI_MODEL_DEEP=                # optional: model for the monthly owner memo (default claude-opus-5)
# ── Plaid bank/card auto-import for missing-receipts (optional; unset = CSV paste only) ──
PLAID_CLIENT_ID=             # from dashboard.plaid.com
PLAID_SECRET=                # per-environment secret
PLAID_ENV=                   # sandbox | development | production (default sandbox)
PLAID_WEBHOOK_URL=           # optional: /api/... for SYNC_UPDATES_AVAILABLE
```

## Business Entity (Jul 2026)
- **HAMMERTRACK LLC** — SC single-member LLC, formed Jul 2026; EIN issued Jul 14 2026. CP 575 G confirmation PDF is on Brian's phone (Downloads) — **keep the EIN itself out of the repo**. The IRS issues that PDF once and never again; a lost copy means a 147C call.
- Unblocked: Twilio toll-free verification (SMS theft alerts; verdict unconfirmed), business bank → Stripe billing, Plaid (receipt-chase), D-U-N-S → Apple/Google developer org accounts (**Google Play org account is LIVE with the app in Production since Aug 21; Apple is blocked on identity + LLC documents (Aug 31)**)
- **App wrapper:** Capacitor shell (capacitor.config.ts, mobile-shell/, android/, ios/) loads the live site remotely — web deploys update the apps instantly. The shell must open the APP, never the marketing splash (Brian, Aug 28: screen 1 after downloading was the hero page with a hamburger and "Start free pilot"). TWO layers, because the Play build is already in production: (1) `app/AppEntryRedirect.tsx` on the marketing root sends any Capacitor shell to /map client-side — this reaches ALREADY-INSTALLED apps on the next web deploy, no store release; (2) `server.url` is now hammertrack.ai/map so future builds skip the round trip. /map is the one destination that serves both states, since the dashboard auth gate bounces a signed-out visitor to /login. Shell also sends `HammerTrackApp/1` in the UA. NOTE: config/UA changes need a native rebuild + Play release; the redirect does not. Full checklist + architecture: `docs/APP-STORE-PLAYBOOK.md`

### Vendor accounts (status Sep 1 2026)
| Account | State | Notes |
|---|---|---|
| **Twilio** | toll-free **+1 888 373 9004** bought; compliance profile **approved**; Toll-Free Verification **In Review** since Jul 30 — **verdict unchecked, no email in 60 days; check the Twilio console** | Use case Security Alert + Account Notifications, 100 msg/mo. Opt-in proof = https://hammertrack.ai/sms + the consent checkbox on Settings → Company. Verdict emails brian@hammertrack.ai. Voice is enabled and needs no registration, but has **no greeting** — don't publish the number until it does (inbound toll-free minutes are billed to us). |
| **Mercury** | **APPROVED — live Aug 5 2026**; vendor migration underway (KORE first, via per-vendor virtual cards on the IO) | Partner bank Column N.A. $3,000 first deposit = **owner capital contribution, not income**. IO card issued. Rule: one named virtual card per vendor, limit set per vendor. No cash deposits ever; paper checks go to a mail-in lockbox. |
| **Supabase** | Pro; billing entity **HAMMERTRACK LLC**, EIN on file | Security advisor flagged `rls_disabled_in_public` (critical) Sep 1 — **fixed by migration 086** (schema_migrations + spatial_ref_sys locked down, migrate runner hardened). Rerun the linter to confirm it reads clean. |
| **Google Workspace** | live on hammertrack.ai | sales@ / hello@ / support@ all verified receiving (Jul 30) |
| **D-U-N-S** | ✅ **LANDED early Aug 2026** (D&B account created Jul 31; partner email Aug 8 confirms number issued) | Unblocked both **organization** developer accounts. Never file again (duplicate records are slow to merge). |
| **Google Play** | ✅ **LIVE — org account, app in PRODUCTION** (verified in the console Aug 28) | HammerTrack **Organization** account, ID 5164665234986722552. Identity verified + website ownership verified via Search Console **Aug 9**; `com.hammertrack.app` published to **Production Aug 21**, update published Aug 27; all apps meet the Android developer verification requirements. Installed audience 0 — the remaining work is DISTRIBUTION (store listing completeness, discoverability), not enrollment. ⚠ Correction: this doc said "enrollment not started" through Aug 28 because no fee/verification email was findable in the Gmail account — the confirmations landed elsewhere. **Check the console, not the inbox.** **v1.2 (versionCode 5):** signed AAB built by the android-release workflow Sep 1 (run 4, green) — awaiting Brian's Play Console upload, or hands-off once `PLAY_SERVICE_ACCOUNT_JSON` is added as a GitHub secret. Listing still shows raw browser screenshots + no tagline (assets in store-assets/, docs/APP-STORE-LISTING.md). **Sep 30 2026 deadline:** Google requires every Play app registered for Android developer verification (>99% auto-registered) — confirm the package shows "registered" on the Play Console home page. |
| **Apple Developer** | 🔴 **more documents requested (Aug 31)** | Enrollment N37H75H2FX, case **20000149520723**. Aug 27 batch submitted; Aug 31 Mike (senior Advisor) replied: **cannot verify Brian's identity nor his association with HAMMERTRACK LLC** — upload at developer.apple.com/contact/file-upload: driver's license **front AND back**, employment/ownership verification, and an LLC business document (SC Articles of Organization / Certificate of Formation; business license also accepted). Case emails now land in **Brian’s personal inbox** (Aug 27 ones went to brian@hammertrack.ai — watch both). dnb.com record must match HAMMERTRACK LLC legal name + address verbatim — Apple matches it literally. |
| **Google Ads** | 🔴 **account PAUSED Aug 31** — advertiser verification not completed by the deadline | Complete advertiser verification in Google Ads (Billing → Advertiser verification: the about-your-business questions + the EIN letter or SC LLC registration) before any spend. The account number stays out of the repo. |

## Pending / Next Steps
1. ~~flespi account + webhook~~ ✅ DONE Jul 6 2026 (see webhook gotcha above)
2. ~~Supabase production~~ ✅ DONE Jul 6 2026 — project "Hammertrack 2026". ~~Manual SQL Editor runs~~ superseded: **auto-migrations on deploy since early Aug** (see Live Site above) — the old "run 006–009 by hand" instructions here misled a session as late as Aug 18. Fresh installs: paste `supabase/setup.sql`. See `docs/GO-LIVE.md`.
3. ~~Env vars~~ ✅ DONE — all set in Vercel (Production + Preview) since Jun 28–30
4. ~~Point hammertrack.ai at Vercel~~ ✅ DONE Aug 5 2026 (task 173) — apex A → Vercel (216.150.1.1 is Vercel's current anycast IP), www CNAME → cname.vercel-dns.com, hammertrackai.com 301 → hammertrack.ai, Workspace MX intact. Unblocks final QBO_REDIRECT_URI + app-store remote URL. Follow-up: set Supabase Auth → URL Configuration Site URL to https://hammertrack.ai (else auth emails/redirects still point at vercel.app).
5. **Remaining hardware** — ~~install T1-b~~ ✅ reporting since Aug 4 (…00200); ~~KORE order #1~~ ✅ ARRIVED Aug 20–21, SIMs activating in KORE One, 5/6 OBD units online Aug 28 (SuperSIM APN = `super`, not Hologram's; no-cable FOTA playbook proven Aug 26 — docs/DEVICE-ONBOARDING.md). **Remaining:** bring up the 6 TAT141s, 3 FMM650s + CAN adapters and 10 Eye Beacons; last puck (task 160: Minors 3+5 configured, tool assets created; last puck = Minor 4). KORE's CSM (Claire Chatelain) asked Aug 26 for onboarding/training-call availability — unanswered; the Aug 14 invoice's card declined Aug 18 (AR email) — payment status unknown, put it on the Mercury vendor card.
6. ~~After-hours theft alert live test~~ ✅ verified in production Aug 4–5 — real after-hours alerts fired on the RAM 3500 (phone tracker) at 6:33 AM/7:01 PM
7. **QuickBooks go-live** — create app at developer.intuit.com, add QBO_ env vars to Vercel. **Click-by-click checklist: docs/QBO-GO-LIVE.md (Aug 28).** NOTE (Aug 26): marketing copy still says "QuickBooks built in / job-cost sync" — the integration code is real but NO customer can connect until this ships. Truth-audit softened "two-way sync" already; if this slips much longer, the built-in claims need ROADMAP treatment too.
8. **Twilio toll-free verification status** — has read "In Review" since Jul 30 and **no verdict email exists anywhere in the inbox as of Sep 1** — Brian checks the Twilio console directly. The splash's "your phone knows in minutes" / 2-minute-text theft hook rides on SMS actually sending: claims stay soft on / and /demo until it clears (Aug 26 site audit flagged this).
9. **Solar question** — confirm TAT141 solar accessory availability with Teltonika Americas
10. ~~hammertrack.ai domain~~ ✅ OWNED + Google Workspace live (confirmed Jul 30 2026)
11. **Trails/playback timezone** — scrubber clock labels; see `docs/TRACKER-DATA.md` for tracker data reference + per-asset reporting-profile design
12. **Move ALL vendor payments to Mercury + the Mercury IO credit card** once the account is approved — Vercel, Supabase, Twilio, Hologram, Google Workspace, Namecheap, Resend, KORE, Anthropic, MapTiler/TomTom/Windy keys. Nothing stays on Brian's personal cards (clean books; the $3,000 opening deposit is owner capital contribution, not income).
13. ~~Real-time receipt chase via card-alert email forwarding~~ ✅ BUILT Aug 1 2026 (migration 045, `/api/inbound/receipts`, `/r/{token}`, nag ladder). Plaid SKIPPED ($1,000/mo quoted Aug 1; declined — sandbox-only unless a non-QBO customer demands it, then pay-as-you-go only). **Brian to activate:** (a) Resend dashboard → enable inbound email on hammertrack.ai → point webhook at `https://hammertrackjune28.vercel.app/api/inbound/receipts` → copy the `whsec_…` signing secret into Vercel as `RESEND_INBOUND_SECRET` + redeploy; (b) on /receipts hit Enable, add card last-4 → cardholder mappings; (c) turn on Chase/CapOne per-transaction email alerts (threshold $0) pointed at the inbound address; (d) swipe a card and confirm the push + /r capture round-trip.
14. **PM competitive build-out** — tiers, COI tracking, T&M tickets, closeout binder, full Procore-parity map: `docs/PROJECT-MANAGEMENT.md` → "Competitive roadmap". Next up when Brian calls it: Tier 1 money loop (estimates → e-sign proposals → change orders → pay apps).
15. **The $100M → $1B path** — staged plan (Founding 25 → $1M ARR → $10M ≈ $100M valuation → $100M ARR ≈ $1B): channels, gates, kill-risks, funding decision points: `docs/PATH-TO-1B.md`
16. **Growth Platform (the endgame)** — Ramp-style card + spend, partner-first lending, live company valuation + exit suite, benchmarks, insurance arm (discount referrals → embedded agency → maybe MGA; never carry risk), AI "what lever next" advisor (hires/equipment/office/geography/protect): `docs/GROWTH-PLATFORM.md`. Supersedes the old "financing = never" note. Order: charts/benchmarks → valuation card → HammerTrack Card → referral lending → insurance referrals. **Shipped already:** layer 1 (benchmarks + 3-method valuation, /finance, Aug 1), the 4-lite valuation card inside it, and the advisor v1 (insights engine 079 + owner memo 080/081, Aug 27–28). The gate — PM Tier 1 + Founding-25 filling + Mercury/Stripe live (both ✅) — applies to the money-moving layers only (card, lending, insurance).
17. **AI-resilience strategy (Brian, Aug 21)** — `docs/AI-RESILIENCE.md`: own the atoms + data + money rails; ship the **Agent Interface (MCP server)** so customers' own AI (Claude/ChatGPT/whatever) queries HammerTrack per-company (prereq: task #22 per-company keys). Build order it ranks first: QBO timesheet push → offline field queue → multi-tenant hardening → MCP → support scaffolding. Guardrail: never market "AI" as the differentiator — outcomes only (same standing as the splash truth rule).

## Go-to-Market
- Lead funnel: FB/IG theft-hook ad → hammertrack.ai/demo → /register
- Primary hook: after-hours theft alert ("Your excavator left at 2 AM")
- Price position: $3-8/asset/mo vs Tenna $15-25/asset/mo + $500 setup
- Beachhead: **Upstate SC (Greenville–Spartanburg–Anderson), then Charlotte/Atlanta corridors** — per docs/BUSINESS-PLAN.md ("Nashville was demo-data fiction; you sell where people already return your calls"). Local contractor Facebook groups + equipment dealer referrals; the demo stage stays on the Nashville grid (deliberate fiction) until a Greenville restage is worth it
- Ad variants ready in marketing/ad-variants.md

## Competitors
Full 10-competitor battle brief with sources: `docs/COMPETITORS.md` (Aug 24
recon — FleetWatcher/AlignOps, EquipmentShare T3, Trackunit, HCSS, Linxup,
Motive added). Correction from that recon: Tenna DOES have BLE tool tags +
claims QBO now — sell on implementation cost/contract friction/small-crew
fit, not missing features. Tenna is John Deere-owned since ~Feb 2026.
- Tenna: ~$15-30/asset quote-only + $5k-20k implementations, enterprise
- Samsara: $27-60/vehicle, 3-yr contracts (small fleets prepay all 3 years)
- Verizon Connect: ~$23-45/vehicle, 36-mo auto-renew, contract-trap reputation
- FleetWatcher (AlignOps): paving/e-ticketing hauler logistics, heavy setup
- GPS Trackit: $24-36/vehicle, month-to-month but leased-hardware exit trap

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

## Release rule (Brian, Aug 31 2026)
"Always release new version. You do not need permission from me any more."
When native-affecting changes merge (android/, ios/, capacitor.config.ts,
mobile-shell/), bump versionCode/versionName in android/app/build.gradle and
dispatch the `android-release` workflow on master — do not ask first. **PLAY_SERVICE_ACCOUNT_JSON is set (Brian, Sep 2) and the hands-off upload is PROVEN** (run 5, versionCode 6 → internal track, Sep 3): dispatch with `track: production` for a real release, `track: internal` for crew test builds. Play rejects a reused versionCode, so bump before every dispatch. The
workflow builds the signed AAB; with the optional PLAY_SERVICE_ACCOUNT_JSON
secret it uploads straight to the Play production track, otherwise the AAB
artifact + a Play Console upload note is the deliverable. iOS releases stay
manual until the Apple org enrollment clears. Play rejects a REUSED
versionCode (skipped numbers are free) — when in doubt, jump higher.

## Checks & balances rule (Brian, Aug 11 2026; cadence revised Aug 28)
"Create a few more agents within here as a checks and balances to your
decisions… don't forget about this!" — the repo's reviewer agents
(.claude/agents/) exist to second-guess shipped work:
- **ship-check** — adversarial code review of the day's diff
- **truth-check** — splash truth + pricing sync + public-repo hygiene
- **sec-check** — new/changed endpoints, service-role writes, ingest paths

**Cadence (Brian, Aug 28: "this is too slow"):** ONE review pass per DAY
that had major changes — not per session, not per PR — unless Brian asks
for one. Reviewing must NOT gate a merge: ship the work, then run the pass
over that day's commit range and fix what's real in a follow-up commit.
**Scope the pass to the changes** (the day's diff), never the whole repo,
unless Brian asks for a broader audit. Real findings get fixed or tracked
with a task number in the final report — never silently noted.

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
