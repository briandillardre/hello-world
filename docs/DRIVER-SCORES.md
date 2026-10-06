# Driver safety scores — HammerTrack Safety Score v1

Brian, Oct 6 2026: *"We need driver scores for any OBD devices. Look around at how
this is done with a keen eye for insurance providers as this will be a future source
of revenue for us."*

This is the build. The research behind every number is
`docs/INSURANCE-TELEMATICS.md` §3 (scoring) and §4 (what an underwriter wants); the
math lives in ONE place, `SAFETY_METHOD` in `lib/driving-score.ts`, with a source
comment on every threshold and weight. The insurer report's method appendix is
generated from that constant (`lib/driving-method.ts`), so the page can never
describe a rule the math does not use.

**There is one safety score.** The old A–F "safety" grade inside `lib/scorecard.ts`
(speed stream only, sustained 70+/80+ share, top-speed spike, 10 PM–4 AM) is gone;
/reports now shows this score.

**No savings claims, anywhere.** Not in the app, not on the splash, not in the
report. The insurer report is the customer's own data, which they choose to hand
to their agent. What an insurer does with it is the insurer's business.

---

## Where it lives

| Piece | File |
|---|---|
| The engine (pure: detection, day rollup, totals, score, data quality, words) | `lib/driving-score.ts` |
| Storage + builder RPCs | `supabase/migrations/129_driving_scores.sql` |
| Fetch, build one vehicle-day, read a period | `lib/db/driving.ts` |
| Hourly builder | `app/api/cron/driving/route.ts` (`35 * * * *` in `vercel.json`) |
| Fleet / vehicle / driver page | `/reports/safety` (`?days=30\|90\|365`, `?asset=<id>`) |
| Insurer report (print → PDF) | `/reports/safety/insurer` |
| The report's tables as CSV | `/api/safety/export?kind=vehicles\|months\|events` |
| Asset page card | `SafetySection` in `app/(dashboard)/assets/[id]/page.tsx` |
| /reports chips + speeding flags | `app/(dashboard)/reports/page.tsx` |
| Ask AI + MCP tool | `safety_scores` in `lib/mcp-tools.ts` (shared into `lib/ai-tools.ts`) |
| Demo mode | `lib/driving-demo.ts` (the real math over invented rows) |
| Method in plain words | `lib/driving-method.ts` |
| Shared UI pieces | `components/reports/SafetyBits.tsx` |

Harnesses — run both after ANY change to the engine, the migration or the builder:

```
node scripts/driving-score-test.mjs                                   # 137 assertions
PSQL="psql -h localhost -p 5432 -U postgres" bash scripts/driving-sql-test/run.sh   # 42 checks, local PG 16
```

The SQL harness applies 129 VERBATIM to a bare PostgreSQL 16 (`setup.sql` stubs the
Supabase roles, `auth.uid()`, 111's visibility ladder, 115's `ht_safe_tz` and 119's
`ht_prospect_lockdown`), feeds the real `driving_day_fixes` answer through the TS
engine, and checks the write, the to-do lists and every read rule.

---

## The method (v1)

### Scope and exposure
- **Road vehicles only** (`assets.type = 'vehicle'`) with a cellular hardware tracker
  (15-digit IMEI). Machines, tools and phones never get a driving score.
- **Exposure** = miles and hours the tracker recorded while moving: consecutive fixes
  ≤ 120 s apart (`TRACKED_GAP_S`) with an average ≥ 2 mph. A jump of ≥ 800 m with
  nothing recorded in between (unplugged, off, out of coverage) is a **data gap**,
  never driving. Impossible GPS jumps were already refused at ingest (124).
- **Days are company-local** (`companies.digest_prefs.tz`), cut at midnight; every
  interval is clipped to the day, so a drive across midnight lands on both days
  exactly once. DST-safe (`zonedLocalMs`).

### Harsh events — scored from the accelerometer only

