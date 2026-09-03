/**
 * The founder board's content — HammerTrack's own operating picture.
 *
 * Brian, Aug 28: "I want all of my Hammertrack items combined... to do list
 * road map financials, all of it. it feels Scattered and needs to have one
 * home for everything."
 *
 * This is that one home's SOURCE. Live numbers (devices reporting, assets on
 * the map) are read from the database by the page; everything here is the
 * standing picture that only changes when a decision changes.
 *
 * ── Where this fits the sync rule ──────────────────────────────────────
 * The repo already requires that any roadmap / to-do / cost change updates
 * marketing/system-map.html and the cost docs in the SAME commit. This file
 * joins that set: it is the single place the board reads from, so a change
 * here plus the graphic plus the docs keeps all three honest. Numbers here
 * are transcriptions of docs/ — if they ever disagree, the docs win.
 */

export type Owner = 'brian' | 'build'
export type TaskState = 'open' | 'flight' | 'done'
export type Severity = 'stop' | 'warn' | 'none'

export interface BoardTask {
  id: number
  title: string
  /** Why it matters / what it unblocks. Shown under the title while open. */
  why?: string
  owner: Owner
  state: TaskState
  sev?: Severity
}

/** Board ids are stable handles ("board #66") — new items take the next free
 *  number; ids are never reused. Refreshed against reality 1 Sep 2026. */
