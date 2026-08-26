# HammerTrack — Project Timeline

Everything built, fixed, decided, and discussed, in order. Compiled from the
git history and working sessions. (Dates are commit dates, US Eastern.)

---

## Late June 2026 — Birth of the product

### Wed–Thu, Jun 24–25 · First working app
- Next.js 14 + Supabase + MapLibre app stood up: live map, mock fleet, dashboard shell.
- First real bug fixed the same day: Field Tracker map rendering in a thin strip.
- Live map promoted onto the homepage; "How it works" section added.
- Deployed to Netlify under hammertrackai.com.

### Fri–Sun, Jun 26–28 · Map UX foundation + move to Vercel
- Popup overhaul: readable dark popups, one popup at a time, closeable asset panel, on-road trails.
- Map declutter, satellite default.
- App moved to Vercel (**hammertrackjune28.vercel.app**) — auto-deploys `master`; Netlify kept for the old marketing site.
- PWA cache bugs fought and beaten (stale /map pages): self-destructing service worker, no-cache headers.
- Timeline-synced zone cost, collapsible sidebar, weather location setting, asset detail pages.
- Auth middleware hardened (bad env vars could 500 the whole site), then made Edge-safe.

### Mon–Tue, Jun 29–30 · From demo to real product
- **Real multi-tenant data**: signups create their company (RLS INSERT policies, migration 003); dashboard, assets, sidebar all load the logged-in company instead of the hardcoded demo.
- Dillard Construction starter-fleet seed data.
- Custom From/To timeline range; asset categories, serials, photos.
- **3D basemap** with building extrusions; free basemaps replace MapTiler; compass; zone toggle.
- **Editable geofences**: rename/recolor/delete, detail pages, sub-zones; drawn zones persist.
- Alert rule management UI (create/toggle/delete).
- Geofence popup estimates live $ cost of assets inside a zone — the seed of the job-cost engine.
- Geofences renamed **Zones** everywhere; weather autocomplete (Open-Meteo geocoder); Devices/Site-IoT toggle; 24h seed history.

---

## Early July 2026 — Marketing shell + the real pilot

### Sat, Jul 4 · Trust + cinema
- Marketing trust pass: legal pages, real footer, founder band, unified CTAs.
- **Cinematic Command Center** first version; kiosk trails fade so the wall display reads clean.

### Mon, Jul 6 · **PILOT GOES LIVE** 🎉
- Tracker **T1-a installed in Brian's Chevy 1500** — full pipeline verified end-to-end:
  OBD unit → Hologram SIM → flespi → webhook → Supabase → live map.
- Supabase production project **"Hammertrack 2026"** created; migrations 001–005 applied.
- Hard-won lessons recorded in project notes:
  - **flespi webhook topic gotcha** (cost a night): trigger topic must be `flespi/message/gw/channels/<id>/+` — a literal `.../message` suffix silently matches nothing.
  - **OBD unit battery gotcha**: internal battery ships disconnected — open case, click plug in.
  - Engine-off = ~hourly check-ins is normal, not a fault.
- Naming convention set: T1 = truck OBD units, T2 = equipment units, T3 = tool tags (model numbers stay out of dashboards).

### Tue–Wed, Jul 7–8 · Production data layer + job-cost engine
- Add Asset form persists to the DB; telemetry capture; asset photo upload (resize client-side).
- Consolidated `setup.sql` + **GO-LIVE runbook**.
- Map trails switch to **real location history** in production (synthetic only in demo).
- **Real job-cost engine**: per-asset cost structure (hourly / mileage / daily / replacement), zone costs follow the timeline, billed across time-on-site, split per asset type.
- Edge-triggered **live alert firing**; radar zoom cap; hybrid road names; iPad viewport fix.
- Free GIS layers begin: **tax parcels**, **topo lines**, hillshade, **wetlands**, **streams**.
- Calendar-day Today/Yesterday; all timeline ranges get correct windows + real-history trails.
- **Big push**: real Reports, editable Settings, password reset, SMS-ready alerts, honest marketing copy.
- **Teams & roles** (secure multi-tenant) + onboarding wizard.
- **Cinematic camera-follow** playback; /demo theater with fly-around + theft-alert story; motion polish.
- **BUSINESS: full operating plan** committed (`docs/BUSINESS-PLAN.md`): pricing, phases, hires, cash curve, exit scenarios. **Founding 25 call list** mined from DCG correspondence.
- Phone-as-live-asset: **Go Live on /track** broadcasts your phone to the fleet map.
- Google/social OAuth login.