| Event | Light (≤ 10,000 lb GVWR) | Medium / heavy | Severe | Source |
|---|---|---|---|---|
| Hard braking | 0.32 g (3.1 m/s², ≈ 7 mph/s) | 0.20 g (2.0 m/s²) | 1.5 × threshold, counts double | Progressive Snapshot's 7 mph/s; Geotab heavy-duty |
| Hard launch | 0.28 g (2.7 m/s²) | 0.20 g | 1.5 × | Geotab light-duty truck / heavy |
| Hard cornering (≥ 30 km/h) | 0.35 g (3.4 m/s²) | 0.24 g (2.4 m/s²) | 1.5 × | Teltonika default; Geotab heavy |

- **Vehicle class**: the GVWR in the asset's specs (`metadata.gvwr` — a number in lb,
  "11,500 lb", "5,200 kg", or the VIN decoder's "Class 3: 10,001 - 14,000 lb") →
  ≤ 10,000 lb light, else heavy; without one, the map icon (dump truck, day cab, semi,
  mixer, box truck, water truck = heavy); else light.
- An event is **scored** only when it comes from the tracker's own accelerometer
  (Teltonika Green Driving, AVL 253/254) **and** the speed stream confirms it within
  **± 3 s**: ≥ 3 mph slower (braking), ≥ 3 mph faster (launch), ≥ 10° of turn
  (cornering) — the truck's own speedometer (`can.vehicle.speed`) where it reports
  one, else GPS. A spike the speed does not confirm (pothole, dropped tool) is listed
  as **unconfirmed** and not scored.
- **Until the accelerometer is on, harsh events are not measured** — never "zero".
  The score is then speeding + late night, the data-quality block says so, and
  hard stops/launches **estimated from GPS speed** are shown for coaching only, never
  scored. Why not score them: on the pilot trucks only ~11–19% of driving is sampled
  ≤ 3 s apart, and the speed column carries artifacts that read as violent events —
  tag-scan records (event 385) a second out of step, a GNSS speed still ramping after
  an outage (the F350 "launched" 39 → 47 mph at a steady 65 on Sep 29), static
  navigation (0 → 14 mph in one second while the speedometer read 33 km/h, Oct 2).
  `GPS_RULES` holds every guard (0.8–3 s pairs, ≥ 10 mph, ≤ 1 g, spike/reversal
  checks, speed must agree with the ground covered).
- **"Accelerometer on"** for a day = that day's fixes carried Green Driving keys
  (`accel_seen`), or one of the vehicle's days in the last 30 did (`accel_on`). The
  look-back reads `accel_seen` only, so a unit that is switched off ages out after 30
  days instead of keeping itself "measured" forever. A crash-detection record alone
  never counts (it is a separate scenario).
- **Possible impacts** (crash detection, ≥ 1.5 g for 5 ms, AVL 247 = 1 or 6; trace
  records 2–5 ignored) are listed with time and place, **never scored**.