export const TASKS: BoardTask[] = [
  // ── Yours, blocking ──────────────────────────────────────────────────
  { id: 46, title: 'Pay the declined KORE invoice', why: 'Card declined 18 Aug on the 14 Aug invoice. An account in arrears can suspend the 13 SuperSIMs activating now — pay it from the Mercury KORE virtual card. Invoice number is in the AR email. Mark done when paid.', owner: 'brian', state: 'open', sev: 'stop' },
  { id: 66, title: 'Google Ads account is PAUSED — finish advertiser verification', why: 'Google paused the ads account 31 Aug because the verification tasks were not completed by the deadline. Nothing runs until it clears: Google Ads → Billing → Advertiser verification (business questions plus the EIN letter or SC LLC registration). The theft-hook funnel cannot spend until then.', owner: 'brian', state: 'open', sev: 'stop' },
  { id: 40, title: 'Revive T1-b — the 2003 Silverado 2500HD', why: '/diag reads 29,842 minutes since its last fix: silent about 20.7 days, last heard from around 13 Aug. It HAS reported before and the coordinates are real, so the asset and tracker_id are correct — this is device-side. Hologram shows the SIM healthy, unpaused, 5.17 MB of 100 used, last seen the same day, so it is the power path: bypass the OBD extension, plug straight into the port, check the port fuse. On a 2003 truck that circuit is often shared with the cigarette lighter — test the lighter socket in the same trip.', owner: 'brian', state: 'open', sev: 'stop' },

  // ── Yours, soon ──────────────────────────────────────────────────────
  { id: 101, title: 'Glance at the Supabase Disk IO graph in a couple of days', why: 'Supabase warned on 3 Sep that the database was burning through its Disk IO budget (slow responses, possible unresponsiveness). Cause found and fixed the same night (migration 087): the hourly hours-ledger rebuild re-read up to 60 days of GPS pings per zone every hour. Nothing to do now — open the project’s Reports → Disk IO once after 5 Sep. Flat and low = done. Still climbing = upgrade compute Micro → Small ($15/mo) in Project Settings → Compute, and tell me.', owner: 'brian', state: 'open' },
  { id: 99, title: 'Optional: free CARTO basemaps key for the retina look', why: 'CARTO now requires a key, so the map moved to Esri’s keyless canvas basemaps on 2 Sep — no more “API KEY REQUIRED” stamps. CARTO’s tiles are sharper on phones and stay crisp zoomed into a yard; the free Esri fallback blurs past zoom 16. If you want them back: carto.com/basemaps/apikey (email + domain hammertrack.ai, one minute, no account) → NEXT_PUBLIC_CARTO_KEY in Vercel → redeploy. Free to 5M tiles a month.', owner: 'brian', state: 'open' },
  { id: 81, title: 'Fix www.hammertrack.ai — visitors get a browser warning', why: 'The certificate served for www only covers the apex, so anyone typing www sees a security warning page. Vercel → project → Settings → Domains → add www.hammertrack.ai as a redirect to hammertrack.ai; the certificate issues itself. hammertrackai.com has no www record at all — add one there too.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 41, title: 'Apple wants three documents', why: 'Apple (Mike, case 20000149520723) cannot verify your identity or your link to HAMMERTRACK LLC. Upload at developer.apple.com/contact/file-upload: driver’s license front AND back, proof you own the LLC, and the SC Articles of Organization. Replies now land in your personal inbox, not brian@hammertrack.ai.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 68, title: 'Check the Twilio toll-free verdict', why: '“In review” is a month old and no verdict email exists anywhere. Twilio console → Regulatory Compliance → Toll-Free Verification. Approved: SMS theft alerts go live and the text claims go back on the splash. Rejected: fix the use-case description and resubmit. The splash was softened to “alert on your phone” on 1 Sep so nothing is claimed that has not delivered.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 43, title: 'Answer KORE: onboarding call + order #2 asks', why: 'Claire (KORE customer success) asked 26 Aug for a time for the onboarding call — unanswered. Reply with a slot, and keep the asks only KORE can answer: the skipped pre-configuration, the 14-devices-to-13-SIMs gap, order #2 pre-config and lead time. docs/TELTONIKA-DEVICES.md already settled the gateway and camera questions.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 45, title: 'Push the real config to every FMM00A (FOTA)', why: 'One FOTA WEB push to all five trucks: enable Green Driving IO (harsh accel/brake for driver grades) and the fast reporting profile — the default 5–15 minute intervals are why some trucks draw straight dashed chords instead of roads.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 1, title: 'QuickBooks connect — 45 minutes', why: 'docs/QBO-GO-LIVE.md is the click-by-click: create the Intuit app, paste four QBO_ vars into Vercel, redeploy, connect from /accounting. Until then the splash, /demo and /pricing label QuickBooks as coming (softened 1 Sep). Connecting flips them back.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 67, title: 'Hire S1 — the model says this month', why: 'The operating model fires S1 in Sep 2026 at zero customers because founder hours are the constraint. One-paragraph job: rolodex hire, $800 base + $200 per activated account, 60-day kill rule. Put it in front of two or three Upstate names.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 83, title: 'Confirm the Play app is registered for developer verification (by 30 Sep)', why: 'Google Play’s final reminder (31 Aug): every Play app must be registered by 30 Sep 2026 or it is removed. Over 99% were auto-registered — open the Play Console home page and confirm com.hammertrack.app reads “registered”. Two minutes.', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 87, title: 'Decide: private home for the prospect list + hardware pricing', why: 'docs/FOUNDING-25.md carried 25 named prospects with personal emails and phones in the public repo; the contact details were redacted 1 Sep but live on in git history. docs/HARDWARE-PRICING.md is labelled confidential and is public too. Move both to Drive and say whether you want the history scrubbed (a force-push everyone re-clones from).', owner: 'brian', state: 'open', sev: 'warn' },
  { id: 65, title: 'Re-upload the Play listing assets', why: 'The live listing still shows raw browser screenshots and no tagline. Paste the short description from docs/APP-STORE-LISTING.md, replace the phone screenshots with store-assets/android-phone/*.png, add the feature graphic, and write the v1.2 What’s New.', owner: 'brian', state: 'open' },
  { id: 70, title: 'Bring the rest of KORE order #1 online', why: 'Five of six OBD units came up 28 Aug. The six TAT141s, three FMM650s, ten Eye Beacons and the last pairing puck still need SIM → FOTA config → scan. /assets/onboard shows each device’s first unfinished step.', owner: 'brian', state: 'open' },
  { id: 71, title: 'Cost rates on the big iron', why: 'Burn Map, Idle $ rings, the insights engine and the owner memo all read $/hr and $/day per machine — without rates on the big iron they tell half a story. The advise-from-specs button gives a starting number.', owner: 'brian', state: 'open' },
  { id: 69, title: 'Turn on the receipt chase (Resend inbound)', why: 'Built 1 Aug, dark since. Resend → enable inbound on hammertrack.ai → webhook to /api/inbound/receipts → whsec_ secret into Vercel as RESEND_INBOUND_SECRET → redeploy → Enable on /receipts, map card last-4s, point the bank’s per-swipe alerts at the inbound address.', owner: 'brian', state: 'open' },
  { id: 72, title: 'Seed the showroom company', why: 'S1 demos on it and /model expects it. docs/SHOWROOM.md: create a fresh account, then /model → Showroom company → Seed. Until then the only demo is the mock stage or DCG’s live books.', owner: 'brian', state: 'open' },
  { id: 84, title: 'Supabase: rerun the security linter', why: 'The advisor flagged two public tables without row-level security (the deploy ledger and the PostGIS reference table). Migration 086 locked the ledger down 1 Sep. Dashboard → Advisors → Security → Rerun linter: the ledger row should be gone; if spatial_ref_sys is the ONLY critical row left, that is expected (owned by the extension — board #98 moves PostGIS out of public). Anything else, send the table name.', owner: 'brian', state: 'open' },
  { id: 85, title: 'One GitHub secret left: CRON_SECRET', why: 'Repo → Settings → Secrets → Actions → CRON_SECRET (Vercel’s value). Lets the daily diag probe read production health again — it has printed “unauthorized” since 26 Aug. (PLAY_SERVICE_ACCOUNT_JSON is in and proven, 3 Sep.)', owner: 'brian', state: 'open' },
  { id: 86, title: 'Turn on Vercel Web Analytics', why: 'The marketing site had no analytics at all — the ad funnel was unmeasured. Two clicks in one sitting: Vercel → project → Analytics → Enable, then add NEXT_PUBLIC_VERCEL_ANALYTICS=1 to the project env and redeploy (the component stays off until then so production consoles stay clean). Cookieless, no banner needed.', owner: 'brian', state: 'open' },
  { id: 73, title: 'Move vendor payments to Mercury', why: 'One named virtual card per vendor. Get Vercel, Supabase, Twilio, Hologram, Workspace, Namecheap, Resend, KORE and Anthropic off personal cards so the LLC’s books are clean from month zero. Vercel and Supabase receipts still land in the personal inbox.', owner: 'brian', state: 'open' },
  { id: 19, title: 'Supabase auth config', why: 'Enable the Google provider and fix the Site URL — it still points at vercel.app, so auth emails and redirects land wrong.', owner: 'brian', state: 'open' },
  { id: 3, title: 'Set the Greenville parcel service URL', why: 'Paste the Greenville County parcel MapServer layer URL (gcgis.org ArcGIS REST directory) into NEXT_PUBLIC_PARCEL_SERVICE_URL in Vercel. Turns on parcel lines and tap-for-owner on the map.', owner: 'brian', state: 'open' },
  { id: 74, title: 'TAT141 solar accessory', why: 'Ask Teltonika Americas (Billy) whether a solar charging accessory exists — at 5-minute tracking the battery alone will not last on machines parked outside; otherwise wire to 12/24 V aux.', owner: 'brian', state: 'open' },
  { id: 75, title: 'Confirm: QSBS / C-corp and equity-gifting conversation', why: 'Carried only on the retired Aug 22 to-do page: CPA on QSBS/C-corp conversion, attorney on equity gifting — the five-year clock only starts when shares exist. Say whether this is still wanted.', owner: 'brian', state: 'open' },

  // ── Build, open ──────────────────────────────────────────────────────
  { id: 100, title: 'OpenFreeMap vector basemaps — crisp at any zoom, no key, no vendor stamp', why: 'The keyless Esri fallback blurs past zoom 16 and CARTO wants a key. OpenFreeMap serves free vector tiles with dark/positron/liberty styles (we already pull its buildings). Rendering the dark base as vector layers under ours ends the raster-provider dependency for good; the B/W and Aubergine tints move to paint on those layers.', owner: 'build', state: 'open', sev: 'warn' },
  { id: 94, title: 'Provisioned-IMEI allow-list — stop IMEI squatting', why: 'sec-check P1: any self-serve signup can quick-add an unclaimed 15-digit IMEI and receive the rightful owner’s telemetry (082 stops the second claim, not the wrong first one). We ship every device, so a provisioned_trackers(imei, company) table filled at shipment, checked by scan/quick-add/bulk import and the flespi ingest, closes it.', owner: 'build', state: 'open', sev: 'warn' },
  { id: 95, title: 'Register devices in flespi + device-topic webhook (clone detection)', why: 'sec-check P1: Teltonika identifies a device by IMEI alone, so a clone with a known IMEI can write positions for the real truck. Registering each ident in flespi and subscribing to the device topic means only known devices reach us and flespi flags the connection conflict. The ingest now drops future/ancient timestamps (1 Sep) as the first layer.', owner: 'build', state: 'open', sev: 'warn' },
  { id: 103, title: 'Migration runner: no-transaction marker + lock_timeout for hot-table DDL', why: 'sec-check on 087: the runner wraps each file in one transaction, so CREATE INDEX on asset_locations held a SHARE lock (ingest inserts wait) and the DROP INDEX queued an ACCESS EXCLUSIVE lock behind every map read for the whole file. A leading `-- migrate: no-transaction` marker would allow CREATE INDEX CONCURRENTLY; DROP INDEX on hot tables gets its own file with SET LOCAL lock_timeout and a caught lock_not_available.', owner: 'build', state: 'open' },
  { id: 104, title: 'Debounce zone create/reshape replays', why: 'Every zone save with a changed boundary replays 365 days of the company’s pings through rebuild_zone_usage (service role). Bounded per call since 087, but a member dragging a corner ten times is ten full-history rescans. Skip when the same zone was rebuilt in the last 60 s.', owner: 'build', state: 'open' },
  { id: 96, title: 'Shared timing-safe verifyCronBearer()', why: 'Fifteen cron/diag routes compare the bearer with plain ===. Not exploitable in practice, but one shared helper with the house HMAC + timingSafeEqual pattern is the right shape.', owner: 'build', state: 'open' },
  { id: 97, title: 'Sweep P2 polish batch (1 Sep production QA)', why: '/command HIDE label vs MAP TOOLS tab · /welcome phone card squeeze · /activity dead-end for Admins (hide the link) · report mini-chart axis text · /qr URL wrap · FEMA flood server probe ERR · /finance revenue-per-employee off the placeholder headcount · /assets/onboard “no hardware” copy vs 20 assets · store screenshot “Geofenced” caption re-shoot.', owner: 'build', state: 'open' },
  { id: 98, title: 'Move PostGIS to the extensions schema', why: 'spatial_ref_sys is owned by the extension, so 086 could not enable RLS on it and the Supabase linter will keep one critical row. ALTER EXTENSION postgis SET SCHEMA extensions (check PostgREST search_path first) clears it for good.', owner: 'build', state: 'open' },
  { id: 88, title: 'Absolute last-seen date + time on the assets list', why: 'Brian, Aug 28: tools (and really every asset) should show what day and time they were last seen — not just “3d ago”.', owner: 'build', state: 'open' },
  { id: 89, title: 'Ping-dots layer on the timeline', why: 'An option to draw every true GPS fix as a dot, so a trail can be read against the raw pings. Honest about rollups past 30 days.', owner: 'build', state: 'open' },
  { id: 90, title: 'Shared requireEdit() gate on every asset write action', why: 'deleteAssetAction runs on the service client with no role check; one shared gate for all asset writes.', owner: 'build', state: 'open' },
  { id: 76, title: 'Convoys into the AI context', why: 'Convoys are on the map but not in what the assistant reads — “who was riding with the RAM at 2 PM” should answer from the same motion-agreement math.', owner: 'build', state: 'open' },
  { id: 80, title: 'Fault codes → work orders', why: 'A stored fault code on a machine should open or annotate a work order the way overdue schedules already do.', owner: 'build', state: 'open' },
  { id: 38, title: 'Scope flespi ingest ident lookup per company', why: 'Mitigated 28 Aug: ingest lookups filter active=true and 082/084 guarantee one active owner per 15-digit IMEI; bulk import refuses cross-tenant collisions. Still open for non-IMEI tracker ids — needs a production duplicate check, then the schema fix on the other write paths.', owner: 'build', state: 'open' },
  { id: 35, title: 'Reconcile setup.sql with the migration series', why: 'setup.sql is still migrations 001–010 concatenated (its own header says so); the series is at 086. Regenerate it from the full series, or point GO-LIVE at scripts/migrate.mjs and retire it.', owner: 'build', state: 'open' },
  { id: 79, title: 'Open-data layers ranked 30 Aug', why: 'FAA TFR + LAANC ceilings (serves the daily Mavic flights), POI tap-for-phone/hours via Nominatim/Overpass, NWS alerts + USGS river gauges for pour/flood. Verified by live probes; boats, freight rail and arrivals boards are honest NOs.', owner: 'build', state: 'open' },
  { id: 78, title: 'iOS push (APNs) after Apple clears', why: 'Capacitor registers APNs tokens; our sender speaks FCM. Either an APNs key in Firebase + the FCM iOS SDK, or teach lib/push.ts APNs HTTP/2 for platform=ios. Post-TestFlight.', owner: 'build', state: 'open' },
  { id: 91, title: 'Memo cron scale past ~25 companies', why: 'The monthly owner memo composes serially; batch or parallelise before the Founding 25 fill up.', owner: 'build', state: 'open' },
  { id: 44, title: 'Tool trailer gateway', why: 'Wired FMM650 inside the trailer plus manifest alerts — “you left the yard with 38 of 40 tags.”', owner: 'build', state: 'open' },
  { id: 42, title: 'Vehicle & equipment camera pilot', why: 'DualCam-class over the Teltonika rails. Research says this likely needs FMC650 (Cat 1), not the FMM650 we own.', owner: 'build', state: 'open' },
  { id: 8, title: 'Zone financials', why: 'Contract bid, change orders and cost-code budgets against the DCG master list.', owner: 'build', state: 'open' },
  { id: 15, title: 'Map wow-pack tier 2', why: 'Bid Ghost, storm-$ ledger, vendor money map, then/now split.', owner: 'build', state: 'open' },
  { id: 16, title: 'Wow-pack P2 follow-ups', why: 'Deferred from the 12 Aug ship-check.', owner: 'build', state: 'open' },
  { id: 21, title: 'UX sweep batch 2', why: 'Deferred audit items.', owner: 'build', state: 'open' },
  { id: 12, title: 'UI polish tier 2', why: 'Motion pass, empty states, haptics.', owner: 'build', state: 'open' },
  { id: 34, title: 'Nationwide parcels add-on', why: 'Evaluate Regrid vs ReportAll and price it as an upsell.', owner: 'build', state: 'open' },

  // ── Shipped ──────────────────────────────────────────────────────────
  { id: 64, title: 'Android v1.2 submitted to Play (2 Sep) · releases now hands-off (versionCode 6 uploaded by the workflow, 3 Sep)', owner: 'brian', state: 'done' },
  { id: 102, title: 'Disk IO diet — hourly ledger rebuild bounded to 3 days, trails rebuild only changed days, two indexes (087/088)', why: 'Also fixed the ledger bug the old rescan hid: usage_daily forgot every site visit that ended before the hourly window’s start on its first day; 088 re-banked 90 days once. Proven equal to a from-scratch build by scripts/ledger-test.', owner: 'build', state: 'done' },
  { id: 93, title: 'Founder audit pass — board refresh, marketing truth sweep, SEO basics, security headers', owner: 'build', state: 'done' },
  { id: 92, title: 'RLS lockdown — deploy ledger + PostGIS table (migration 086)', owner: 'build', state: 'done' },
  { id: 63, title: 'Android v1.2 (versionCode 5) + hands-off Play upload step', owner: 'build', state: 'done' },
  { id: 62, title: 'Launcher icons — navy ground, amber signal arcs', owner: 'build', state: 'done' },
  { id: 61, title: 'Sparse trails drawn honestly + route/plane rate limits', owner: 'build', state: 'done' },
  { id: 60, title: 'Navigation wave — Places, directions, convoys, smooth planes, location primer', owner: 'build', state: 'done' },
  { id: 59, title: 'Store listing pack refresh — real screenshots, tagline, feature graphic', owner: 'build', state: 'done' },
  { id: 58, title: 'App shell opens /map + sign-in polish', owner: 'build', state: 'done' },
  { id: 57, title: 'Map selection & state language — dim the rest, gray the dead, ring the tools', owner: 'build', state: 'done' },
  { id: 56, title: 'Bulk add, spreadsheet style (/assets/import)', owner: 'build', state: 'done' },
  { id: 55, title: 'Scan-to-map onboarding (/assets/scan)', owner: 'build', state: 'done' },
  { id: 54, title: 'Per-asset map icons', owner: 'build', state: 'done' },
  { id: 53, title: 'Monthly owner memo + Ask AI in the chrome', owner: 'build', state: 'done' },
  { id: 52, title: 'Insights engine — 8 detectors, anti-cry-wolf schema', owner: 'build', state: 'done' },
  { id: 51, title: 'Full-site audit + logged-in review fix batch', owner: 'build', state: 'done' },
  { id: 50, title: 'KORE SuperSIM no-cable onboarding playbook, proven on the first FMM00A', owner: 'build', state: 'done' },
  { id: 49, title: 'Showroom company + simulator cron', owner: 'build', state: 'done' },
  { id: 47, title: 'Device onboarding single pane (/assets/onboard)', owner: 'build', state: 'done' },
  { id: 48, title: 'Founder board at /board', owner: 'build', state: 'done' },
  { id: 4, title: 'Exact hours & cost engine (056 ledger)', owner: 'build', state: 'done' },
  { id: 18, title: 'Tow-latency wording — softened to “alert on your phone” pending Twilio', owner: 'build', state: 'done' },
  { id: 39, title: 'Trail rollups + map viz polish', owner: 'build', state: 'done' },
  { id: 37, title: 'Demo realism overhaul', owner: 'build', state: 'done' },
  { id: 36, title: 'Phone gesture wave', owner: 'build', state: 'done' },
  { id: 33, title: 'Map declutter round 2', owner: 'build', state: 'done' },
  { id: 32, title: 'Clock-out replay staleness policy', owner: 'build', state: 'done' },
  { id: 31, title: 'Hand-scrubbable radar timeline', owner: 'build', state: 'done' },
  { id: 30, title: 'Map / layers UX study + fix batch', owner: 'build', state: 'done' },
  { id: 29, title: 'Idempotency & visibility hardening', owner: 'build', state: 'done' },
  { id: 28, title: 'Unified Ask assistant — one brain, three doors', owner: 'build', state: 'done' },
  { id: 27, title: 'In-app help centre + support scaffolding', owner: 'build', state: 'done' },
  { id: 26, title: 'Agent Interface (MCP server)', owner: 'build', state: 'done' },
  { id: 25, title: 'Multi-tenant hardening for customer #2', owner: 'build', state: 'done' },
  { id: 24, title: 'Offline field queue', owner: 'build', state: 'done' },
  { id: 23, title: 'QBO timesheet push', owner: 'build', state: 'done' },
  { id: 22, title: 'Per-company ingest API keys', owner: 'build', state: 'done' },
  { id: 20, title: 'Site-wide UX sweep', owner: 'build', state: 'done' },
  { id: 14, title: 'Map wow-pack', owner: 'build', state: 'done' },
  { id: 13, title: '/command first-switch TypeError', owner: 'build', state: 'done' },
  { id: 11, title: 'Admin-configurable daily log', owner: 'build', state: 'done' },
  { id: 10, title: 'Store listing pack', owner: 'build', state: 'done' },
  { id: 9, title: 'BusyBar across every slow flow', owner: 'build', state: 'done' },
  { id: 7, title: 'Tool presence hours from the pairing log', owner: 'build', state: 'done' },
  { id: 6, title: 'Asset sheet close on phone', owner: 'build', state: 'done' },
  { id: 5, title: 'Zone hours/cost bar chart', owner: 'build', state: 'done' },
  { id: 2, title: 'Migration 055 + auto-migrations', owner: 'brian', state: 'done' },
]

export interface Stage {
  mark: string
  when: string
  title: string
  summary: string
  points: { text: string; tone?: 'ok' | 'wait' | 'no' }[]
  gate?: string
}

/** docs/PATH-TO-1B.md — valuation is arithmetic on ARR, so the stages are
 *  ARR milestones, not dates. */
export const STAGES: Stage[] = [
  {
    mark: '25', when: 'Stage 0 · now', title: "Founding 25 — prove it's a business",
    summary: '25 paying companies, under $100k ARR, near-zero churn. Funded by nothing but the monthly burn and your own time.',
    points: [
      { text: 'Pilot truck live since 6 Jul · Stripe billing live · Mercury live', tone: 'ok' },
      { text: 'Android app live in Play since 21 Aug; v1.2 built 1 Sep, upload pending', tone: 'ok' },
      { text: 'Apple enrollment blocked on identity + LLC documents (31 Aug)', tone: 'wait' },
      { text: 'PM Tier 1 money loop is the next real build', tone: 'wait' },
      { text: 'Zero paying customers today — this is the whole job', tone: 'no' },
    ],
    gate: '25 companies, and 3+ referrals that arrived unprompted.',
  },
  {
    mark: '$1M', when: 'Stage 1 · 2027–28', title: 'Prove distribution repeats',
    summary: '~350 companies at ~$250/mo blended. Valuation roughly $6–10M.',
    points: [
      { text: 'The theft-hook ad funnel, run properly across Upstate SC, then the Charlotte and Atlanta corridors' },
      { text: 'Equipment dealers as resellers — a tracker with every used-iron sale. One productive dealer is 5–15 customers a year, forever. Sign ten.' },
      { text: 'Expansion revenue starts: the $49 and $199 platform tiers lift ACV without new logos' },
    ],
    gate: 'CAC under 6 months of gross profit · net revenue retention above 100%.',
  },
  {
    mark: '$100M', when: 'Stage 2 · 2029–30', title: 'Prove the platform',
    summary: '~2,500 companies, ~$400/mo blended, $10–12M ARR at an 8–10× forward multiple.',
    points: [
      { text: 'Three engines running: SaaS (~60% of revenue), fintech attach, and the data layer' },
      { text: 'The financial layer is what makes a customer worth 3–5× their SaaS fee' },
    ],
  },
  {
    mark: '$1B', when: 'Stage 3', title: 'The arithmetic, not the fantasy',
    summary: '~$90–120M ARR. About 20,000 customers at ~$5k/yr blended — under 3% of just the US construction segment.',
    points: [
      { text: '~750,000 US construction firms with payroll; ~3.5M counting owner-operators; field services roughly double it' },
      { text: 'The risk was never market size — it is distribution and retention' },
    ],
  },
]

/** docs/PRICING-TIERS.md. Run's platform price stays unpublished publicly;
 *  this is the founder view, so it shows. */
export const TIER_ROWS: { label: string; track: string; operate: string; run: string; emphasis?: boolean }[] = [
  { label: 'Who it’s for', track: '"Where’s my stuff"', operate: '"Run my crews on it"', run: '"Run the company on it"' },
  { label: 'Tracked machine', track: '$8/mo', operate: '$8/mo', run: '$8/mo' },
  { label: 'Tool tags', track: '$3/mo', operate: '25 included', run: '100 included' },
  { label: 'Platform fee', track: '$0', operate: '$49/mo', run: '$199/mo', emphasis: true },
  { label: 'Map, theft alerts, geofences', track: '✓', operate: '✓', run: '✓' },
  { label: 'Time clock, logs, QR maintenance', track: '—', operate: '✓', run: '✓' },
  { label: 'QuickBooks sync', track: '—', operate: '✓', run: '✓' },
  { label: 'AI assistant + digest', track: '—', operate: '—', run: '✓' },
  { label: 'Users', track: 'Unlimited', operate: 'Unlimited', run: 'Unlimited' },
  { label: 'Typical customer · 8 machines, 12 tags', track: '$100/mo', operate: '$113/mo', run: '$263/mo', emphasis: true },
]

/** docs/COST-SCALE-2026-07.md */
export const COST_CURVE: { label: string; cells: string[]; emphasis?: boolean }[] = [
  { label: 'MRR', cells: ['$0', '$2,100', '~$11,000', '~$56,000'], emphasis: true },
  { label: 'SIMs in field', cells: ['~15', '200', '800', '4,000'] },
  { label: 'SIM + flespi COGS', cells: ['$5', '~$400', '~$1,360', '~$6,000'] },
  { label: 'Fixed infra', cells: ['$130', '$130', '~$300', '~$900'] },
  { label: 'Stripe fees', cells: ['$0', '~$70', '~$330', '~$1,650'] },
  { label: 'AI usage (Haiku dispatcher + monthly memo)', cells: ['$0', '~$30', '~$150', '~$700'] },
  { label: 'Total cost', cells: ['$135', '~$630', '~$2,140', '~$9,250'] },
  { label: 'Gross margin', cells: ['—', '70%', '81%', '83%'], emphasis: true },
]
export const COST_COLS = ['Now (pilot)', '25 customers', '100', '500']

/** docs/OPERATING-MODEL.md — the step-jumps in the cash curve. S1 is the one
 *  deliberate exception to the trigger rule: it fires at zero customers
 *  because the constraint it relieves is founder hours, not demand. */
export const HIRES: { role: string; trigger: string; cost: string; when: string; note?: string }[] = [
  { role: 'S1 — PT field sales & install', trigger: '0 customers — founder hours are the binding constraint, not demand', cost: '$800 base + $200/account', when: 'Sep 2026',
    note: 'DUE NOW — no hire recorded as of 1 Sep. Hired for the rolodex, comp weighted to commission. 60-day kill rule: under 8 demos/mo or 3 activated accounts → pure commission or part ways.' },
  { role: 'H1 — PT installer / support', trigger: '30 customers', cost: '—', when: 'absorbed by S1',
    note: 'Grow S1\u2019s hours at the 30-customer trigger instead of adding a second person.' },
  { role: 'H2 — FT ops / install tech', trigger: '90 customers', cost: '$5,400', when: 'Jul 2028' },
  { role: 'H3 — PT admin / CS', trigger: '110 customers', cost: '$1,200', when: 'Oct 2028' },
]

/**
 * The outreach plan — docs/BUSINESS-PLAN.md Phase 1 plus the Aug 28 S1
 * amendment. Ordered by expected yield, which is also the order to work it:
 * warm names first, because a beachhead is defined by who returns your calls.
 */
export const SELLING_MOTION: { step: string; detail: string }[] = [
  { step: 'The 25-name list', detail: 'Personal demo on YOUR live fleet, on your phone, at their yard. Close rate should be 40%+ with the Founding 25 offer.' },
  { step: 'Local dealer pilots (2)', detail: 'Free tracking on two Upstate dealers\u2019 rental fleets. Rental theft is THEIR pain — when it saves them once, they become the channel.' },
  { step: 'Contractor Facebook groups', detail: 'Where Upstate crews already talk. The theft hook travels by word of mouth in these faster than by ad spend.' },
  { step: 'The theft-hook ad funnel', detail: 'Facebook/Instagram → hammertrack.ai/demo → /register. Ad variants written and waiting in marketing/ad-variants.md.' },
]

export const S1_SHAPE: { label: string; value: string }[] = [
  { label: 'Who', value: 'ONE part-time field sales & install person, hired for their rolodex — dealer counter or sales guy, rental coordinator, retired super. Someone Upstate contractors already return calls from.' },
  { label: 'What they do', value: 'Demo on the showroom company, close with the DCG field-report one-pager, and do the first install on the spot — the offer\u2019s "first install done with you" becomes their job.' },
  { label: 'Comp', value: '$800/mo base (10–15 hrs/wk) + $200 per activated account + $1,000 bonus at 25. All-in ≈ $336/account at pace; payback stays ~6 months at founder-pricing margin.' },
  { label: 'Founder keeps', value: 'The first 3 demos (pitch calibration), the warm-intro list, and the account-level tasks — Twilio verdict, QBO keys, showroom seed.' },
  { label: 'Kill rule', value: '60 days. Fewer than 8 demos/month or 3 activated accounts → restructure to pure commission or part ways.' },
  { label: 'Cash', value: '~+$2.4k/quarter pre-close burn. Worst-case cumulative drawdown moves ~$8.5k → ~$11k. Still self-funding.' },
]

/** docs/COMPETITORS.md — the Aug 24 recon. Sell on friction, not features. */
export const COMPETITORS: { name: string; note?: string; price: string; friction: string; lead?: boolean }[] = [
  { name: 'Tenna', note: 'John Deere-owned since ~Feb 2026', price: '$15–30/asset, quote-only', lead: true,
    friction: '$5k–20k implementations. They do have BLE tags and claim QuickBooks now — sell on implementation cost, contract friction and small-crew fit, not missing features.' },
  { name: 'Samsara', price: '$27–60/vehicle', friction: 'Three-year contracts; small fleets prepay all three years up front.' },
  { name: 'Verizon Connect', price: '$23–45/vehicle', friction: '36-month auto-renew and a contract-trap reputation.' },
  { name: 'GPS Trackit', price: '$24–36/vehicle', friction: 'Month-to-month, but a leased-hardware exit trap.' },
  { name: 'FleetWatcher', note: 'AlignOps', price: '—', friction: 'Paving e-ticketing and hauler logistics. Heavy setup, different buyer.' },
]

export const VENDORS: { name: string; state: 'live' | 'warn' | 'stop' | 'idle'; stateLabel: string; note: string }[] = [
  { name: 'Mercury', state: 'live', stateLabel: 'live', note: 'Approved 5 Aug. One named virtual card per vendor. The opening deposit is owner capital, not income.' },
  { name: 'Stripe', state: 'live', stateLabel: 'live', note: 'Subscriptions live since 31 Jul — $8 machine / $3 tag prices, webhook wired. Founding-25 pricing applied per company.' },
  { name: 'Google Workspace', state: 'live', stateLabel: 'live', note: 'hammertrack.ai · sales@, hello@ and support@ all verified receiving.' },
  { name: 'Supabase', state: 'live', stateLabel: 'live · linter rerun due', note: 'Pro; billing entity is the LLC. The security advisor flagged two public tables without RLS on 31 Aug — fixed by migration 086 on 1 Sep. Rerun the linter to confirm it reads clean.' },
  { name: 'Vercel', state: 'warn', stateLabel: 'www broken', note: 'Apex healthy, auto-deploys master, migrations run on every build. www.hammertrack.ai serves the apex-only certificate → browser warning; add www as a redirect domain in the project. Web Analytics not yet enabled.' },
  { name: 'D-U-N-S', state: 'live', stateLabel: 'issued', note: 'Landed early Aug. Unblocks both app-store organisation accounts. Never file again — duplicates are slow to merge.' },
  { name: 'Twilio', state: 'warn', stateLabel: 'verdict unchecked', note: 'Toll-free verification has read “in review” since 30 Jul and no verdict email exists anywhere. Check the console. Voice still has no greeting — do not publish the number.' },
  { name: 'KORE', state: 'stop', stateLabel: 'invoice + call', note: '14 Aug invoice, card declined 18 Aug — status unknown. 13 SuperSIMs activating in KORE One; onboarding call unanswered since 26 Aug; connectivity agreement still pending in their system.' },
  { name: 'Google Play', state: 'live', stateLabel: 'app live · v1.2 in review', note: 'Organization account; com.hammertrack.app in Production since 21 Aug. v1.2 (versionCode 5) submitted 2 Sep. Releases are hands-off: the android-release workflow uploads itself (proven on the internal track 3 Sep). Confirm the developer-verification registration before 30 Sep. Listing still shows raw browser screenshots.' },
  { name: 'Google Ads', state: 'stop', stateLabel: 'paused', note: 'Account paused 31 Aug — advertiser verification incomplete by the deadline. Finish the verification tasks before any campaign can run.' },
  { name: 'Apple Developer', state: 'warn', stateLabel: 'docs requested', note: 'Apple replied 31 Aug: identity + LLC association not verifiable from the 27 Aug batch. Upload DL front+back, employment/ownership proof, and an LLC formation document at developer.apple.com/contact/file-upload (case 20000149520723).' },
  { name: 'Resend', state: 'warn', stateLabel: 'inbound off', note: 'Outbound email live (invites, digests, memo). Inbound is not enabled, so the receipt chase built 1 Aug has never fired.' },
]

export const ENV_PENDING: { text: string; tone: 'no' | 'wait' }[] = [
  { text: 'QBO_* — no customer can connect QuickBooks until this ships (docs/QBO-GO-LIVE.md)', tone: 'no' },
  { text: 'NEXT_PUBLIC_CARTO_KEY — optional: swaps the Esri fallback basemaps for CARTO’s retina tiles (board #99)', tone: 'wait' },
  { text: 'RESEND_INBOUND_SECRET — the receipt chase fails closed until it is set', tone: 'no' },
  { text: 'PLATFORM_OWNER_EMAILS — until it is set, the founder-page gate falls back to a weaker @hammertrack.ai domain check', tone: 'no' },
  { text: 'CRON_SECRET in Vercel — verify it is set: usage, trail-rollup, insights and memo crons all fail closed without it', tone: 'wait' },
  { text: 'GitHub Actions secret CRON_SECRET (diag probe) — PLAY_SERVICE_ACCOUNT_JSON is in', tone: 'wait' },
  { text: 'NEXT_PUBLIC_PARCEL_SERVICE_URL — turns on parcel lines and tap-for-owner', tone: 'wait' },
  { text: 'Supabase Auth Site URL still points at vercel.app, so auth emails land wrong', tone: 'wait' },
]

export const ENV_LIVE: string[] = [
  'Auto-migrations run on every master build — pushing a migration file IS the migration',
  'flespi channel 1401177 → webhook → ingest, verified end to end',
  'hammertrack.ai on Vercel since 5 Aug; the .com 301s to it; Workspace MX intact',
  'Stripe billing, Resend outbound and push registration all wired',
  'android-release builds a signed AAB from the 4 ANDROID_* secrets — proven on v1.2, 1 Sep',
]

export const RULES: { name: string; text: string }[] = [
  { name: 'Checks & balances', text: 'One reviewer pass (ship-check, truth-check, sec-check) per day that had major changes, scoped to that day’s diff — never a merge gate. Ship, review, fix what is real in a follow-up commit.' },
  { name: 'Release rule', text: 'Native-affecting merges bump versionCode/versionName and dispatch android-release without asking (Brian, 31 Aug). Play rejects a reused versionCode — jump higher when in doubt. iOS stays manual until Apple clears.' },
  { name: 'Sync rule', text: 'Any roadmap, to-do or cost change updates the system-map infographic, this board and the cost docs in the same commit. The graphic is a view of the roadmap; never let them drift.' },
  { name: 'Splash truth', text: 'Nothing on a marketing page may claim functionality that does not exist. Roadmap items say ROADMAP; shipped items may say LIVE. Every session that ships or re-scopes a feature re-audits the splash in the same commit.' },
  { name: 'Pricing sync', text: 'Any change to tiers, Founding-25 terms or the pilot offer updates /pricing, the splash ladder, /demo, the billing guide and the tiers doc — all in one commit.' },
  { name: 'Testing rule', text: 'Anything touching timeline, radar or history gets clicked through every range on both /map and /command. Nothing animates while the timeline is stopped.' },
  { name: 'Ship-to-live', text: 'Once validated, open the PR and squash-merge to master without asking. Live is where Brian reviews.' },
]

/** Standing marketing exposure — claims that are currently ahead of reality.
 *  Kept on the board so they can't quietly age. */
export const TRUTH_WATCH: string[] = [
  'QuickBooks is labelled “coming” on every public page as of 1 Sep — the integration is built; the Intuit app is not. Connecting (docs/QBO-GO-LIVE.md) flips the copy back.',
  'Theft-alert copy says “alert on your phone within minutes” (push), not “text” — the toll-free verdict is unconfirmed. Approved verdict → texts go back on.',
  'The receipt-chase “seconds after the swipe” line describes a built feature that is dark until Resend inbound is enabled.',
]

export const DOC_INDEX: { group: string; files: string[] }[] = [
  { group: 'Money', files: ['PRICING-TIERS.md', 'UNIT-ECONOMICS.md', 'COST-SCALE-2026-07.md', 'OPERATING-MODEL.md', 'BUSINESS-PLAN.md', 'QBO-GO-LIVE.md'] },
  { group: 'Strategy', files: ['PATH-TO-1B.md', 'GROWTH-PLATFORM.md', 'AI-RESILIENCE.md', 'COMPETITORS.md', 'FOUNDING-25.md'] },
  { group: 'Hardware & ops', files: ['DEVICE-ONBOARDING.md', 'TELTONIKA-DEVICES.md', 'FLEET-TELEMATICS.md', 'PROVISIONING.md', 'APP-STORE-PLAYBOOK.md', 'SHOWROOM.md'] },
]

/** Where each class of iron belongs — the allocation that stops someone
 *  carrying an OBD plug out to a Class-8 dash it cannot fit. */
export const IRON: { machines: string; fit: string }[] = [
  { machines: 'Peterbilt 567 · International LF627', fit: 'FMM650 + ALL-CAN300 — the dash is 9-pin Deutsch J1939, an OBD-II plug physically will not fit' },
  { machines: 'Sakai SW990 · LeeBoy 8500C · Sany PQ190', fit: 'FMM650 + CAN for true engine hours, fuel and fault codes' },
  { machines: 'Takeuchi TB235 and battery-only machines', fit: 'TAT141, wired to 12/24 V aux where the machine has it' },
  { machines: 'Light-duty trucks', fit: 'FMM00A in the OBD port — also the BLE gateway that tools ride on' },
]

export const BURN = [
  { amount: '$25', what: 'Supabase Pro' },
  { amount: '$20', what: 'Vercel Pro' },
  { amount: '~$48', what: 'Workspace, domains, mailbox' },
  { amount: '~$37', what: 'Twilio + QuickBooks' },
]

export function taskCounts(tasks: BoardTask[] = TASKS) {
  return {
    open: tasks.filter((t) => t.state !== 'done').length,
    brian: tasks.filter((t) => t.state === 'open' && t.owner === 'brian').length,
    build: tasks.filter((t) => t.state !== 'done' && t.owner === 'build').length,
    done: tasks.filter((t) => t.state === 'done').length,
    total: tasks.length,
  }
}