### Thu–Fri, Jul 9–10 · Diagnostics + QuickBooks
- Zoom-to-all on open; weather default saves exact coords.
- **Founding 25 offer band** on /demo (mirrors the sales sheet).
- Collapsible **asset diagnostics** panel (OBD voltage, engine state).
- Timeline heat map, activity chart, rain-totals layer, range-scoped history.
- **QuickBooks Online**: real OAuth token store, zone invoices, service-record expenses.

---

## Sat, Jul 11 · The marathon day (30+ ships)

**Domain**: canonical URLs moved to **hammertrack.ai** (primary domain live); contact emails migrated; click-to-call.

**Map & UX**
- Unified map selection sheet; idle demo data; outline-style zones; zone vertex editing.
- Zones list search + sort; account menu (sign out); public **/live** demo map (no login).
- Fix **speed units** (km/h→mph at ingest), pinch-zoom while following, fat-finger taps.
- Saveable **named map views** + default view; asset **spotlight/isolate**; panel cockpit + range stats.
- Stay-signed-in 30 days; map search with voice; boundary zones as a first-class kind; address-jump drawing; map label redesign; GOES **cloud layer**; crisp hybrid imagery.
- VIN decode in the asset form; named-place labels for stopped assets (POI pipeline seed).
- Trip log; site log; CSV exports; share links; acknowledge-all; 5-step onboarding.
- All server-rendered times formatted in the **viewer's timezone**.

**Command Center**
- **Tactical HUD** radar instrument (aviation/Garmin style), re-aims to the map camera, shows scope range.
- Left instrument rail (activity, sites, status, weather); right event rail; 3D activity terrain; kiosk timeline; Command Center timeline = map timeline.

**Alerts & integrations**
- One-tap **alert pipeline test**; ntfy-aware webhook → real push notifications. Fixed the ntfy push that never sent (an emoji in an HTTP header threw before send).
- Radar **time-travel** (radar scrubs with the timeline); QBO invoices with real Qty × Rate + ServiceDate.
- **12V battery health** + engine state derived from OBD voltage.

**AI**
- **Real tool-use AI agent** with persisted history and voice input.

**Field ops**
- Time clock (clock in/out), gated daily logs, QR equipment check-ins.

**Business**
- **Unit economics deep dive**: COGS per device, % of revenue at each tier.
- **Full operating model**: opex, insurance, hire triggers, cash curve (also in-app).
- **Idea Lab**: scored idea pipeline with kill tests.
- **White-label rule** adopted: no tracker vendor/model names anywhere user-facing; brand identity plumbed as a single constant (rebrand-ready — name not legally cleared yet).
- Permissions v2: 4 role presets + per-user sensitive toggles, enforced server-side.

**Hardware**: T1-b prepped; second pilot vehicle (2018 VW Atlas) joins the fleet.

---

## Sun, Jul 12 · Weather platform, wall display, AI power features

**Layers & weather**
- Flood zones, soils, storm warnings, stream gauges; /diag **layer health board** (server-side probes); the three red /diag layers fixed same day.
- Weather layers obey the timeline (nothing animates while the scrubber is paused — became the standing testing rule); **storm tops (IR)** layer.
- **NOAA temperature / feels-like / wind-speed** layers (free RTMA).
- **Animated wind-flow particles** (GFS model wind, canvas engine).
- **Weather stations layer** (Ambient public network dots + reading popups).
- **Layers panel IA refactor** per written spec: registry, groups, per-row gating with reasons, opacity sliders, feed-freshness stamps, reset.