### Speeding
- **Against a posted limit**, Samsara's tiers: moderate 6–10 mph over held ≥ 60 s,
  heavy 11–15 over ≥ 60 s, severe 16+ over ≥ 20 s. HammerTrack holds **no road speed
  limits yet**, so the tiers apply only inside sites with their own limit (a
  `speeding` alert rule's `max_mph` on a zone) and only well inside the fence
  (`speedEdgeMargin`: up to 25 m, less for a narrow site — the same rule as the zone
  speeding alert) — never on a road along it. An interval is over only when both of
  its ends are.
- **Top-speed line, limit known or not**: ≥ 80 mph (75 for medium/heavy) held ≥ 20 s
  = severe speeding, counted once (never also as a tier).
- Reported: the share of miles where a posted limit was known. The 70+ share is gone:
  70 on an interstate posted 70 is not speeding.

### Late night
Moving time 00:00–04:00 company time, weight 1 per 1% (Snapshot's window). 10 PM–
midnight is shown, not scored; 4–6 AM crew starts are never penalized.

### The score
`score = clamp(100 − Σ impacts, 0, 100)`:
- harsh events per 1,000 miles **driven with the accelerometer on** × weight —
  braking 4, cornering 2, launch 1 (Motive's published defaults); severe counts ×2;
- speeding, per 1% of moving time: moderate 1, heavy 4, severe 6 (Samsara's weights);
- late night, per 1% of moving time: 1 (our choice).

Grades A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F < 60; risk bands (Geotab's) 90+ low,
75–89 mild, 60–74 medium, < 60 high.

**Credibility.** No score under **250 miles and 10 moving hours** in the period (both).
Under **3,000 miles** a vehicle's or driver's score is blended toward the fleet's raw
score: `shown = Z × own + (1 − Z) × fleet`, `Z = √(miles ÷ 3,000)` (the actuarial
square-root rule). The fleet score is the same math over all vehicles' totals, so it
is mileage-weighted. Every score carries its raw rates (events per 1,000 mi by type
and severity, % time per speeding tier, late-night %, miles, hours) and, for trucks
that work more than they drive, confirmed events per 100 engine hours.

### Data quality — printed with every score
`dataQuality()`: accelerometer on / partial / off; confirmed · unconfirmed · GPS-
estimated counts; speed source (truck speedometer vs GPS, % of driving); % of miles
with a known limit; device uptime (days reporting ÷ days in the period); % of driving
actually recorded (moving vs gaps); times the truck stopped powering the unit
(`lib/power-loss.ts` rule) or the unit reported an unplug (AVL 252); GPS/cell
jamming (AVL 249); towing (AVL 246); GPS jumps refused at ingest
(`asset_location_rejects`, 124); % of miles tied to a named driver. Verdict good /
fair / poor.

### Drivers
A drive is matched to a person only when their phone — clocked in on the app
(`time_entries`) — rides within 150 m of the moving truck (≥ 5 mph) for five or more
one-minute bins (holes ≤ 3). Time with two phones aboard is "rode along" (shown,
never scored); a person's score is their **solo** time, and events are charged only
to a lone rider. Visibility: yourself, plus people you outrank (`/reports/safety`,
Ask AI); the company-key MCP door sees everyone (admin-grade, like time cards).
Prospective Clients see no driving data at all (RLS lockdown + the page). **The
insurer report carries no per-driver data.**

---

## Storage and the builder

`driving_daily` — one row per vehicle per company-local day: exposure, time per
speeding tier, event counts (scored, unconfirmed, estimated, impacts), data-quality
inputs, `accel_on` / `accel_seen`, `drivers` (`{ uid: { s, mi, ss, smi, ns, zm, zh, zs } }`
— `ss`… = solo), `version`. `driving_events` — the events behind the counts
(`(asset_id, kind, at)` unique). Reads: company members under the 111 ladder;
prospects locked out (`ht_prospect_lockdown(…, false)`); writes service role only.

`/api/cron/driving` (hourly, fails closed on `CRON_SECRET`):
1. **Changed days** — `driving_dirty(since)` lists vehicles with fixes that ARRIVED
   since the last run (`asset_locations.created_at`, look-back clamped to 2 days), so
   a unit that buffered offline lands in its real days; plus yesterday when its row
   was built before the day ended. Each day is rebuilt whole (`driving_put_day`:
   delete + insert in one transaction — twice = once). The watermark
   (`system_state['driving.since']`) moves only when every changed day was handled.
2. **Backfill** — `driving_backfill_todo` (a loose index scan, one probe per day with
   data) lists days in the last 90 with fixes and no row at the current
   `ENGINE_VERSION`, oldest first, ≤ 80 per company per run, inside a 220 s budget.
   A first deploy catches up over a few hourly runs; **bumping `ENGINE_VERSION`
   re-banks history the same way** — that is how a method change ships.
3. Event spots go through the geocode cache (`resolvePlaces`) for the words.

Nothing is built at deploy. Every builder statement is one vehicle-day (≤ 30,000
fixes) — no whole-history replays.

**ON REGISTRATION of the Charleston company** (CLAUDE.md's move list): add
`driving_daily` and `driving_events` to the tables re-keyed to the new `company_id`
with the four assets (or delete those rows and let the backfill rebuild them under
the new company).

---

## Turning on the accelerometer (FOTA WEB)

Every Teltonika scenario ships **off**; until Green Driving is on, harsh events are
not measured. Push this per vehicle class through FOTA WEB (the no-cable playbook in
`docs/DEVICE-ONBOARDING.md`), or as an SMS/GPRS `setparam`.

FMM00A parameter IDs — **verified Oct 6 2026 against the Teltonika wiki**
(FMM00A Parameter list / Features settings):

| Setting | ID | Wiki default | Set to |
|---|---|---|---|
| Green Driving scenario | 11000 | 0 (0 off · 1 low · 2 high · 3 panic priority) | **1** — events ride the next upload; no extra connection per event |
| Green Driving source | 11007 | 0 (0 GPS · 1 accelerometer) | **1** |
| Max acceleration (m/s²) | 11004 | 2.5 (0.5–10) | light **2.7** · heavy **2.0** |
| Max braking (m/s²) | 11005 | 2.7 | light **3.1** · heavy **2.0** |
| Max cornering (m/s²) | 11006 | 3.4 | light **3.4** · heavy **2.4** |
| Eco-driving duration in the record | 11008 | 0 (0/1) | leave 0 |
| Crash detection scenario | 11400 | 0 | **2** (high: sent at once) |
| Crash duration (ms) | 11401 | 5 | 5 |
| Crash threshold (mG) | 11402 | 1500 | 1500 |
| Unplug detection scenario | 11500 | 0 | **2** |
| Unplug eventual records · mode | 11501 · 11502 | 1 · 1 (advanced) | leave |
| Towing detection | 11600 | 0 | **1** |
| Towing activation timeout (min) · event timeout (s) | 11602 · 11603 | 5 · 0 | leave |
| Jamming scenario | 11300 | 0 | **1** |
| Accelerometer auto-calibration | 169 | 2 (continuous) | leave **2** |

Light trucks (pickups, vans):
```
setparam 11000:1;11007:1;11004:2.7;11005:3.1;11006:3.4;11400:2;11401:5;11402:1500;11500:2;11600:1;11300:1
```
Medium / heavy (dump trucks, F-650/750, tractors):
```
setparam 11000:1;11007:1;11004:2.0;11005:2.0;11006:2.4;11400:2;11401:5;11402:1500;11500:2;11600:1;11300:1
```

**Unverified — check on the first unit before the fleet:**
- The wiki types 11004–11006 as `Uint8` yet defaults them to 2.5/2.7/3.4 m/s², so
  whether `setparam` takes a decimal (`2.7`) or a scaled integer is **unverified**.
  Safe path: set the values in the Teltonika Configurator / FOTA WEB configuration
  file (which shows m/s²) and push the file; then read back with `getparam 11005`.
- Priorities above are our choice (1 = low keeps SIM data down; crash and unplug
  high so they arrive at once).
- Calibration: parameter 169 = 2 recalibrates continuously. The insurance research
  quotes Teltonika's `auto_calibrate:set` procedure (stopped on a straight, level
  road, then > 30 km/h for 5 s) — **unverified by us**; do it once per install anyway.
- The wired FMM650 / FMM150 have Green Driving too; their IDs and defaults are
  **unverified** — read each model's parameter list before pushing.
- The flespi names the engine reads for these events (`harsh.braking.event`,
  `harsh.acceleration.event`, `harsh.cornering.event`, `green.driving.type` /
  `.value`, `absolute.acceleration`, `crash.event` / `crash.detection`,
  `battery.unplug.event`, `towing.event`, `gnss.jamming.state`, with the aliases in
  `lib/telemetry-catalog.ts`) are what flespi's Teltonika protocol documents. **No
  pilot unit has sent one yet** (Green Driving has been off) — when the first event
  arrives, confirm its key names and its magnitude unit: `deviceG()` reads
  `absolute.acceleration` as g, and treats a `green.driving.value` over 1.5 as
  g × 100.

After the push: drive one truck, brake firmly once from ~30 mph, and check
`select raw from asset_locations where asset_id = … and raw ? 'harsh.braking.event'
order by "timestamp" desc limit 1;` — then `/reports/safety?asset=…` should show the
event as confirmed and the vehicle's quality chip should read "accelerometer" the
next hour.

---

## What insurers want, and the insurer report

From `docs/INSURANCE-TELEMATICS.md` §4: underwriters compare **normalized rates**
(per 1,000 miles, % time), want the **trend** over 12 months ("preferably on an
improving basis"), the vehicle schedule (year/make/model/VIN/class), and they discount
data they cannot trust — hence the data-quality block. Small fleets reach carriers
through their agent's submission packet: a clean PDF + CSV.

`/reports/safety/insurer` (v1):
1. **Summary** — fleet score, grade and band, vehicles scored, miles · moving hours ·
   engine hours, data-quality verdict; the headline rates with counts.
2. **Monthly trend** — trailing 12 months, score and rates per month.
3. **Vehicle schedule and scores** — year / make / model, VIN (from the truck's own
   computer, `vehicle.vin` in 115, else the asset's specs), class, miles, score,
   rates, data.
4. **Data quality** — every line of the block.
5. **Method** — `methodSections()`, generated from `SAFETY_METHOD`.
6. An attestation line for the owner to sign.

Gates: **≥ 90 days of data and ≥ 3 scored vehicles**, else the page says how far
there is to go; marked **low credibility under 10,000 fleet miles**. Who: the
**billing** ability (owner + admins by default) — the report is a company document
handed to an outside party, the same trust as connecting QuickBooks; `manage_team`
is about people inside the company, and this report carries no per-driver data.
Never in a view-as preview, never for a Prospective Client. CSV:
`/api/safety/export?kind=vehicles|months|events` (same gate; events carry time,
vehicle, VIN, kind, severity, source, scored or not, magnitude, site — no people, no
coordinates).

Not built yet (from §4's fuller list — board items): length-of-haul bands, after-hours
/ weekend miles, coaching log, maintenance & health section (check-engine miles are
already computed), theft controls, incidents with replay links, DOT short-haul
summary, a verify link (`/x/<id>`), a JSON export, driver roster with consent.

---

## Known limits and next

- **Posted road limits** — none yet; the tiers only see sites with a limit. Next:
  TomTom Snap to Roads (the map already takes a TomTom key) for moving segments, then
  the % of miles with a known limit climbs from ~5%.
- **Accelerometer off on every pilot unit** — push the config above.
- **Medium-duty trucks that answer nothing over the OBD port** (F-650/750) read GPS
  speed only; the FMM00A's J1939 mode (board #183) would give them a speedometer.
- **Per-person reads are page-level, not row-level**: RLS lets any member read the
  company's `driving_daily.drivers` / `driving_events.person_id`; the outrank rule is
  enforced in `getSafetyReport` (and the MCP door). A person-level RLS split is a
  follow-up if a crew login ever gets raw table access beyond the app.
- Following distance and phone use (the heaviest weights in camera-based scores) are
  **not measured** without cameras — say so; never imply.

## Sources (as cited in docs/INSURANCE-TELEMATICS.md)
- Teltonika — FMM00A parameter list: <https://wiki.teltonika-gps.com/view/FMM00A_Parameter_list>
- Teltonika — FMM00A features settings: <https://wiki.teltonika-gps.com/view/FMM00A_Features_settings>
- Geotab — rules overview (GPS harsh-event thresholds by class): <https://support.geotab.com/help/mygeotab/groups-and-rules/rules/rules-overview>
- Geotab — driver safety scorecard (risk bands): <https://support.geotab.com/help/mygeotab/reports/safety-reports/driver-safety-scorecard>
- Samsara — safety score weights (excerpt): <https://kb.samsara.com/hc/en-us/articles/360043160532-Safety-Score-Weights-and-Configuration>
- Samsara — driver speeding and speed limits: <https://samsara1678209876.zendesk.com/hc/en-us/articles/26047508272269-Driver-Speeding-and-Speed-Limits>
- Motive — safety score settings and defaults (excerpt): <https://helpcenter.gomotive.com/hc/en-us/articles/21827352179741-Updated-Safety-Score-settings-and-defaults>
- Progressive Snapshot hard-brake definition (secondary, excerpt): <https://christensenhymas.com/articles/progressive-snapshot-may-actually-raise-rates/>
- Claims Journal — Snapshot late-night window (2015): <https://www.claimsjournal.com/news/national/2015/03/26/262533.htm>
- CAS — Foundations of Casualty Actuarial Science, ch. 8 "Credibility": <https://www.ressources-actuarielles.net/EXT/ISFA/1226.nsf/0/bf4517bb19eee4cec125704600554ce6/$FILE/chapter8.pdf>
- Trucordia — safety investment credit at renewal (90-day history): <https://www.trucordia.com/blog/your-safety-investment-deserves-more-credit-at-renewal>
