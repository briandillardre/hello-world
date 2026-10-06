# Insurance & Telematics — scores insurers trust, how they take the data, how HammerTrack gets paid

*Oct 6 2026. Research only — no app code. The insurance side of the driver-safety
score (the score engine is being built separately; §3 is the spec the insurance
side needs from it). Builds on `docs/GROWTH-PLATFORM.md` §5 — discount referrals →
embedded agency → maybe MGA, **never carry risk**. HAMMERTRACK LLC is a South
Carolina single-member LLC, so SC law is the first lens. **Not legal advice:** §5
lists what an SC insurance-regulatory lawyer and an FCRA/privacy lawyer must
confirm. Every fact carries a numbered source (list at the bottom). "Unverified" =
not confirmed from a primary source. "Excerpt" (in the source list) = read through a
search-engine excerpt because the page refused a direct fetch.*

---

## The 5-minute read

**The market (Oct 2026)**

1. **Commercial auto is the line carriers lose money on** — 14 straight years of
   underwriting losses; in 2024 liability ran a 113 combined ratio and the segment
   lost $4.9B [1]. They want better risk selection.
2. **Yet almost nobody prices small fleets on telematics.** Fewer than 5% of
   commercial policies are priced with telematics although more than 30% of
   commercial vehicles are connected [2]. Only 30% of fleets share data with
   their insurer, and **79% of the ones that don't say nobody asked** [3].
3. **Discounts are modest and two-way.** Small-fleet credits run 3–10%: Progressive
   3% for shared Samsara data [4], 5% minimum / 8% typical / 18% max on
   Snapshot ProView [5], The Hartford up to 5% per vehicle [6],
   Nationwide 10% [7], GEICO up to 10% up front [8]. The 20–30%
   headlines are trucking insurtechs at renewal (Nirvana, HDVI, Cover Whale)
   [9], [10], [11]. Progressive and GEICO can **raise** a rate on
   bad data (GEICO up to a 10% surcharge) [5], [8].
4. **Carriers integrate with the big TSPs; small TSPs get in through aggregators.**
   Progressive's preferred ELDs are Geotab, Motive and Omnitracs [12]. CMT
   DriveWell Fleet (Jan 2026) normalizes TSP data for commercial carriers and covers
   80%+ of connected commercial vehicles [2]; Draivn claims 300+ TSPs
   [13]; Terminal 290 [14]; Cover Whale connects customers' ELDs
   **through Terminal** [15]. **Linxup — a direct small-fleet competitor
   (`docs/COMPETITORS.md`) — joined CMT (Jan 2026) and Draivn (May 2026)**
   [2], [16].
5. **Telematics vendors make insurance money from subsidies, not commissions.** Motive:
   40+ insurer partners, discounts up to 22% **or an average $240/vehicle/yr
   subsidy** [17]; Northland (a Travelers company): up to $300/vehicle/yr
   [18], [19]. We found no sign that Samsara or Motive act
   as insurance agencies (unverified absence).
6. **Selling driver data is a liability, not a revenue line.** Verisk paid automakers
   26–61¢ per car [20], then shut its driving-behavior report in June
   2024 [21]; the FTC barred GM from giving driver data to consumer
   reporting agencies for 5 years (Jan 2026) [22]; parts of the FCRA claims
   against LexisNexis and Verisk survived dismissal in April 2026 [23]; Texas
   sued Allstate/Arity under its privacy law [24].
7. **Underwriters credit use, not installation:** a 12-month trend, rates per 1,000
   miles, and coaching records [25]; bring ≥90 days of documented trend data
   [26]. Travelers' original fleet credit required driver feedback at least
   quarterly [27].
8. **"Harsh braking" for the same pickup starts anywhere from 0.28 g to ~0.68 g
   depending on the vendor** — Teltonika's default 0.28 g, Geotab's GPS rule 0.28–0.30 g,
   Geotab's old accelerometer rule 0.61 g, Samsara's "normal" ≈0.68 g (excerpt)
   [28], [29], [30], [31]. Raw event counts are not
   comparable across vendors — publish our thresholds and keep the raw data.
9. **Our hardware ships with harsh-event detection off.** Teltonika's Green Driving
   scenario is disabled by default and defaults to the GPS source [28];
   today's A–F grade is speed-only (`lib/scorecard.ts`). Turning it on (accelerometer
   source + auto-calibration [32]) is device config, not code.
10. **SC rules for getting paid:** unlicensed, we may take only fees *not based on
    completion of a sale* (§38-43-200(D)) [33]; commission needs a license, which
    is cheap here ($40 agency + one licensed producer; $25 producer license + exam +
    SLED check) [34], [35]. Since May 2024 SC lets insurers
    give policyholders loss-control products free or discounted (§38-57-130(5))
    [36] — the legal basis for an insurer-paid HammerTrack subscription.

**What to do now** — the 5 steps are at the end of §6. In one line: turn on
insurer-grade event capture, ship the score + an insurer report on our own fleet's
next renewal, and get listed with two aggregators before chasing any carrier.

**Splash truth rule:** no insurance-savings claim on any marketing page until a
named program has actually accepted HammerTrack data for a customer.

---

## 1. How commercial auto insurers use telematics with small fleets