**Wall-display pack**
- Public **share links** (7-day HMAC replay tokens), screen setup (every panel minimizable → fully clear screen), zone follow, **360 spin**, **globe projection** at far zoom, day/night terminator + NASA city lights.
- 360 made loop-until-stopped and buttery; **Flyover** — the slow-plane pass over every asset, with speed setting.
- 3-state marker pulse (moving / idle / off); fleet board shows zone + dwell time.
- Hydration crashes on the wall display root-caused (Node vs Chrome disagree on sin/cos in the 16th decimal!) and fixed.

**Data quality & trust**
- Top-speed spikes fixed; per-vehicle fuel MPG; trail fidelity pass; teleport guard; parked-since stat.
- Speed double-conversion scare investigated with sniff-test SQL → confirmed healthy, one conversion only.

**AI & ops**
- **POI stop classifier**: auto-tags stops (supplier / fuel / food / gov); stops report; assistant learns `asset_stops`.
- **Receipts inbox**: field photo → AI extraction → approve → QuickBooks.
- **Worker↔machine pairing** (beta): GPS co-movement evidence on daily logs + foreman confirm-grid.
- Evening **digest cron**; safety triage push; 7 PM still-on-clock nag; **Monday agenda** cron; per-zone **site-weather log** (weather receipts for disputes).
- AI rough-**ETA tool**; assistant stops refusing lunch/where-did-they-stop questions.
- Yard zones; nav groups; report ranges; make/model typeahead (federal vPIC database).
- Boundary zones clickable on the **border only** (interior no longer swallows map taps).
- **Webcams + Traffic** layers (free-key gated).
- Asset panel shows **city/state** up top; event log tells the movement story (arrivals, stops with durations).
- **Last-view persistence**: map + Command Center reopen exactly as you left them (camera, tilt, layers, everything).
- **Owner notes** on assets + zones — the AI reads them as ground truth ("V6 engine, spare key in office").
- Alert ticks on the timeline slider.

---

## Mon, Jul 13 · Storm warnings done right + personalization

- **Radar opacity slider.**
- **Storm warnings actually work**: switched from the filtered NWS feed (which silently dropped most alerts) to IEM storm-based warning polygons — tornado red, t-storm orange, flood green, marine purple — at any zoom, tap for expiry.
- **SPC watch boxes** added (dashed outlines under the warnings) after comparing against a commercial weather app.
- **Per-asset color picker**: Assets → Edit → "Dot & trail color" — one choice drives the map dot, trail line, and radar-dial blip.
- **BUSINESS: QuickBooks access model** walked through: admins connect QBO; crew only photograph receipts; billing-permission users approve→post; zone invoicing = GPS-accrued T&M per job customer. Card-swipe receipt nag designed (bank purchase-alert email parsing recommended over Plaid to start).
- **Hardware**: Feasycom tool beacons scanned and verified healthy (382 days on the shelf, battery fine); confirmed tags are identified by MAC address, so factory-default iBeacon IDs don't matter.

---

## Standing decisions & rules (as of Jul 13)

| Area | Decision |
|---|---|
| Hardware | Teltonika OBD (trucks), TAT141 (equipment, needs solar accessory), BLE tags (tools), Hologram SIMs |
| Pricing | $3–8/asset/mo vs Tenna $15–25 + $500 setup |
| GTM | Theft-hook ad → /demo → /register; Founding 25 beachhead |
| White-label | No vendor/model names user-facing; brand from a single constant |
| Testing | Any timeline/radar/history change: click all 7 ranges on /map AND /command before shipping |
| Deploys | `claude/...` branch → master, Vercel auto-deploys |
| Secrets | `hammertrack-*` HMAC prefixes; timing-safe ingest auth |

## Open items
- Run migrations 018 (pair confirmations), 019 (site weather), 020 (notes) in Supabase.
- Point remaining DNS fully at Vercel; install T1-b; order equipment trackers + solar, tool tags.
- After-hours theft alert live test (move the truck outside 07:00–17:00).
- QuickBooks production app keys; optional Windy webcams + TomTom traffic keys.
- Queued: alerts UX (unseen badge, click-to-replay, sortable); region zones (at first multi-metro customer).

---

