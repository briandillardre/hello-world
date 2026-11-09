# HCSS vs HammerTrack — gap check

*Nov 9 2026. Brian, after an HCSS ad ("The unified platform built for Heavy
Civil. One platform, total control."): "Need to make sure we are beating HCSS
on features, usability, cleanliness, and definitely price."*

Where HammerTrack stands, according to CLAUDE.md (Key Files + Features Built).
Where HCSS stands: its own pages plus third-party review and pricing sites,
linked inline. HCSS publishes no prices, so every HCSS dollar figure below is
a third-party estimate. Each figure carries a confidence rating.

**HCSS in one paragraph.** Sugar Land, TX. 4,000+ companies, ~139,600 active
users. Part of Nemetschek's Build & Construct segment, which Nemetschek owns
~72% and Thoma Bravo ~28%
([hcss.com/ai-info](https://hcss.com/ai-info/)). The 2026 lineup sits under
three brands: **HeavyBid** (estimating), **HeavyJob** (field and job cost;
Plans, Safety, Forms and myField moved under it) and **HCSS Fleet**
(Equipment360, Maintenance, Telematics). The site claims 18 of the ENR top 20
transportation contractors as customers. Their ad's "unified platform" line
matches their own copy: "estimating, project management, fleet management,
and safety tools seamlessly connect"
([fieldservicesoftware.io](https://fieldservicesoftware.io/software/hcss/)).
I found no product named "Aviator".

**Corrections to docs/COMPETITORS.md (Aug 24 recon). Fix them there too:**
- HeavyJob **does** list **QuickBooks** among its 45+ accounting interfaces
  ([HCSS interface list](https://hcss.com/heavyjob/heavyjob-interface-software-systems/)).
  The line "a QuickBooks-based GC gets no job-cost story from HCSS" is wrong,
  so stop saying it. What still holds: HCSS's job-cost story needs HeavyJob,
  which is a per-user product with a separate price.
- HCSS Fleet Telematics now includes an **FMCSA eLogs app** and **AI
  dashcams** (harsh braking, phone use, tailgating, forward collision). Its
  hardware comes with a **12-month money-back guarantee**
  ([HCSS Telematics](https://www.hcss.com/products/telematics/)).
- Still true: HCSS has no BLE small-tool tags. The closest thing is a
  battery-powered satellite tracker for non-powered assets.

---

## 1. Module by module

Status key: ✅ built · 🟡 partial · ❌ missing (per CLAUDE.md).

| HCSS module | What it does | HammerTrack equivalent | Who wins, and why |
|---|---|---|---|
| **HeavyBid** (desktop + web) | Unit-price estimating, crew production rates, historical cost database, quotes | ✅ `/plans/[zoneId]/estimate` + `/costbook` (`lib/estimate/engine.ts`): sources ranked by delivered cost with OSRM haul minutes, loads, crew-days, lowboy, overhead/contingency/profit/tax/bond | **HCSS on depth**: decades of DOT unit-price work and a historical production database. **HT on sitework**: haul routing from real road minutes, and the estimate fed straight from the takeoff |
| **HeavyBid Pre-Construction** | Opportunities, project details, bid dates | 🟡 `/jobs` stages Estimating → Bid submitted → Awarded, with bid-due date (`lib/jobs/job.ts`) | Tie. HT has no pipeline view, no win-rate figures and no bid calendar |
| **HeavyJob** (cloud + mobile) | Daily time cards **by cost code** with quantities installed, job cost, PM | 🟡 `/jobs/[zoneId]/cost` (PCAT budget vs actual, WIP), with actuals coming from site time cards, the hours ledger and receipts (`lib/jobs/cost.ts`). Time cards are per **site**. A cost code exists only on budget lines (`155_job_cost.sql`) | **HCSS**. Cost-code hours and daily quantities are HeavyJob's core, and HT has neither (gap #2) |
| **HeavyJob Docs & Plans** (ex-HCSS Plans) | View and mark up sheets, takeoff calculators, collaboration | ✅ Plan room `/plans/...`: title-block reads, revisions and supersede, compare, sheets placed on the map by themselves. Takeoff on the sheets `/plans/[zoneId]/takeoff` with an xlsx export | **HT**. Sheets sit in real location on the live map, and revisions carry the takeoff forward |
| — (no HCSS product found) | Dirt cut/fill from lidar, ground from borings, machine-control files, drone progress | ✅ `/dirt/[id]` (USGS 1 m lidar, exact TIN volumes), `/plans/[zoneId]/ground` (borings), `/plans/[zoneId]/machine` (LandXML/DXF), `/plans/[zoneId]/progress` (drone DSM) | **HT**. No equivalent appears in HCSS's [product list](https://hcss.com/ai-info/) (low confidence: absence is not proof) |
| — (not in the HCSS list) | AIA G702/G703 pay apps, AR aging, cash, WIP | ✅ `/jobs/[zoneId]/billing` (`lib/jobs/payapp.ts`), `/jobs/portfolio` | **HT** for a QuickBooks-sized sub. HCSS leaves billing to the accounting system |
| **HeavyJob Safety** (ex-HCSS Safety) + HCSS Skills | Safety meetings, JHAs, inspections, incidents/near misses, training and certification records | 🟡 Pre-use `equipment_checks`, driver Safety Score (`/reports/safety`), document expiry (`lib/jobs/documents.ts`). No JHA, toolbox talk, incident log or cert tracking | **HCSS** (gap #4) |
| **HeavyJob Forms** | Digital forms with signatures, central records | 🟡 Daily logs with a configurable form (`LOG_FORM_DEFAULTS`, required photos). One form type, no signatures | **HCSS** (gap #5) |
| **HeavyJob Resource Planner** + **HCSS Dispatcher** (desktop) | Crew and equipment schedule, magnet board, equipment moves, rentals | ❌ HT shows where things **are** (live map, Stacks, Command Center). It does not schedule where they **go** | **HCSS** (gap #3). HT's live position is the better input for a board, but the board itself doesn't exist yet |
| **HCSS myField** (mobile) | Worker time, breaks, schedules, safety and maintenance requests | ✅ Clock with required GPS fix, background shift recorder, integrity flags, photo clock-in (`components/field/ShiftTracker.tsx`, `/timecards`, `lib/timecards.ts`) | **HT** on proof: GPS-verified %, "Needs a look" flags, shared-phone detection. **HCSS** on breaks and schedules |
| **Equipment360** (desktop) | Shop management: repairs, WOs, PM, parts, inspections | 🟡 Maintenance schedules plus work orders with parts and labor costs (`lib/db/maintenance.ts`, migration 050). No parts inventory, no shop labor board | **HCSS** on shop depth (gap #7). **HT** on readings arriving by themselves (live engine hours/miles, OEM AEMP feed, DTC count) |
| **HCSS Fleet Maintenance** (ex-MaintenancePro, cloud) | PM and repair requests | ✅ same as above, plus overdue → auto work order and wrench badges on the map | Tie, with HT ahead on the map |
| **HCSS FuelerPlus** (desktop) | Fuel and fluid top-offs, servicing log | 🟡 `/receipts/fuel`: card/bank CSV reconciled against the truck's GPS and gauge. No fuel-truck dispensing log | Split. **HT** catches fuel fraud. **HCSS** logs what a fuel truck dispenses (gap #8) |
| **HCSS Fleet Telematics** | GPS, engine hours, idle; plug-in, wired and satellite hardware; 30+ OEM feeds | ✅ Live map, OBD + wired + battery units through flespi, AEMP/ISO 15143-3 OEM pull (`lib/aemp*.ts`), telemetry catalog with dials (`lib/telemetry-catalog.ts`), theft and after-hours alerts, power-loss detection | **HT** on the live map, BLE tools that ride trucks, phones as gateways, and price. **HCSS** on OEM breadth (30+) and satellite units for no-cell sites |
| **HCSS Fleet Telematics eLogs** | FMCSA HOS + DVIR | 🟡 `/timecards/short-haul` (395.1(e) records, 8-in-30 counter); partner plan for a real ELD (`docs/ELD.md`) | **HCSS** for drivers who need an ELD. Most of DCG's drivers don't (short-haul exemption) |
| **HCSS Shield & Dashcams** | AI dashcam, driver coaching | ❌ Pilot planned (board #181, `docs/DASHCAMS.md`) | **HCSS** (gap #9) |
| **HCSS Insights** (Power BI, 80+ dashboards) | BI reporting | ✅ Insights engine (`lib/insights.ts`), monthly owner memo (`lib/memo.ts`), `/reports`, `/finance` benchmarks and valuation | **HT** for an owner who won't open Power BI. **HCSS** for an analyst who will |
| **HCSS AI Assistant** (free) / **AI Studio** (beta Fall 2026, paid) | Plain-language Q&A over job data and documents | ✅ Ask AI (Sonnet 5, voice input) + MCP door `/api/mcp` for the customer's own AI | **HT**: shipping now, with tools over live data and an open MCP door. HCSS's agents are still in beta |
| **HCSS Chats** | In-app messaging and files | ❌ Only "Share this view" with in-app push (`components/map/ShareViewSheet.tsx`) | **HCSS** (low stakes) |
| **Marketplace / 45+ accounting interfaces**, TrueUp, payroll export | Sync to ERP, accounting and payroll | 🟡 QuickBooks Online only (`lib/qbo.ts`: invoices, expenses, receipts with attachments, TimeActivity push). **Production connect is not live** (CLAUDE.md item 7), plus CSV exports | **HCSS** today (gap #1) |
| **HCSS Cloud Hosting** | Hosts the desktop apps | n/a: HT is web-native (Vercel + Supabase) and has nothing to host | **HT**. Having to pay to host desktop software is the legacy cost itself |
| — | BLE small-tool tags, people on the map, Divisions, per-asset visibility, flight log | ✅ (`lib/ble-sightings.ts`, `lib/db/divisions.ts`, migration 111) | **HT** |

---

## 2. Price

**HCSS does not publish prices**: the [pricing page](https://www.hcss.com/pricing/)
is a quote form, and HeavyBid has no free trial
([OneCrew](https://www.getonecrew.com/post/hcss-heavybid-pricing)).

| HCSS item | Number | Source | Confidence |
|---|---|---|---|
| Suite, per user | **$60 – $4,000+ per user per year**; an Unlimited User Plan exists; the AI Assistant is free | [hcss.com/ai-info](https://hcss.com/ai-info/) (HCSS's own page) | **High** that the range is real; low on where any one module lands in it |
| HeavyBid, 1 estimator | ~$3,195/user/yr (SelectHub) · ~$4,000/yr (ITQlick) | [SelectHub](https://www.selecthub.com/p/construction-estimating-software/heavybid/) · [OneCrew citing ITQlick](https://www.getonecrew.com/post/hcss-heavybid-pricing) | Medium. Two sources agree in the low thousands |
| HeavyBid, ~10 users | $25k–$40k/yr; maintenance 15–20% of license if bought as a license | [OneCrew/ITQlick](https://www.getonecrew.com/post/hcss-heavybid-pricing) · [ITQlick](https://www.itqlick.com/heavybid/pricing) | Low (ITQlick figures are partly AI-derived) |
| HeavyJob | from ~$86/user/mo billed yearly (SpotSaaS); another listing says $49/mo | [SpotSaaS](https://www.spotsaas.com/product/hcss-heavyjob/pricing) · [Software Advice](https://www.softwareadvice.com/job-costing/heavyjob-profile/) | Low. The sources conflict |
| HCSS Fleet Telematics | ~$11–20/asset/mo **plus hardware**, billed monthly per asset | [Capterra](https://www.capterra.com/p/139514/HCSS-Telematics/pricing/) · [AirPinpoint](https://app.airpinpoint.com/compare/airtags-vs-hcss) (a competitor's page) | Medium on $11, low on $20 |
| Equipment360 | Quote only | [Software Advice](https://www.softwareadvice.com/cmms/equipment-360-profile/) | — |
| Implementation, training, migration | $5k–$50k+ (HeavyBid); telematics $1k–5k small, $10k–50k large | [OneCrew/ITQlick](https://www.getonecrew.com/post/hcss-heavybid-pricing) · [Capterra Telematics](https://www.capterra.com/p/139514/HCSS-Telematics/) | Low |
| Contract | License or subscription; a web subscription option for desktop customers was reported in the Fall 2026 release; renewal terms only in the quote | [fieldservicesoftware.io](https://fieldservicesoftware.io/software/hcss/) · [yespress](https://yespress.io/hcss) (single source) | Low |

**HammerTrack (published, /pricing):** $8/machine and $3/tool tag. Track has
no platform fee. Operate adds $49/mo with 25 tags included. Run is quoted
("talk to us"). Founding 25 pays $6/machine + $3/tag with Operate included.
All tiers: **$0 setup, unlimited users, month-to-month.**

**Worked example**, 20 machines, 1 estimator, 8 field logins, from the low end
of the HCSS estimates:

| | Year 1 |
|---|---|
| **HCSS**: HeavyBid ~$3.2k + HeavyJob 8 × $86 × 12 ≈ $8.3k + Telematics 20 × $11 × 12 ≈ $2.6k + hardware + implementation (≥ $5k) | **≈ $19k+**, and climbing fast at mid-range numbers (low confidence) |
| **HammerTrack Operate**: 20 × $8 + $49 per month, $0 setup | **≈ $2.5k** (Founding 25: ≈ $1.4k) + hardware at cost |

**Caveat that matters.** The HCSS bundle above includes estimating and job
cost. HammerTrack's estimate, plan room, jobs, pay apps and dirt takeoff are
**not placed in a tier or priced yet** (the dirt add-on is "ask us", board
#184). Publish the like-for-like comparison only once those have a price.
Until then, keep the public claim to the standard line ("about half the price
of Tenna, $0 setup"). Never publish a Run total (pricing sync rule).

---

## 3. Usability and cleanliness

| HCSS complaint | Source | Already answered by HammerTrack? |
|---|---|---|
| Price is the main con: "the only drawback … is the price"; "could no longer justify the amount" | [Capterra HeavyJob reviews](https://www.capterra.com/p/140170/HeavyJob/reviews/) | ✅ Published per-asset price, unlimited users, $0 setup |
| Extra fees for remote users' features | [Capterra HeavyJob](https://www.capterra.com/p/140170/HeavyJob/reviews/) | ✅ No per-seat or per-feature metering (PRICING-TIERS rule) |
| License plus Cloud hosting "very expensive"; cost hard to justify when staffing fluctuates | [TrustRadius](https://www.trustradius.com/compare-products/4clicks-project-estimator-vs-hcss) · [G2](https://www.g2.com/products/hcss/reviews) · [GummySearch (Reddit)](https://gummysearch.com/tools/best-products/estimating-software/) | ✅ Web-native, so there is nothing to host |
| HeavyBid "DOS-based and outdated"; "years, perhaps decades, behind" | [Capterra HeavyBid reviews](https://www.capterra.com/p/34221/HeavyBid/reviews/) (older reviews; HeavyBid on the web is new) | ✅ One responsive web app + Android shell, deployed live |
| Steep learning curve (foremen especially); about a month of training | [Capterra HeavyJob](https://www.capterra.com/p/140170/HeavyJob/reviews/) · [Software Advice](https://www.softwareadvice.com/job-costing/heavyjob-profile/reviews/) | 🟡 Scan-to-map onboarding, Bulk add from a spreadsheet, plain-word UI, /help guides. Unproven at HCSS feature depth: keep the foreman's screen to one tap |
| Mobile time cards have to be **pulled manually** into desktop | [Software Advice](https://www.softwareadvice.com/job-costing/heavyjob-profile/reviews/) | ✅ One database, live. An offline queue replays with honest timestamps |
| Multiple divisions needed "multiple configurations" | [Capterra HeavyJob](https://www.capterra.com/p/140170/HeavyJob/reviews/) | ✅ Divisions inside one company (migration 106), one filter rule everywhere |
| Telematics mobile site "difficult to navigate"; OBDII data "can be limited" | [Capterra Telematics](https://www.capterra.com/p/139514/HCSS-Telematics/) · [SoftwareFinder](https://softwarefinder.com/fleet-management-software/hcss-telematics/reviews) | ✅ Map-first phone UI. The telemetry catalog shows every reading, and lists what a truck does *not* report |
| Desktop-only modules (Equipment360, FuelerPlus, Dispatcher) | [hcss.com/ai-info](https://hcss.com/ai-info/) | ✅ Everything runs in the browser and the app |
| No public prices, no trial | [HCSS pricing](https://www.hcss.com/pricing/) · [OneCrew](https://www.getonecrew.com/post/hcss-heavybid-pricing) | ✅ /pricing published; demo mode and /live run with no signup |

Where HCSS reviews are *good*, don't claim otherwise. The HeavyJob mobile app
is called "easy to use … very stable" (Capterra), support runs 24/7/365 from
staff in Texas, and the domain depth is decades deep.

---

## 4. Gaps ranked for a small–mid heavy civil / sitework contractor (DCG-sized)

1. **QuickBooks Online is not connected in production.** The money loop is the
   moat, and no customer can switch it on yet (CLAUDE.md item 7). HCSS
   already lists QuickBooks. *Build:* finish docs/QBO-GO-LIVE.md this week,
   then sell "HCSS's time cards land in QuickBooks; ours land as job cost,
   pay apps and receipts too."
2. **Cost-code time cards and daily quantities.** This is HeavyJob's whole
   reason to exist. *Build:* a cost-code picker on clock-in and the daily log
   (codes come from `job_budget_lines`), crew and machine hours split by code
   (machines from the hours ledger), quantity installed per code per day, and
   unit cost vs bid on `/jobs/[zoneId]/cost`.
3. **Resource planner / dispatch board.** *Build:* `/dispatch` as a week grid,
   sites × people and machines. Drag to assign, lowboy moves as tasks, and
   the live map marking any assignment the GPS contradicts. That last part is
   something HCSS can't do.
4. **Safety program: JHAs, toolbox talks, incidents, certifications.** GCs
   and insurers ask for these papers. *Build:* safety forms on the daily-log
   form engine, an incident record pinned on the map, and certification
   records per person using `expiryState`.
5. **Custom forms with signatures.** *Build:* generalize the daily-log form
   into N company forms with a finger signature, a PDF output, and filing on
   the job's Documents tab.
6. **Production history into the estimate** (HeavyBid's historical database).
   *Build:* once #2 exists, bank actual $/unit and units/crew-day per item
   code and show "your last 5 jobs" beside each costbook rate.
7. **Shop depth: parts inventory and the mechanic's board** (Equipment360).
   *Build:* a parts table (on hand, reorder point, cost) drawn down by work
   order parts, plus a mechanic's day view.
8. **Fuel-truck dispensing log** (FuelerPlus). *Build:* on the fueler's
   phone, pick the machine on the map, enter gallons, take the meter reading
   from live hours. Feeds the fuel check and job cost.
9. **Dashcams and a real ELD.** Lower for DCG (short-haul covers most
   drivers). *Build:* run the CV200 pilot (#181) and the ELD partner plan
   (#183 / `docs/ELD.md`). Don't build a registered ELD.
10. **Bid pipeline view** (Pre-Construction). *Build:* a `/jobs` board filtered
    to Estimating/Bid submitted, with a bid-due calendar and win rate by
    customer.
11. **OEM breadth and satellite trackers.** *Build:* add AEMP presets as
    customers ask. Resell a satellite unit only on request.
12. **Chats.** Skip. Texts and push already work, and a chat tool would be
    noise.

**Where HammerTrack already beats HCSS, so lead with these:** the live map
with tools riding trucks and phones as gateways, plans placed in real location,
dirt takeoff from lidar, borings, machine files, drone progress, G702/G703 pay
apps, GPS-verified time cards, an AI with an open MCP door, unlimited users,
published price, and $0 setup.