| Carrier · program | What data, how it arrives | What the fleet gets | Can HammerTrack plug in? |
|---|---|---|---|
| **Progressive · Smart Haul** (for-hire trucking) | ELD data pulled through the ELD vendor with permission at quote; needs a USDOT # and a for-hire policy [12]; the HOS/location data the ELD rule already collects [37] | ≥5% at new business with a preferred ELD (Geotab, Motive, Omnitracs); "15% or more" with an established record; $1,261 average saving (new customers, Feb–Aug 2025); renewal can go up or down [12], [38] | **No** — ELD-only; we are not, and won't be, a registered ELD (`docs/ELD.md`) |
| **Progressive · Snapshot ProView** (non-ELD small business) | Progressive's own plug-in device in every eligible vehicle (speed, location, time) [5] | 5% for enrolling; many 8%, some 18%; fleet dashboard at 3+ vehicles; premium can rise at renewal [5], [38] | **No data door.** Customers can still enroll, but their device and our FMM00A both need the OBD port (our inference — check a splitter) |
| Progressive · data shared from Samsara | Samsara account data, by customer agreement [4] | 3% [4] | Only if Progressive built a HammerTrack connector |
| **Nationwide · Vantage 360 Fleet** | Nationwide's app + Bluetooth windshield tag + portal, built on CMT's DriveWell Fleet [39]; 100-point score over the last 2 weeks: speed vs limits, hard braking (>7.7 mph/s), acceleration, cornering, phone use [7] | 10% on select business-auto coverages; **in SC applied at first renewal**; a recorded trip within 45 days or the program drops off [7] (2021 flier); not in CA, DE, MA, NJ, NY, WA [40]. "Discount-only" is claimed by a review site — unverified | No data door (carrier's own app + tag) |
| **GEICO · DriveEasy Pro** | GEICO's OBD device or road-facing dashcam, or a connection to the fleet's third-party ELD [8]; Motive is the preferred partner (Nov 2025, new policyholders, select states) [41] | Up to 10% up front; at renewal up to 10% more **or up to a 10% surcharge**; scores hard braking, fast acceleration, sharp turns, distance, consistent speeds, late-night 10 PM–5 AM [8] | No (ELD connection only) |
| **The Hartford · Telematics Data Sharing Program** (+ Fleet*Ahead consulting) | Integrations inside Samsara (Apps page) [6] and Netradyne, which needs the fleet's **written approval** to share [42] | Up to 5% per fleet vehicle with qualifying telematics [6] | Only if The Hartford adds us or takes data via an aggregator (unverified) |
| **Travelers / Northland** (Travelers' trucking unit [19]) | 2010: credit for "effective use" incl. feedback to drivers **at least quarterly** [27]; Northland × Samsara (Nov 2024) [18] | Up to 15% on certain auto liability premiums (2010 — current availability unverified) [27]; Northland: up to $300/vehicle/yr camera subsidy or 10% [18] | A broker-delivered report may support the credit (unverified) |
| **Liberty Mutual** · commercial auto Telematics Program | Data collected continuously may adjust the discount; may be shared with service providers [43] (page refused our fetch; details unverified) | Not published | Unknown |
| **Zurich North America** | Risk-engineering partnership with Samsara: fleet program review, driver safety, FMCSA compliance review, continuous MVR monitoring [44]; Zurich policyholders get Azuga savings [45] | No published discount | Via loss control — a good report helps |
| Sentry, RLI, National Indemnity, Acuity, Great West, Kinsale, Inigo, others | Apps in the Samsara and Motive marketplaces [46], [47] | Sentry up to 5% at quote; RLI up to 5% + free cameras; National Indemnity 5–7.5% (marketplace excerpts, unverified) [46] | Only via an aggregator |
| **Nirvana** (telematics-native trucking MGA) | ELD/telematics at quote; 30B+ miles of data; $100M Series D Dec 2025 [9], [48] | Up to 20% up front; Fleet program 10+ power units, Non-Fleet 1–9 [9] | Trucking only — our dump-truck customers at most |
| **HDVI Shift** (trucking) | 90-day "Safety Lookback" sets the first discount, monthly Shift Score after [10]; a Terminal customer [14] | Up to 20% off the monthly premium [10] | Possibly via Terminal (unverified) |
| **Cover Whale** (trucking MGA) | Telematics **mandatory** for auto liability: connect an *approved ELD* through Terminal or install its dashcam, else cancellation; watches speeding, hard braking, hard cornering, **radius of operation and unscheduled vehicles** [15], [49] | Up to 30% off at renewal for the safest drivers [11] | Via Terminal only if a non-ELD GPS feed qualifies (unverified) |
| **LEEO** (ex-Fairmatic, rebranded Dec 15 2025) | Telematics-powered commercial auto MGA [50]; NEMT, light business auto, last-mile; **broker-only** [51] | Renewal credits for safer driving [51] | **Best fit for contractor light-duty fleets** — through an appointed broker; data path unverified |
| INSHUR | Rideshare/delivery commercial auto; plans usage-based and telematics data [52] | — | Not our market |
| Koop | Insurance for autonomy/robotics/tech companies; telematics or L2+ vehicles price better [53] | — | Not our market |
| ERGO NEXT (NEXT Insurance) | Small-business commercial auto; ERGO bought NEXT for $2.6B (2025) [54]; no telematics program found (unverified) | — | Referral/affiliate only |
| Pie / Ford Pro Insure | Offered telematics-based policy modifications [55]; **exited commercial auto** — no new or renewal policies effective on or after Jan 1 2026 [56] | — | A warning: small commercial auto is hard to make pay |

**Patterns that matter for us**
- **Carrier-device programs dominate the non-trucking small-fleet end** (Progressive
  ProView, Nationwide Vantage 360, GEICO DriveEasy Pro). They don't need a TSP — the
  opening is "bring your own device", which is exactly what CMT DriveWell Fleet now
  sells to carriers [2].
- **Trucking programs are ELD-centric** (Smart Haul, Nirvana, HDVI, Cover Whale).
  Contractors' light trucks mostly don't run ELDs, so these fit only our dump trucks.
- **Data rarely reaches carriers on its own:** 70% of fleets don't share and 79% of
  those say nobody asked [57]; only 64% of carriers use the fleet data that
  is available, and many can't process raw telematics at all [58]. A
  one-click report to the fleet's own agent is the gap we can fill first.
- 80% of the top-50 commercial insurers use telematics somehow, but only 4% call
  their programs advanced and 14% have launched usage-based products [3].

---

## 2. Data exchanges and aggregators

| Name | What it is | Who feeds it · how a TSP joins | Money / status |
|---|---|---|---|
| **CMT DriveWell Fleet** (Jan 15 2026) | Normalizes TSP data for commercial carriers' underwriting and pricing; BYO-device plus CMT tags for unconnected vehicles; fleet opt-in consent [2] | Samsara, Verizon Connect, Lytx, Netradyne, GPS Insight, Linxup; 80%+ of connected commercial vehicles, 90% targeted [2]; Geotab Marketplace app Jul 2026 [59]. Join process not public | Not public |
| **Draivn** | "Validated risk exposure" for insurers, MGAs and brokers; consent lifecycle handled for the fleet [13] | 300+ TSPs (Samsara, Motive, Geotab, Verizon Connect…) [13]; Linxup integrated May 12 2026 [16] | Not public |
| **Terminal** | Unified telematics API; fleets consent once, insurers get normalized vehicles, drivers, locations, safety events; acts "only as your data subprocessor" [60], [14] | 290 integrations; a "Partner with us" path for providers; customers include Intact, Milliman, HDVI, Cover Whale, Flock [14] | Not public |
| **SambaSafety** | Telematics aggregation: harmonizes events, maps GPS to roads and speed limits, imputes drivers [61] | 40+ TSP logos (Azuga, Geotab, Lytx, Motive, Netradyne, Samsara, Verizon Connect, Zonar…) [61] | Not public |
| **TruckerCloud** | Turnkey telematics programs for insurers [62] | 40+ ELD and camera systems [62] | Not public |
| **Samsara App Marketplace (insurance)** | Carriers/MGAs build apps on Samsara's open API; the fleet turns them on from its Apps page [46], [6] | 15 insurance partners listed [46]; Samsara "helped build 30+ insurance programs" (2022) [63] | Discounts and subsidies to fleets; Samsara's own take not public |
| **Motive insurance program** | Three models: **subsidy** (cheaper Motive subscription), **discount**, **referral** ("mutual lead referral with potential compensation for qualified leads") [47] | 40+ partners; discounts up to 22% or ~$240/vehicle/yr average subsidy [17] | Subsidy = Motive revenue paid by insurers |
| **Geotab Marketplace** | Fleet consents to share safety and operational data with a chosen carrier; Geotab "does not endorse" [64] | Progressive Smart Haul, HDVI, Cover Whale [64], CMT [59], Verisk add-in (2020) [65] | Fleet discounts "up to 20%" [64] |
| **Verisk Data Exchange** | Fleet and OEM data exchange for personal and commercial carriers; Geotab add-in (2020) [65], TomTom WEBFLEET [66] | OEMs and TSPs by partnership | **Driving Behavior Data History report shut June 2024** after automakers stopped supplying [21]; paid automakers 26–61¢ per car [20], [67]. Commercial status unverified |
| **LexisNexis Telematics Exchange / OnDemand** | OEM + app + "participating third-party" TSP data, normalized and sold at point of quote [68] | OEMs (Kia, Mitsubishi) by consumer opt-in [68] | Sold **as an FCRA consumer-report product** [69]; personal auto focus |
| **Arity** (Allstate) | Driving data from an SDK inside consumer apps | — | Texas AG suit (Jan 2025) under the Texas Data Privacy and Security Act — the first suit under any state comprehensive privacy law [24] |

**Read:** for a small TSP the doors are aggregators, not exchanges. Terminal is the
pipe Cover Whale and HDVI already use [15], [14] (Cover Whale asks for
an *approved ELD*, so a non-ELD feed may not count — ask); CMT is the
bring-your-own-device route for carriers like Nationwide that already run CMT
[39], [2]; Draivn reaches brokers. Nobody publishes a TSP revenue share —
expect **distribution, not data revenue**.

---

## 3. How the leading platforms compute safety scores

| Platform | Events counted | Thresholds / severity (published) | Normalization & window | Weighting & scale | Min exposure | Speeding | Late night |
|---|---|---|---|---|---|---|---|
| **Samsara** Safety Score | Harsh accel/brake/turn, crash, speeding; camera events (following distance, inattention, phone, rolling stop, red light) [70] | Harsh brake "Normal" ≈0.68 / 0.60 / 0.48 g (passenger / light / heavy — excerpt, may be camera-based) [31]; crash >2.0 g; non-actionable crashes removed [31], [70] | Events per 1,000 mi; speeding as % of drive time; following/inattention per drive-hour [71] | 100 − Σ(rate × weight); speeding weights 0 / 1 / 4 / 6; other weights from mixed-fleet benchmarks, editable [72], [70] | Any distance; 0 if none [71] | Posted limit (Global Speed Limit Database, quarterly): <6 / 6–10 / 11–15 / >15 mph over for ≥60 s (>15: ≥20 s); ECU speed, else GPS [73] | Not listed |
| **Motive** Safety Score | Hard accel/brake/corner, speeding, close following, stop sign, phone, distraction, seat belt [74] | Not published here | Per 1,000 mi, rolling 4 weeks [75] | 100 − Σ; range 50–100; dual-facing defaults accel 1, brake 4, corner 2, speeding 6, following 9, stop sign 7, phone 10, distraction 5, belt 6 (road-facing: 1/6/5/11/15/12) [75], [74] | 100 mi [75] | Not confirmed | Not listed |
| **Geotab** scorecard + Collision Risk | Hard accel, harsh brake, cornering, seat belt, speeding, excessive speeding [76] | GPS rules (current): passenger 0.30/0.30/0.42 g, light-duty truck 0.28/0.28/0.32, heavy-duty 0.20/0.20/0.24 (accel/brake/corner); old accelerometer rules much higher [29], [30] | Scorecard: not published; Collision Risk = probability of a collision per 100k mi, ML-based, benchmarked [77] | Weights 10/10/10/20/20/30% (accel/brake/corner/belt/speeding/excessive); bands 90–100 low, 75–90 mild, 60–75 medium, <60 high [76] | Not published | Posted +20% for >5 s, fixed; "excessive" e.g. >85 mph [29], [76] | Not listed |
| **Lytx** | Video events reviewed by trained analysts; "severe" = event score >3 [78]; Dynamic Risk layers weather/road context [79] | Proprietary | Proprietary | Proprietary | — | — | — |
| **Verizon Connect** | Hard brake/accel/corner, posted speed exceeded, tailgating, phone… [80] | Not published | Per distance; resets to 100 weekly; benchmark 80 [80] | By collision prediction (tailgating > one hard brake); e.g. 3+ speeding events per 1,000 km = +230% crash risk (vendor claim) [80] | Weekly | Posted speed | Not listed |
| Progressive **Snapshot** (consumer) | Hard brakes, rapid accelerations, time of day, miles; phone use in the app [81] | Hard brake ≥7 mph/s ≈ 0.32 g (secondary source) [82] | Policy term | Rates can rise (≈20% expected to pay more at the 2015 change) [83], [81] | Policy term | Not a listed factor | Midnight–4 AM [83] |
| Allstate **Drivewise** (consumer) | Speed vs local limit, braking, late night, phone [84] | "Short period of rapid deceleration" | — | Surcharge possible [84] | — | Relative to local limit | 11 PM–4 AM weekdays, 11 PM–5 AM weekends |
| Nationwide **Vantage 360 Fleet** | Speed vs limits, hard braking/acceleration, cornering, phone [7] | Hard brake >7.7 mph/s ≈ 0.35 g | 100-point, last 2 weeks | Not published | 2 weeks | Posted limit | Not listed |
| GEICO **DriveEasy Pro** | Hard braking, fast acceleration, sharp turns; distance, consistent speeds, late night, time driven, routes [8] | Not published | Daily 5-point "GPA" | ±10% at renewal | — | "Consistent speeds" | 10 PM–5 AM |
| Tesla Insurance (published formula, v1 2021) | Collision warnings /1,000 mi, hard braking, aggressive turning, unsafe following, forced Autopilot disengagement [85] | Brake >0.3 g as a share of time >0.1 g; turning >0.4 g as a share of time >0.2 g | Per 1,000 mi + time shares | Multiplicative collision-frequency model; score = 115.38 − 22.53 × PCF | — | (added in later versions) | (added later) |
| **Teltonika FMM00A** (our hardware, defaults) | Green Driving accel/brake/corner, overspeed, crash, unplug, towing [28] | 2.5 / 2.7 / 3.4 m/s² (≈0.25 / 0.28 / 0.35 g); crash 1,500 mG for 5 ms; **every scenario off by default**; source GPS 1 Hz unless set to accelerometer [28], [32] | — | — | — | Absolute (90 km/h default) | — |
| **HammerTrack today** (`lib/scorecard.ts`) | Speed stream only | — | Shares of moving time | A–F | "Not enough driving" → no grade | Absolute: sustained 70+/80+ | 10 PM–4 AM |

**What the table says**
- **Per-1,000-mile event rates + time-share speeding is the industry shape** (Samsara,
  Motive). Speeding is now measured **against the posted limit**, not a fixed speed
  (Samsara, Geotab, Verizon, Allstate).
- **Thresholds are not portable.** Geotab moved its default harsh-event rules from
  the accelerometer to GPS because potholes spike accelerometers [29];
  Teltonika says its GPS source is less accurate and recommends the accelerometer
  [32]. Insurer-grade = accelerometer trigger **confirmed** by a speed
  change from OBD or GPS.
- Without cameras or a driver-phone app we cannot measure following distance or phone
  use — the two heaviest weights in Motive's dual-facing defaults [74].
  Say "not measured"; never imply.

### Recommended methodology — HammerTrack Safety Score v1

**Scope.** Road vehicles only (trucks, vans, pickups). Machines and tools never enter
a driving score. One score per vehicle and per identified driver, a fleet score
weighted by miles.

**Events and thresholds** (device events, accelerometer source, auto-calibrated; the
server counts an event only when OBD or GPS speed confirms it within ±3 s, otherwise
it is shown as "unconfirmed" and not scored)

| Event | Light (pickups/vans, ≤10,000 lb) | Medium/heavy (dump trucks, F-650/750, tractors) | Severe tier | Basis |
|---|---|---|---|---|
| Harsh braking | ≥0.32 g (3.1 m/s², ≈7 mph/s) | ≥0.20 g (2.0 m/s²) | ≥1.5× threshold (our choice) | Progressive's 7 mph/s [82]; Geotab heavy-duty [29] |
| Harsh acceleration | ≥0.28 g (2.7 m/s²) | ≥0.20 g (2.0 m/s²) | ≥1.5× | Geotab light-duty truck / heavy [29] |
| Harsh cornering (≥30 km/h) | ≥0.35 g (3.4 m/s²) | ≥0.24 g (2.4 m/s²) | ≥1.5× | Teltonika default; Geotab heavy [28], [29] |
| Speeding vs posted limit | moderate 6–10 mph over ≥60 s · heavy 11–15 ≥60 s · severe >15 ≥20 s | same | — | Samsara defaults [73] |
| Max speed (limit known or not) | ≥80 mph for ≥20 s = severe (our choice) | ≥75 mph for ≥20 s = severe (our choice) | — | Catches speeding where no limit is known; Geotab's example "excessive" line is 85 mph [76]; Samsara offers an optional absolute max-speed event [73] |
| Late night | moving time 00:00–04:00 local | same | — | Snapshot's window [83]; 10 PM–5 AM (GEICO) shown, not scored, so 4–6 AM crew starts aren't punished |
| Crash/impact | ≥1.5 g for ≥5 ms (Teltonika default) — **listed, never auto-scored** | same | — | Teltonika default [28]; Samsara drops non-actionable crashes [70] |

Unit check: 1 g = 9.81 m/s² ≈ 21.9 mph per second; Teltonika takes m/s² [28].

**Weights and formula** (starting values copied from published defaults; recalibrate
once we hold 12+ months of claims-linked data)
- Events, per 1,000 miles: harsh brake **4**, harsh corner **2**, harsh accel **1**
  (Motive dual-facing defaults [74]); severe tier counts double.
- Speeding, per % of moving time: moderate **1**, heavy **4**, severe **6** (Samsara
  [72]); a max-speed episode counts as severe once, never twice.
- Late night, per % of moving time 00:00–04:00: **1** (our choice).
- **Score = clamp(100 − Σ impacts, 0, 100).** Grades: A ≥90, B ≥80, C ≥70, D ≥60,
  F <60; insurer view also shows Geotab-style bands (90+ low · 75–90 mild · 60–75
  medium · <60 high) [76].
- **Always publish the raw rates next to the score** (events/1,000 mi by type,
  % time per speeding tier, late-night %, miles, hours). Underwriters compare
  normalized rates across fleets, not each vendor's composite [25].

**Normalization.** Per 1,000 miles for events; % of moving time for speeding and late
night; per 100 engine-on hours as a second line for vocational trucks that work more
than they drive (our addition).

**Credibility floor.**
- No score below **250 miles and 10 moving hours** in the window (Motive's floor is
  100 mi [75]); below that, "not enough driving".
- Partial credibility by the actuarial square-root rule [86]:
  `shown = Z × own + (1 − Z) × fleet mean`, `Z = min(1, √(miles ÷ 3,000))`
  (3,000 mi = full credibility, our starting value).
- Windows: rolling 90 days for coaching; **trailing 12 months with a monthly series
  for insurers**; an insurer report needs ≥90 days [26], [10] and ≥3 road
  vehicles, and is marked "low credibility" under 10,000 fleet miles.

**Data-quality block — printed with every score** (what lets an underwriter trust it)
- Event source: accelerometer (calibrated yes/no) vs GPS; on-device vs derived;
  confirmed vs unconfirmed counts.
- Speed source: OBD vs GPS (Samsara prefers ECU speed [73]).
- Posted-limit coverage: % of miles with a known limit. OpenStreetMap tags limits on a
  small share of roads (7.4% of road elements worldwide in 2019 [87]), so use a
  commercial source for moving segments — TomTom Snap to Roads returns limits, 2.5K
  free requests/month [88] (the map's Traffic layer already takes a
  TomTom key, `NEXT_PUBLIC_TOMTOM_KEY`).
- Device coverage: % of road vehicles with a live unit; % of days reporting; silent
  gaps while the ignition was on.
- Tamper: unplug events (IO 252), GPS jamming (IO 249), lost truck power
  (`lib/power-loss.ts`), towing, GPS spikes rejected at ingest (`lib/ingest-guard.ts`).
  Insurance trackers lean on unplug detection plus a backup battery [89].
- Driver attribution: % of miles tied to a named driver (time-clock phone riding with
  the truck — `lib/convoy.ts` motion agreement — or an assignment).
- Methodology version and the thresholds above.

**Device config to push by FOTA (FMM00A)** [28], [32]

| Setting | ID | Value |
|---|---|---|
| Green Driving scenario | 11000 | on |
| Green Driving source | 11007 | 1 = accelerometer (then `auto_calibrate:set`: stopped on a straight road, then >30 km/h for 5 s) |
| Max acceleration / braking / cornering | 11004 / 11005 / 11006 | per vehicle class above (m/s²) |
| Crash detection | 11400 (+ 11401/11402) | on; 1,500 mG, 5 ms |
| Unplug detection | 11500 | on |
| Towing detection | 11600 | on |

IDs are the FMM00A's; the wired FMM650/FMM150 units have Green Driving too, but
their parameter IDs and defaults are unverified — check each model's list before
pushing a config (`docs/DEVICE-ONBOARDING.md` is the FOTA playbook).

---

## 4. What an underwriter wants, and the HammerTrack insurer report

**What a submission already asks for** (a carrier's fleet checklist [90] and
the ACORD 127 business-auto section with its 129 vehicle and 163 driver schedules
[91])
- 5 years of loss runs valued within 90 days, detail on losses over $50,000.
- Exposure: total miles and average power units per year; miles by state.
- Drivers: name, date of birth, license state and number, hire date, MVRs; drivers
  added/replaced in the last 12 months.
- Vehicles: year, make, model, VIN, value, garaging, GVW for local units.
- **Length of haul as % of miles: 0–50, 51–200, 201–500, 500+** — we can compute
  this exactly from the yard zone.
- Written fleet safety and maintenance programs; pre/post-trip inspections.

**What wins credit on top** [25], [26], [92]
- Trend over time — in the words of Zurich North America's head of telematics,
  "changes in the score over time, preferably on an improving basis."
- Rates per 1,000 miles (or per million miles), not raw counts.
- Coaching records tied to events, training logs, exoneration evidence.
- Delivered **months before renewal**, not two weeks.

**How carriers take it in today**

| Channel | Used by | Note |
|---|---|---|
| Broker submission packet (PDF/Excel) | Every carrier, all small fleets | Telematics reports ride along "if available"; many carriers can't ingest raw telematics [58] — a clean PDF + CSV wins |
| TSP marketplace app (OAuth/API) | Samsara/Motive/Geotab ↔ The Hartford, Progressive, Nirvana, Sentry… | One click inside the TSP; Netradyne needs written approval [42] |
| Aggregator consent flow | Terminal (Cover Whale, HDVI), CMT, Draivn, SambaSafety, TruckerCloud | One integration reaches many carriers |
| Carrier's own device/app | Progressive ProView, Nationwide V360, GEICO DriveEasy Pro | Carrier's data, not ours |
| Loss-control survey / risk engineering | Zurich, Great American, Northland | Checks the written program, MVRs, maintenance, **telematics management** [93], [94] |

**HammerTrack insurer report — section list (v1)**
0. **Cover & attestation** — company, DOT # if any, garaging yards, period (trailing
   12 months; refuse under 90 days), methodology version, generated date, owner's
   attestation, a verify link (`/x/<id>`, `lib/share-links.ts`).
1. **Summary** — fleet score and grade, 12-month monthly trend, three headline rates
   (harsh brakes /1,000 mi, % time severe speeding, late-night %), change vs prior
   period, coaching completion %.
2. **Exposure & operations** — vehicle schedule (year/make/model/VIN/class/garaging/
   unit), miles and moving hours per vehicle per month, **length-of-haul bands**,
   after-hours and weekend miles (personal-use exposure), vehicles seen vs vehicles
   on the schedule (Cover Whale checks "unscheduled vehicles" [15]).
3. **Drivers** — roster with CDL/CMV class (`profiles.driver_class`), hire dates,
   miles attributed, score distribution (quartiles), turnover in 12 months. Named
   only with that driver's consent; IDs otherwise.
4. **Driving behavior** — per class: events /1,000 mi by type and severity, % time
   per speeding tier, max-speed episodes, late-night share, impact events; monthly.
5. **Safety program & coaching** — written policy (upload), driver acknowledgments,
   coaching log (event → coached on → by whom), MVR review cadence (entered by the
   customer), training.
6. **Vehicle maintenance & health** — on-time service %, open work orders,
   check-engine codes and miles driven with the light on (already computed in
   `lib/telemetry-catalog.ts`), equipment checks.
7. **Theft & physical-damage controls** (auto physical damage and contractor's
   equipment) — % of units tracked, geofenced yards, after-hours movement alerts,
   theft events with recovery timelines, tool-tag coverage. Under 25% of stolen
   construction equipment is ever recovered (NER/NICB, 2014 — the last public
   report, secondary source) [95].
8. **Incidents** — impact events with replay links; customer-entered claims with the
   telematics evidence.
9. **Compliance** — DOT short-haul records summary for CDL drivers (`lib/short-haul.ts`).
10. **Data quality & methodology appendix** — the block in §3.

Format: a PDF of ≤6 pages plus appendix, the same tables as CSV and JSON, ACORD field
names where they exist, sent as a link the agent can open.

---

## 5. Legal and regulatory (not legal advice)

| Topic | What we found | What HammerTrack should do |
|---|---|---|
| **Telling drivers** | New Jersey: written notice before using a tracking device in a vehicle an employee uses; $1,000 then $2,500 per violation (2022) [96]. New York (2022): notice at hire, employee acknowledgment and a posted notice before monitoring employees' phone, email or internet use; $500 / $1,000 / $3,000 — whether it reaches vehicle GPS is unverified [97]. Connecticut and Delaware also require notice (vendor summary, unverified) [98]. We found no SC GPS-notice statute (unverified) | Built-in driver notice with an e-acknowledgment at first login/clock-in; the customer's written authorization before any data leaves (Netradyne's rule too [42]) |
| **Driver-level scores and the FCRA** | A "consumer report" includes information used for "any other purpose authorized" under §1681b, which covers "the underwriting of insurance involving the consumer" and employment [99], [100]. A CRA is anyone who, for fees, regularly assembles or evaluates consumer information to furnish to third parties [99]. A party's report of its *own* transactions with the consumer is excluded [99]. Employment-purpose reports need a standalone disclosure and written authorization [100]. An agency may pull MVRs for underwriting without the driver's permission, but sharing their contents with the employer turns it into a CRA [101]. The CFPB said in 2024 that algorithmic worker scores can be consumer reports [102] and withdrew that guidance in May 2025 [103] — the statute did not change. LexisNexis sells its telematics product as an FCRA product [69]; parts of the FCRA claims over GM's driving data survived dismissal in April 2026 [23] | **Default to fleet-level aggregates.** Driver-level only inside the customer's own account, or exported *by the customer* with that driver's consent. HammerTrack never sells or furnishes driver scores to an insurer for a fee. Anyone furnishing to a CRA owes accuracy and dispute duties [104]. **FCRA counsel before stage (c).** |
| **State privacy laws** | California's law covers employee data since Jan 1 2023 [105]; almost every other state law excludes people acting in an employment context, and SC has no comprehensive privacy law [106]. Texas sued Allstate/Arity under its law [24] | California customers get notice at collection with retention periods; everywhere: minimize, set retention, honor deletion |
| **Retention** | FMCSA: duty-status records and short-haul time records kept 6 months [107], [108]. The GM order requires deletion within 180 days and data minimization [22]. SC's Insurance Data Security Act requires a licensee to set a retention and destruction schedule [109] | Proposal: raw positions and events 25 months (two policy years + a renewal lookback); monthly safety aggregates 5 years (the loss-run horizon [90]); delete 30 days after an account closes |
| **Getting paid without a license (SC)** | Nobody may take a commission for selling, soliciting or negotiating insurance without a license; a fee to someone who doesn't sell/solicit/negotiate is allowed but "must not be based on completion of the sale" (§38-43-200(A),(B),(D)) [33]. Nationally, most states follow NAIC's model: a fixed amount per referral, not dependent on a purchase, no discussing terms; Pennsylvania allows only a nominal one-time fee [110], [111] | Flat per-referral or flat marketing fees only; nothing as a % of premium; the app never discusses coverage or price |
| **Getting licensed (SC)** | Agency license: Form 3511, $40, at least one licensed producer, renewed in January of even years [34]; producer license $25 + exam + SLED check [35]. A licensee falls under SC's Insurance Data Security Act: written security program, report cyber events to the Director within 72 hours [109] | Stage (d): license the LLC + one producer; E&O policy; carrier appointments |
| **Insurer-paid subscriptions** | Since May 20 2024 (Act 180) insurers and producers may give value-added products at no or reduced cost if they relate to the coverage and are primarily for loss control, cost is reasonable against the premium, and eligibility follows documented, non-discriminatory criteria (§38-57-130(5)) [36] | Pitch carriers a "HammerTrack for policyholders" subsidy — the Motive/Northland model, legal in SC |
| **MGA** | SC: must be licensed as an agent for that insurer; $50,000 bond per insurer; contract minimums in §38-44-40 [112], [113]. NAIC model: written contract with authority and limits, carrier reviews of underwriting and claims, bond of at least $100,000 or 10% of premium (≤$500,000), audited financials [114] | Years out; partner capacity; never carry risk |

**Lessons from 2024–2026:** GM's data sales led to an FTC order (affirmative express
consent for 20 years, a 5-year ban on sharing with consumer reporting agencies,
deletion, minimization) [22], an MDL where wiretap, Stored Communications Act and
parts of the FCRA claims survived [23], and Verisk shutting its product
[21]. Consent screens, purpose limits and "never sell driver data" are
cheaper than any of that.

---

## 6. Revenue models and the staged plan

| Stage | Build | Who to contact (company · program) | Economics (sourced) | Gate |
|---|---|---|---|---|
| **(a) Now — score + insurer report** (0–6 months; read-only, so it can ship ahead of the Growth Platform's money-layer gates) | §3 score v1; §4 report (PDF + CSV); driver notice + customer authorization; coaching log; FOTA Green Driving config | Our own agent at DCG's next renewal (pilot) | No direct revenue. Customer value: typical credits 3–10% (see §1). At Progressive's 2025 contractor average of $260/month per power unit ($3,120/yr; median $203) [115], 5% ≈ $156 and 10% ≈ $312 per truck per year — about $1.6–3.1k/yr on a 10-truck fleet (Insureon's construction customers: $264/month per policy [116]) | ≥90 days of data per customer |
| **(b) Referral + subsidy partners** (6–18 months) | "Quote with my data" hand-off (consented share link to the agent/MGA); referral tracking; subsidy billing | **Draivn** (fleet → brokers/carriers; the Linxup route); **LEEO** through an appointed broker; an SC independent agency that writes contractor fleets and can enroll customers in **Nationwide Vantage 360, GEICO DriveEasy Pro, Progressive Snapshot ProView**; **Coverdash** (embedded quoting, licensed in 50 states, already inside Housecall Pro [117]); subsidy pitch to carriers that already fund TSPs (**Northland, RLI, Sentry**) | Flat referral fees only — public small-business programs pay ~$20–40 per qualified lead (Insureon $20/$40, NEXT $25, CoverWallet ~$30; affiliate directories, unverified) [118], [119]. The bigger lever is **insurer-funded subscriptions**: Motive averages $240/vehicle/yr [17], Northland up to $300 [18] — legal in SC since 2024 [36] | ≥10 paying fleets with ≥6 months of data; consent flow live; report used at ≥3 real renewals |
| **(c) Aggregator / exchange contributor** (9–24 months) | Insurer-share API: OAuth per fleet, scopes, revocation, audit log; normalized schema (vehicles, drivers, trips, positions, events with thresholds, speeding vs posted limit); webhooks | **Terminal** ("Partner with us"), **CMT DriveWell Fleet**, **Draivn**, **SambaSafety**, **TruckerCloud** | No TSP revenue share is public; exchanges paid automakers cents per car [20]. The value is **distribution**: our customers become acceptable to carriers that take data only through these pipes (Cover Whale via Terminal [15]) | ~500–1,000 connected road vehicles (our guess; aggregator minimums unverified); FCRA counsel sign-off |
| **(d) Licensed agency / embedded insurance** (24–48 months) | "HammerTrack Insurance Services" (SC first, then non-resident licenses); quote and bind through partner or carrier APIs; commission accounting | Carrier agency-appointment teams (Progressive Commercial, Nationwide, GEICO commercial, The Hartford); LEEO broker appointment; or let a licensed embedded partner hold the license (**Coverdash**, **Vertical Insure**) and stay on flat fees [117], [120] | Commercial auto commissions ~10–12% new, 8–10% renewal (industry estimate) [121]. Illustration (8 road vehicles per customer and a 25% bind rate are assumptions): 500 customers × 8 × $3,120 × 25% × 10% ≈ **$312k/yr**; at 100 customers ≈ $62k | ~250 fleets; 12+ months of claims-linked data; licensed producer; E&O |
| **(e) MGA** (5+ years, maybe never) | Underwriting model on our own loss-linked data | Fronting carriers and reinsurers for capacity | MGA pay ≈15–25% of written premium plus 10–30% profit commission (industry primer, unverified) [122]; MGAs wrote $108.7B in 2025 (+17.8%) while carriers tighten capacity [123] | Multi-year loss data with actuarial validation; never carry risk |

**The honest read**
- Referral fees are pocket change; the real near-term money is **retention and
  sales** ("the subscription part-pays for itself in premium savings") and,
  later, **insurer-paid subscriptions**.
- Agency commission only matters at hundreds of fleets. Insurance at small-fleet
  scale is hard: Pie and Ford Pro Insure left commercial auto on Jan 1 2026
  [56]; the whole line has lost money 14 years running [1].
- Our edge nobody else has: trucks **and** machines **and** tools on one record —
  the theft/recovery evidence an equipment underwriter prices on
  (`docs/GROWTH-PLATFORM.md` §5).

### First 5 next steps
1. **Turn on insurer-grade capture on every FMM00A by FOTA**: Green Driving on,
   accelerometer source + auto-calibrate, class thresholds, crash, unplug and towing
   detection (§3 table); confirm IO 253/254 arrive and land in the catalog.
2. **Ship score v1 + insurer report v1 + driver notice/acknowledgment + coaching
   log**, run it on DCG's own fleet, hand it to DCG's agent ahead of the next renewal,
   and write down every question the underwriter asks.
3. **Talk to Terminal, CMT (DriveWell Fleet) and Draivn**: TSP onboarding steps,
   schema, minimum volume, commercial terms. Linxup got into two of them this year.
4. **Pick one SC independent agency** that writes contractor fleets: which programs
   our customers can join today (Nationwide V360, GEICO DriveEasy Pro, Progressive
   ProView, LEEO), whether underwriters will accept our report, and a flat referral
   fee in writing.
5. **Book two short consults**: SC insurance-regulatory counsel (§38-43-200(D) fee
   design, §38-57-130(5) subsidy, licensing) and FCRA/privacy counsel (driver-level
   sharing, consent wording, retention).

---

## What contradicts the usual assumptions

- *"Insurers will pay for our data."* Exchanges paid automakers cents per car
  [20]; Verisk quit [21]; regulators and plaintiffs went
  after the sellers [22], [23], [24].
- *"Telematics means big discounts."* Small-fleet credits are mostly 3–10%, and
  Progressive, GEICO and Allstate can surcharge [5], [8], [84].
- *"Fleets won't share."* 79% of non-sharers were never asked [57].
- *"The accelerometer beats GPS."* Geotab moved its default rules to GPS to beat
  pothole noise [29]; Teltonika recommends the accelerometer
  [32]. Use both.
- *"We need direct carrier integrations."* Small TSPs reach carriers through
  aggregators; Cover Whale connects ELDs via Terminal [15].
- *"A score is enough."* Underwriters want the trend and the coaching behind it
  [25]; Travelers' credit demanded quarterly feedback [27].
- *"Our A–F grade covers safety."* It has no braking, acceleration or cornering
  data until Green Driving is switched on [28].

---

## Sources

Accessed Oct 6 2026. *(excerpt)* = the page refused a direct fetch, so the fact was read
from a search-engine excerpt of that page — treat as unverified until someone opens it.

1. Insurance Journal — AM Best: commercial auto liability drags down segment (Sep 22 2025) — <https://www.insurancejournal.com/news/national/2025/09/22/840105.htm>
2. Work Truck Online — CMT's DriveWell Fleet aims to turn fleet telematics into insurance pricing data (Jan 15 2026) — <https://www.worktruckonline.com/news/new-drivewell-fleet-program-aims-to-turn-fleet-telematics-into-insurance-pricing-data>
3. SambaSafety — 2025 Telematics Report release (Oct 15 2025) — <https://sambasafety.com/blog/2025-telematics-report-release>
4. Samsara App Marketplace — Progressive — <https://www.samsara.com/resources/marketplace/progressive>
5. Progressive — Snapshot ProView launch release (Dec 8 2020) — <https://www.prnewswire.com/news-releases/progressive-introduces-usage-based-insurance-and-fleet-management-program-for-business-owners-301188373.html>
6. Samsara App Marketplace — The Hartford — <https://www.samsara.com/resources/marketplace/the-hartford>
7. Nationwide — Vantage 360 Fleet customer flier (form CMO-1021M1, 01/21) — <https://halcyonuw.com/wp-content/uploads/2025/09/CMO-1021M1_Vantage360CustomerFacingFlier.pdf>
8. GEICO — DriveEasy Pro help center — <https://www.geico.com/driveeasypro/help-center/>
9. Nirvana — Series D announcement (Dec 18 2025) — <https://www.nirvanatech.com/blog/series-d>
10. HDVI — second-generation Shift product (Feb 1 2023) — <https://www.prnewswire.com/news-releases/high-definition-vehicle-insurance-launches-second-generation-of-its-proprietary-telematics-based-shift-product-301736089.html>
11. Crowdfund Insider — Cover Whale teams up with Geotab (Mar 11 2024) — <https://www.crowdfundinsider.com/2024/03/222512-digital-insurtech-cover-whale-teams-up-with-geotab/>
12. Progressive Commercial — Smart Haul program page (savings data Feb–Aug 2025) — <https://www.progressivecommercial.com/commercial-auto-insurance/truck-insurance/smart-haul/>
13. Draivn — homepage (300+ TSPs, 95% of North American commercial vehicles) — <https://draivn.com/>
14. Terminal — homepage (290 integrations, partner path, customers) — <https://www.withterminal.com/>
15. Cover Whale — Driver Safety Program FAQs — <https://help.coverwhale.com/knowledge/driver-safety-program-faqs>
16. Linxup integrates with Draivn (May 12 2026) — <https://www.prnewswire.com/news-releases/linxup-integrates-with-draivn-to-streamline-commercial-auto-insurance-for-fleet-operators-302768486.html>
17. Motive — Benefits of the Motive insurance partner program (Sep 16 2025) — <https://gomotive.com/blog/benefits-of-motive-insurance-partner-program/>
18. Samsara — Northland Insurance partnership (Nov 19 2024) — <https://www.samsara.com/blog/northland-insurance-partnership>
19. Digital Insurance — Travelers' Northland Insurance launches telematics insurtech *(excerpt)* — <https://www.dig-in.com/list/travelers-northland-insurance-launches-telematics-insurtech>
20. Motor1 — Automakers sold your data for pennies (Jul 2024) *(excerpt)* — <https://www.motor1.com/news/728428/automakers-sold-data-cheap/>
21. The Record — Data broker shuts down product related to driver behavior patterns (Jun 11 2024) — <https://therecord.media/data-broker-shuts-product-driver-patterns>
22. Hintze Law — FTC finalizes order against GM and OnStar over driver data (Jan 26 2026) — <https://hintzelaw.com/blog/2026/1/26/ftc-finalizes-order-against-gm-and-onstar-over-driver-data>
23. DiCello Levitt — Court allows GM OnStar vehicle data privacy lawsuit to move forward (Apr 27 2026) — <https://dicellolevitt.com/court-allows-gm-onstar-vehicle-data-privacy-lawsuit-to-move-forward/>
24. WilmerHale — Texas AG brings first-ever lawsuit under a state comprehensive privacy law (Jan 21 2025) *(excerpt)* — <https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20250121-texas-ag-brings-first-ever-lawsuit-under-a-state-comprehensive-privacy-law>
25. Truck News — Underwriters look beyond loss runs to measure fleet risk (Jul 3 2026) — <https://www.trucknews.com/business-management/underwriters-look-beyond-loss-runs-to-measure-fleet-risk/1003217874/>
26. Trucordia — Your safety investment deserves more credit at renewal (Jun 1 2026) — <https://www.trucordia.com/blog/your-safety-investment-deserves-more-credit-at-renewal>
27. Travelers — Embraces fleet vehicle telematics (Sep 7 2010) — <https://investor.travelers.com/newsroom/press-releases/news-details/2010/Travelers-Embraces-Fleet-Vehicle-Telematics-to-Improve-Roadway-Safety/default.aspx>
28. Teltonika Wiki — FMM00A parameter list — <https://wiki.teltonika-gps.com/view/FMM00A_Parameter_list>
29. Geotab — Rules overview (GPS-based safety rules) — <https://support.geotab.com/help/mygeotab/groups-and-rules/rules/rules-overview>
30. Geotab — Aggressive Driving report (accelerometer thresholds) — <https://support.geotab.com/help/mygeotab/reports/safety-reports/aggressive-driving-report>
31. Samsara KB — Harsh event detection (thresholds as indexed; may be camera-based) *(excerpt)* — <https://kb.samsara.com/hc/en-us/articles/5321169919501-Harsh-Event-Detection>
32. Teltonika Wiki — FMM00A features settings — <https://wiki.teltonika-gps.com/view/FMM00A_Features_settings>
33. SC Code Title 38 Ch. 43 — Insurance producers and agencies (§38-43-30, §38-43-200) — <https://www.scstatehouse.gov/code/t38c043.php>
34. SC Department of Insurance — Agency license requirements — <https://online.doi.sc.gov/Eng/Public/Agents/Agency.aspx>
35. SC Department of Insurance — Resident producer license — <https://doi.sc.gov/506/Resident-Producer>
36. SC Code Title 38 Ch. 57 — Trade practices (§38-57-130(5), added by 2024 Act No. 180) — <https://www.scstatehouse.gov/code/t38c057.php>
37. Progressive — Smart Haul launch release (Sep 6 2018) — <https://progressive.mediaroom.com/2018-09-06-progressive-R-introduces-eld-usage-based-insurance-program-for-commercial-truck-drivers>
38. Progressive Commercial — Commercial auto insurance discounts — <https://www.progressivecommercial.com/commercial-auto-insurance/insurance-discounts/>
39. CMT — Nationwide expands telematics solutions to fleets with CMT (Vantage 360 Fleet, Jul 10 2019) — <https://www.cmtelematics.com/news/nationwide-expands-telematics-solutions-to-fleets-with-cambridge-mobile-telematics/>
40. FreightWaves Checkpoint — Nationwide commercial truck insurance review (Feb 27 2026) — <https://www.freightwaves.com/checkpoint/nationwide-commercial-truck-insurance-review/>
41. Insurance Journal — Motive and GEICO partner on commercial fleets (Nov 18 2025) — <https://www.insurancejournal.com/news/national/2025/11/18/848130.htm>
42. Netradyne — The Hartford integration — <https://www.netradyne.com/integrations/the-hartford>
43. Liberty Mutual — Commercial auto telematics terms & conditions *(excerpt)* — <https://www.libertymutual.com/small-business/commercial-auto-telematics-terms-conditions>
44. Samsara App Marketplace — Zurich Insurance — <https://www.samsara.com/resources/marketplace/zurich-insurance>
45. Azuga — Zurich premium partner — <https://www.azuga.com/premium-partner/zurich>
46. Samsara App Marketplace — Insurance category (per-partner discount figures from marketplace excerpts) — <https://www.samsara.com/resources/marketplace/category/insurance>
47. Motive — Commercial fleet insurance programs (insurer partner page) — <https://gomotive.com/partners/insurance/>
48. Samsara App Marketplace — Nirvana Insurance — <https://www.samsara.com/resources/marketplace/nirvana-insurance>
49. Cover Whale — ELD telemetry data-sharing option (Feb 6 2024) — <https://coverwhale.com/news/eld-telemetry-data-option>
50. Business Insurance — Commercial auto MGA Fairmatic rebrands as Leeo (Dec 2025) *(excerpt)* — <https://www.businessinsurance.com/commercial-auto-mga-fairmatic-rebrands-as-leeo/>
51. QuoteSweep — LEEO review (updated Aug 18 2026; third-party) — <https://www.quotesweep.com/insurtech/leeo>
52. Reinsurance News — INSHUR expands US commercial auto programme *(excerpt)* — <https://www.reinsurancene.ws/inshur-expands-us-commercial-auto-programme-with-mobilitas-incline-and-gen-re-support/>
53. Koop — Commercial auto liability *(excerpt)* — <https://www.koop.ai/commercial-auto-liability>
54. Insurance Journal — ERGO enters US small-business insurance with full buy of NEXT (Mar 20 2025) *(excerpt)* — <https://www.insurancejournal.com/news/national/2025/03/20/816324.htm>
55. Pie Insurance — Commercial auto underwriting guidelines *(excerpt)* — <https://www.pieinsurance.com/agency/commercial-auto/underwriting-guidelines>
56. Coverager — Pie and Ford to split in 2025 *(excerpt)* — <https://coverager.com/pie-and-ford-to-split-in-2025/>
57. SambaSafety — Why fleets won't share telematics data — <https://sambasafety.com/blog/why-fleets-wont-share-telematics-data>
58. Carrier Management — Why insurance telematics integrations fail (Nov 24 2025) — <https://www.carriermanagement.com/features/2025/11/24/281755.htm>
59. FleetOwner — CMT expands fleet insurance telematics through Geotab Marketplace (Jul 9 2026) — <https://www.fleetowner.com/technology/news/55389514/cambridge-mobile-telematics-expands-fleet-insurance-telematics-through-geotab-marketplace>
60. Terminal — Telematics data for commercial auto insurance — <https://www.withterminal.com/product/insurance>
61. SambaSafety — Telematics aggregation — <https://sambasafety.com/capabilities/telematics-aggregation/>
62. TruckerCloud — Top commercial auto insurers partner with TruckerCloud *(excerpt)* — <https://www.truckercloud.com/blog/top-commercial-auto-insurers-partner-with-truckercloud-for-innovation-in-telematics-data-access-and-analytics>
63. Samsara — Differentiate your insurance programs with Samsara (Oct 12 2022) — <https://www.samsara.com/blog/differentiate-your-insurance-programs-with-samsara>
64. Geotab — Commercial fleet insurance: save with telematics — <https://www.geotab.com/fleet-management-solutions/commercial-fleet-insurance/>
65. GlobeNewswire — Verisk Data Exchange integration on the Geotab Marketplace (May 19 2020) *(excerpt)* — <https://www.globenewswire.com/news-release/2020/05/19/2035918/0/en/New-Verisk-Data-Exchange-Integration-for-Insurance-Telematics-Now-Available-on-the-Geotab-Marketplace.html>
66. Verisk — TomTom Telematics flows commercial driving data to Verisk Data Exchange *(excerpt)* — <https://www.verisk.com/company/newsroom/tomtom-telematics-flows-commercial-driving-data-to-verisk-data-exchange/>
67. EFF — Senators expose car companies' terrible data privacy practices (Jul 2024) *(excerpt)* — <https://www.eff.org/deeplinks/2024/07/senators-expose-car-companies-terrible-data-privacy-practices>
68. LexisNexis Risk Solutions — Telematics Exchange — <https://risk.lexisnexis.com/products/telematics-exchange>
69. LexisNexis Risk Solutions — Telematics OnDemand (FCRA disclaimer) — <https://risk.lexisnexis.com/products/telematics-ondemand>
70. Samsara Safety Score calculation — customer handout (Mar 2022) — <https://www.virginiatransportation.com/wp-content/uploads/2022/03/Samsara-Safety-Score-Calculation.pdf>
71. Samsara KB — Safety Score categories and calculation *(excerpt)* — <https://kb.samsara.com/hc/en-us/articles/360045237852-Safety-Score-Categories-and-Calculation>
72. Samsara KB — Safety Score weights and configuration *(excerpt)* — <https://kb.samsara.com/hc/en-us/articles/360043160532-Safety-Score-Weights-and-Configuration>
73. Samsara KB — Driver speeding and speed limits — <https://samsara1678209876.zendesk.com/hc/en-us/articles/26047508272269-Driver-Speeding-and-Speed-Limits>
74. Motive Help Center — Updated Safety Score settings and defaults *(excerpt)* — <https://helpcenter.gomotive.com/hc/en-us/articles/21827352179741-Updated-Safety-Score-settings-and-defaults>
75. Motive Help Center — Motive Safety Score *(excerpt)* — <https://helpcenter.gomotive.com/hc/en-us/articles/6162164321693-Motive-Safety-Score>
76. Geotab — Driver Safety Scorecard — <https://support.geotab.com/help/mygeotab/reports/safety-reports/driver-safety-scorecard>
77. Geotab — Collision Risk — <https://www.geotab.com/fleet-management-solutions/collision-risk/>
78. Virginia Tech (VTTI) report using Lytx DriveCam event data *(excerpt)* — <https://vtechworks.lib.vt.edu/server/api/core/bitstreams/a9ea982a-1bb7-4637-aa16-39b323dda6a8/content>
79. Lytx — Dynamic Risk *(excerpt)* — <https://www.lytx.com/features/dynamic-risk>
80. Verizon Connect — Driver risk profiling — <https://www.verizonconnect.com/resources/article/driver-risk-profiling/>
81. Progressive — Snapshot FAQ — <https://www.progressive.com/auto/discounts/snapshot/snapshot-faq/>
82. Law-firm article — Progressive Snapshot may actually raise your rates (hard-brake definition; secondary source) *(excerpt)* — <https://christensenhymas.com/articles/progressive-snapshot-may-actually-raise-rates/>
83. Claims Journal — Progressive plans to charge risky Snapshot drivers more (Mar 26 2015) — <https://www.claimsjournal.com/news/national/2015/03/26/262533.htm>
84. Allstate — Drivewise FAQs — <https://www.allstate.com/help-support/drivewise-support/faqs>
85. Inverse — Tesla's Safety Score explained (2021, updated 2024) — <https://www.inverse.com/innovation/tesla-fsd-score-explained>
86. CAS — Foundations of Casualty Actuarial Science, ch. 8 "Credibility" (square-root rule, Bühlmann) — <https://www.ressources-actuarielles.net/EXT/ISFA/1226.nsf/0/bf4517bb19eee4cec125704600554ce6/$FILE/chapter8.pdf>
87. Research figure — share of OSM road length with speed-limit data (2019 dataset) *(excerpt)* — <https://www.researchgate.net/figure/Proportion-of-the-total-length-of-all-roads-with-maximum-speed-information-in_fig1_338659062>
88. TomTom — API pricing (Snap to Roads) — <https://docs.tomtom.com/pricing>
89. Teltonika — Trackers for the insurance telematics industry *(excerpt)* — <https://www.teltonika-gps.com/use-cases/telematics/tracker-for-insurance-telematics-industry>
90. Commercial fleet underwriting checklist & application (an AIG-affiliated trucking program, PDF) — <https://www.5starsp.com/Portals/25/Fleet%20Application.pdf>
91. Vertafore — ACORD 127 Business Auto Section form map (with 129 / 163 overflow schedules) *(excerpt)* — <https://help.vertafore.com/AMS360/content/contextsensitive/acordforms/acordformmaps/form_map__business_auto_section_acord_127.htm>
92. Linxup — What insurance carriers actually look for in your fleet (Jun 22 2026) — <https://www.linxup.com/blog/how-telematics-lowers-commercial-auto-insurance>
93. Great American Insurance Group — Key elements of a commercial fleet safety program — <https://www.greatamericaninsurancegroup.com/content-hub/loss-control/details/key-elements-of-a-commercial-fleet-safety-program>
94. Northland Insurance — Eight elements of a fleet safety program — <https://www.northlandins.com/resources/safety-management/elements-of-fleet-safety-program>
95. LiveViewGPS — Construction equipment theft statistics (cites the 2014 NICB/NER report; vendor source) *(excerpt)* — <https://www.liveviewgps.com/gps-tracking-statistics/construction-equipment-theft/>
96. Jackson Lewis — New Jersey: notice required before using tracking devices in vehicles used by employees (2022) — <https://www.jacksonlewis.com/insights/new-jersey-notice-employees-required-using-tracking-devices-vehicles-used-employees>
97. New York State Senate — Civil Rights Law §52-C*2 (electronic monitoring notice) *(excerpt)* — <https://www.nysenate.gov/legislation/laws/CVR/52-C*2>
98. Timeero — Employee GPS tracking laws by state (vendor summary) *(excerpt)* — <https://timeero.com/resources-page/employee-gps-tracking-laws>
99. 15 U.S.C. §1681a — FCRA definitions (Cornell LII) — <https://www.law.cornell.edu/uscode/text/15/1681a>
100. 15 U.S.C. §1681b — permissible purposes (Cornell LII) — <https://www.law.cornell.edu/uscode/text/15/1681b>
101. Big "I" (IndependentAgent.com) — Running MVRs for commercial auto clients (reviewed Jun 24 2024) — <https://www.independentagent.com/vu_resource/running-mvrs-for-commercial-auto-clients-2/>
102. Federal Register — CFPB Circular 2024-06, background dossiers and algorithmic scores for employment decisions (Nov 12 2024) *(excerpt)* — <https://www.federalregister.gov/documents/2024/11/12/2024-26099/consumer-financial-protection-circular-2024-06-background-dossiers-and-algorithmic-scores-for-hiring>
103. Federal Register — CFPB withdrawal of 67 guidance documents incl. Circular 2024-06 (May 12 2025) *(excerpt)* — <https://www.federalregister.gov/documents/2025/05/12/2025-08286/interpretive-rules-policy-statements-and-advisory-opinions-withdrawal>
104. 15 U.S.C. §1681s-2 — duties of furnishers (Cornell LII) — <https://www.law.cornell.edu/uscode/text/15/1681s-2>
105. Holland & Knight — California employee data exemption expires on January 1 (Dec 2022) *(excerpt)* — <https://www.hklaw.com/en/insights/publications/2022/12/california-employee-data-exemption-expires-on-january-1>
106. Termly — US data privacy laws, state-by-state (South Carolina: none) — <https://termly.io/us-data-privacy-laws/>
107. 49 CFR §395.1 — short-haul exception and time records (Cornell LII) *(excerpt)* — <https://www.law.cornell.edu/cfr/text/49/395.1>
108. FMCSA — General information about the ELD rule *(excerpt)* — <https://www.fmcsa.dot.gov/hours-service/elds/general-information-about-eld-rule>
109. SC Code Title 38 Ch. 99 — Insurance Data Security Act *(excerpt)* — <https://www.scstatehouse.gov/code/t38c099.php>
110. Insurance Journal — Referral fees: a multi-state overview (Feb 19 2024) — <https://www.insurancejournal.com/magazines/mag-features/2024/02/19/761025.htm>
111. Genova Burns — Affinity insurance brokerage: compensation to unlicensed parties (Feb 2020) — <https://www.genovaburns.com/news/articles/2020-02-07-affinity-insurance-brokerage-a-primer-on-compensation-to-unlicensed-parties>
112. SC Code Title 38 Ch. 44 — Managing General Agents Act *(excerpt)* — <https://www.scstatehouse.gov/code/t38c044.php>
113. SC Department of Insurance — Managing general agent approval — <https://doi.sc.gov/411/Managing-General-Agent>
114. NAIC — Managing General Agents Act (#225) project history *(excerpt)* — <https://content.naic.org/sites/default/files/model-laws-project-history-225.pdf>
115. Progressive Commercial — Commercial auto insurance cost (2025 premium per power unit) — <https://www.progressivecommercial.com/commercial-auto-insurance/commercial-auto-cost/>
116. Insureon — Commercial auto insurance cost (median-based, updated Mar 4 2026) — <https://www.insureon.com/small-business-insurance/commercial-auto/cost>
117. Housecall Pro — Housecall Pro adds business insurance through Coverdash (Aug 12 2026) — <https://www.housecallpro.com/resources/coverdash-housecall-pro-business-insurance/>
118. FlexOffers — Insureon small business insurance affiliate program *(excerpt)* — <https://www.flexoffers.com/affiliate-programs/insureon-small-business-insurance-affiliate-program/>
119. UpPromote — Insurance affiliate programs (NEXT, CoverWallet payouts) *(excerpt)* — <https://uppromote.com/blog/insurance-affiliate-programs/>
120. Vertical Insure — embedded protection for vertical software (licensed producer) — <https://verticalinsure.com/>
121. Insifter — Insurance agent commission benchmarks by line (2026) *(excerpt)* — <https://insifter.com/commission-benchmarks.html>
122. Umbrex — Insurance brokers and MGAs industry primer *(excerpt)* — <https://umbrex.com/resources/industry-primers/financial-services-industry-primers/insurance-brokers-and-mgas-industry-primer/>
123. Risk & Insurance — MGA premiums hit $108.7 billion in 2025 (Jul 3 2026) — <https://riskandinsurance.com/mga-premiums-hit-108-7-billion-in-2025-as-capacity-scrutiny-tightens/>

[1]: https://www.insurancejournal.com/news/national/2025/09/22/840105.htm
[2]: https://www.worktruckonline.com/news/new-drivewell-fleet-program-aims-to-turn-fleet-telematics-into-insurance-pricing-data
[3]: https://sambasafety.com/blog/2025-telematics-report-release
[4]: https://www.samsara.com/resources/marketplace/progressive
[5]: https://www.prnewswire.com/news-releases/progressive-introduces-usage-based-insurance-and-fleet-management-program-for-business-owners-301188373.html
[6]: https://www.samsara.com/resources/marketplace/the-hartford
[7]: https://halcyonuw.com/wp-content/uploads/2025/09/CMO-1021M1_Vantage360CustomerFacingFlier.pdf
[8]: https://www.geico.com/driveeasypro/help-center/
[9]: https://www.nirvanatech.com/blog/series-d
[10]: https://www.prnewswire.com/news-releases/high-definition-vehicle-insurance-launches-second-generation-of-its-proprietary-telematics-based-shift-product-301736089.html
[11]: https://www.crowdfundinsider.com/2024/03/222512-digital-insurtech-cover-whale-teams-up-with-geotab/
[12]: https://www.progressivecommercial.com/commercial-auto-insurance/truck-insurance/smart-haul/
[13]: https://draivn.com/
[14]: https://www.withterminal.com/
[15]: https://help.coverwhale.com/knowledge/driver-safety-program-faqs
[16]: https://www.prnewswire.com/news-releases/linxup-integrates-with-draivn-to-streamline-commercial-auto-insurance-for-fleet-operators-302768486.html
[17]: https://gomotive.com/blog/benefits-of-motive-insurance-partner-program/
[18]: https://www.samsara.com/blog/northland-insurance-partnership
[19]: https://www.dig-in.com/list/travelers-northland-insurance-launches-telematics-insurtech
[20]: https://www.motor1.com/news/728428/automakers-sold-data-cheap/
[21]: https://therecord.media/data-broker-shuts-product-driver-patterns
[22]: https://hintzelaw.com/blog/2026/1/26/ftc-finalizes-order-against-gm-and-onstar-over-driver-data
[23]: https://dicellolevitt.com/court-allows-gm-onstar-vehicle-data-privacy-lawsuit-to-move-forward/
[24]: https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20250121-texas-ag-brings-first-ever-lawsuit-under-a-state-comprehensive-privacy-law
[25]: https://www.trucknews.com/business-management/underwriters-look-beyond-loss-runs-to-measure-fleet-risk/1003217874/
[26]: https://www.trucordia.com/blog/your-safety-investment-deserves-more-credit-at-renewal
[27]: https://investor.travelers.com/newsroom/press-releases/news-details/2010/Travelers-Embraces-Fleet-Vehicle-Telematics-to-Improve-Roadway-Safety/default.aspx
[28]: https://wiki.teltonika-gps.com/view/FMM00A_Parameter_list
[29]: https://support.geotab.com/help/mygeotab/groups-and-rules/rules/rules-overview
[30]: https://support.geotab.com/help/mygeotab/reports/safety-reports/aggressive-driving-report
[31]: https://kb.samsara.com/hc/en-us/articles/5321169919501-Harsh-Event-Detection
[32]: https://wiki.teltonika-gps.com/view/FMM00A_Features_settings
[33]: https://www.scstatehouse.gov/code/t38c043.php
[34]: https://online.doi.sc.gov/Eng/Public/Agents/Agency.aspx
[35]: https://doi.sc.gov/506/Resident-Producer
[36]: https://www.scstatehouse.gov/code/t38c057.php
[37]: https://progressive.mediaroom.com/2018-09-06-progressive-R-introduces-eld-usage-based-insurance-program-for-commercial-truck-drivers
[38]: https://www.progressivecommercial.com/commercial-auto-insurance/insurance-discounts/
[39]: https://www.cmtelematics.com/news/nationwide-expands-telematics-solutions-to-fleets-with-cambridge-mobile-telematics/
[40]: https://www.freightwaves.com/checkpoint/nationwide-commercial-truck-insurance-review/
[41]: https://www.insurancejournal.com/news/national/2025/11/18/848130.htm
[42]: https://www.netradyne.com/integrations/the-hartford
[43]: https://www.libertymutual.com/small-business/commercial-auto-telematics-terms-conditions
[44]: https://www.samsara.com/resources/marketplace/zurich-insurance
[45]: https://www.azuga.com/premium-partner/zurich
[46]: https://www.samsara.com/resources/marketplace/category/insurance
[47]: https://gomotive.com/partners/insurance/
[48]: https://www.samsara.com/resources/marketplace/nirvana-insurance
[49]: https://coverwhale.com/news/eld-telemetry-data-option
[50]: https://www.businessinsurance.com/commercial-auto-mga-fairmatic-rebrands-as-leeo/
[51]: https://www.quotesweep.com/insurtech/leeo
[52]: https://www.reinsurancene.ws/inshur-expands-us-commercial-auto-programme-with-mobilitas-incline-and-gen-re-support/
[53]: https://www.koop.ai/commercial-auto-liability
[54]: https://www.insurancejournal.com/news/national/2025/03/20/816324.htm
[55]: https://www.pieinsurance.com/agency/commercial-auto/underwriting-guidelines
[56]: https://coverager.com/pie-and-ford-to-split-in-2025/
[57]: https://sambasafety.com/blog/why-fleets-wont-share-telematics-data
[58]: https://www.carriermanagement.com/features/2025/11/24/281755.htm
[59]: https://www.fleetowner.com/technology/news/55389514/cambridge-mobile-telematics-expands-fleet-insurance-telematics-through-geotab-marketplace
[60]: https://www.withterminal.com/product/insurance
[61]: https://sambasafety.com/capabilities/telematics-aggregation/
[62]: https://www.truckercloud.com/blog/top-commercial-auto-insurers-partner-with-truckercloud-for-innovation-in-telematics-data-access-and-analytics
[63]: https://www.samsara.com/blog/differentiate-your-insurance-programs-with-samsara
[64]: https://www.geotab.com/fleet-management-solutions/commercial-fleet-insurance/
[65]: https://www.globenewswire.com/news-release/2020/05/19/2035918/0/en/New-Verisk-Data-Exchange-Integration-for-Insurance-Telematics-Now-Available-on-the-Geotab-Marketplace.html
[66]: https://www.verisk.com/company/newsroom/tomtom-telematics-flows-commercial-driving-data-to-verisk-data-exchange/
[67]: https://www.eff.org/deeplinks/2024/07/senators-expose-car-companies-terrible-data-privacy-practices
[68]: https://risk.lexisnexis.com/products/telematics-exchange
[69]: https://risk.lexisnexis.com/products/telematics-ondemand
[70]: https://www.virginiatransportation.com/wp-content/uploads/2022/03/Samsara-Safety-Score-Calculation.pdf
[71]: https://kb.samsara.com/hc/en-us/articles/360045237852-Safety-Score-Categories-and-Calculation
[72]: https://kb.samsara.com/hc/en-us/articles/360043160532-Safety-Score-Weights-and-Configuration
[73]: https://samsara1678209876.zendesk.com/hc/en-us/articles/26047508272269-Driver-Speeding-and-Speed-Limits
[74]: https://helpcenter.gomotive.com/hc/en-us/articles/21827352179741-Updated-Safety-Score-settings-and-defaults
[75]: https://helpcenter.gomotive.com/hc/en-us/articles/6162164321693-Motive-Safety-Score
[76]: https://support.geotab.com/help/mygeotab/reports/safety-reports/driver-safety-scorecard
[77]: https://www.geotab.com/fleet-management-solutions/collision-risk/
[78]: https://vtechworks.lib.vt.edu/server/api/core/bitstreams/a9ea982a-1bb7-4637-aa16-39b323dda6a8/content
[79]: https://www.lytx.com/features/dynamic-risk
[80]: https://www.verizonconnect.com/resources/article/driver-risk-profiling/
[81]: https://www.progressive.com/auto/discounts/snapshot/snapshot-faq/
[82]: https://christensenhymas.com/articles/progressive-snapshot-may-actually-raise-rates/
[83]: https://www.claimsjournal.com/news/national/2015/03/26/262533.htm
[84]: https://www.allstate.com/help-support/drivewise-support/faqs
[85]: https://www.inverse.com/innovation/tesla-fsd-score-explained
[86]: https://www.ressources-actuarielles.net/EXT/ISFA/1226.nsf/0/bf4517bb19eee4cec125704600554ce6/$FILE/chapter8.pdf
[87]: https://www.researchgate.net/figure/Proportion-of-the-total-length-of-all-roads-with-maximum-speed-information-in_fig1_338659062
[88]: https://docs.tomtom.com/pricing
[89]: https://www.teltonika-gps.com/use-cases/telematics/tracker-for-insurance-telematics-industry
[90]: https://www.5starsp.com/Portals/25/Fleet%20Application.pdf
[91]: https://help.vertafore.com/AMS360/content/contextsensitive/acordforms/acordformmaps/form_map__business_auto_section_acord_127.htm
[92]: https://www.linxup.com/blog/how-telematics-lowers-commercial-auto-insurance
[93]: https://www.greatamericaninsurancegroup.com/content-hub/loss-control/details/key-elements-of-a-commercial-fleet-safety-program
[94]: https://www.northlandins.com/resources/safety-management/elements-of-fleet-safety-program
[95]: https://www.liveviewgps.com/gps-tracking-statistics/construction-equipment-theft/
[96]: https://www.jacksonlewis.com/insights/new-jersey-notice-employees-required-using-tracking-devices-vehicles-used-employees
[97]: https://www.nysenate.gov/legislation/laws/CVR/52-C*2
[98]: https://timeero.com/resources-page/employee-gps-tracking-laws
[99]: https://www.law.cornell.edu/uscode/text/15/1681a
[100]: https://www.law.cornell.edu/uscode/text/15/1681b
[101]: https://www.independentagent.com/vu_resource/running-mvrs-for-commercial-auto-clients-2/
[102]: https://www.federalregister.gov/documents/2024/11/12/2024-26099/consumer-financial-protection-circular-2024-06-background-dossiers-and-algorithmic-scores-for-hiring
[103]: https://www.federalregister.gov/documents/2025/05/12/2025-08286/interpretive-rules-policy-statements-and-advisory-opinions-withdrawal
[104]: https://www.law.cornell.edu/uscode/text/15/1681s-2
[105]: https://www.hklaw.com/en/insights/publications/2022/12/california-employee-data-exemption-expires-on-january-1
[106]: https://termly.io/us-data-privacy-laws/
[107]: https://www.law.cornell.edu/cfr/text/49/395.1
[108]: https://www.fmcsa.dot.gov/hours-service/elds/general-information-about-eld-rule
[109]: https://www.scstatehouse.gov/code/t38c099.php
[110]: https://www.insurancejournal.com/magazines/mag-features/2024/02/19/761025.htm
[111]: https://www.genovaburns.com/news/articles/2020-02-07-affinity-insurance-brokerage-a-primer-on-compensation-to-unlicensed-parties
[112]: https://www.scstatehouse.gov/code/t38c044.php
[113]: https://doi.sc.gov/411/Managing-General-Agent
[114]: https://content.naic.org/sites/default/files/model-laws-project-history-225.pdf
[115]: https://www.progressivecommercial.com/commercial-auto-insurance/commercial-auto-cost/
[116]: https://www.insureon.com/small-business-insurance/commercial-auto/cost
[117]: https://www.housecallpro.com/resources/coverdash-housecall-pro-business-insurance/
[118]: https://www.flexoffers.com/affiliate-programs/insureon-small-business-insurance-affiliate-program/
[119]: https://uppromote.com/blog/insurance-affiliate-programs/
[120]: https://verticalinsure.com/
[121]: https://insifter.com/commission-benchmarks.html
[122]: https://umbrex.com/resources/industry-primers/financial-services-industry-primers/insurance-brokers-and-mgas-industry-primer/
[123]: https://riskandinsurance.com/mga-premiums-hit-108-7-billion-in-2025-as-capacity-scrutiny-tightens/