> **Gap, Jul 14 – Aug 23 2026 not yet logged here.** Six weeks of shipped
> work in that window (the map wow-pack, demo realism rebuild, Showroom
> company, AI-resilience wave — Agent Interface MCP, per-company ingest
> keys, offline field queue — and more) is real and merged to master, just
> not narrated in this file. See CLAUDE.md's "Features Built" for the
> current list, or `git log --oneline` for the blow-by-blow. Backfilling
> this doc properly is its own job — ask for it when there's time to do it
> right rather than let it half-happen here.

## Sun–Mon, Aug 24–25 2026 · Map scale fix + polish wave

**The 500-device problem, solved**
- **Trail rollups** (migrations 077/078): the live map history endpoint used
  to window-scan every raw GPS ping for 30d/YTD/All ranges — cheap at 10
  assets, a statement-timeout risk at fleet scale, and it silently fell back
  to a newest-first snapshot that "lost" older trips (Brian: "this is not
  going to work once we have 500 devices"). An hourly cron now compresses
  each asset-day ONCE into ≤288 evenly-strided points (36 for spans over 45
  days); a btree index + watermark-driven backfill keep builds cheap
  forever, and a trailing 7-day rebuild catches trackers that buffer offline
  and upload late. Long ranges now read hundreds of tiny rows instead of
  scanning millions.
- Two reviewer passes (sec-check, ship-check) on the rollup wave caught and
  fixed: a fail-open cron secret, an uncapped read past Supabase's row cap,
  a missing index causing hourly full-table scans, and late-data holes from
  the old day-global backfill check.

**Map visualization polish**
- Speed trails: 8-color ramp matching the app's activity gradient.
- Heatmap physics rebalanced twice — first pass under-weighted dwell time,
  second pass overcorrected ("still want to see the trails" → parked/working
  reads full weight, only road-speed passes stay faint).
- 3D activity terrain renders as smoothed "hills" (not hex columns) in hours
  or $, absolute height references so a single drive stays a flat mole-trail
  and a worked site climbs over the window.
- Scrubber ticks: per-horizon ladders (hour clock → weekday letters →
  month/day → month names), positioned at their true fraction of the
  window, memoized with cached `Intl.DateTimeFormat`s — was recomputing the
  whole walk on every playback frame and scrub gesture (visible jank on
  phones).
- Timeline range row condensed to one line on phones.

**Map UX fixes**
- Saved/preset map Views are now "starting points": the highlight clears
  the instant any layer or style diverges from the snapshot, and applying a
  view no longer forces the marker style onto everyone (presets configure
  the map, not the asset glyphs).
- Replay/trail-head markers unified with the live dots (same puck + type
  silhouette) — trails mode used to silently switch assets to a different,
  older marker style.
- MAP TOOLS edge tab now mirrors LAYERS (opposite screen edge, same height,
  slides with the pullout instead of parking below it).
- Swipe-to-close on both side trays actually fires on touch now (missing
  `touch-action` was letting the browser eat the horizontal drag before it
  reached the close handler — open worked, close silently didn't).
- Map now opens framed to the fleet's actual extents by default (was
  "wherever you last left the camera," and the fit briefly mixed in zone
  boundaries, which could zoom a whole fleet out to a speck).
- Fixed a real bug where the desktop Ask AI launcher was permanently
  hidden on `/map` specifically: a shared Dialog primitive fired its
  "a dialog is open" event once whenever its JSX existed at all, not when
  it was actually open — and the map's always-mounted zone-draw dialog
  tripped that the instant the page loaded, with no matching close, ever.
  Confirmed against an actual production build (dev mode's double-effect
  behavior initially pointed at the wrong cause).

**Everything else**
- Asset detail page now streams: instant header/shell, then trip log,
  diagnostics, pairing history, and maintenance each pop in behind a
  progress sweep as their (heavier) queries finish — was one blocking
  render that could take a long time on a slow connection.
- iOS Safari's sticky page-zoom bug killed: any input under 16px font
  triggered a whole-page zoom that stuck through client-side navigation
  into the map. Touch devices now render all text inputs at 16px.
- Rain totals got the same opacity slider every other weather layer has.
