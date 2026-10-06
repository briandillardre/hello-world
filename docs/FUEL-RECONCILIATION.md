# Fuel reconciliation — the 90-day pilot

**Page:** `/receipts/fuel` (linked from /receipts) · **Migration:** `130_fuel_check.sql` ·
**Engine:** `lib/fuel-check.ts` (pure; harness `node scripts/fuel-check-test.mjs`) ·
**Server:** `lib/db/fuel-check.ts`, `lib/actions/fuel-check.ts`, `lib/fuel-geocode.ts` ·
**Nightly:** `/api/cron/fuel-check` (09:35 UTC) · **AI:** `fuel_exceptions` (Ask AI + the MCP door)

## Why, and what we deliberately do not do

The market moved in 2026: Geotab and Samsara now **decline** fuel-card
purchases at the pump off their telematics. That only works when the
telematics company is also the card company, and it fails the contractor
whose fuel is bought on three kinds of card for trucks, machines and cans.

HammerTrack's position is **vendor-neutral reconciliation**:

- **We do not issue a fuel card.** Any card works — a bank card, a credit
  card, a WEX/Fuelman/Comdata fleet card, all at once.
- **We do not decline anything.** Nothing touches a payment. The output is a
  short list of purchases a person should look at, with the evidence.
- **We never say "theft".** The word is *exception*. A false alarm about a
  driver is worse than a missed one; the pilot exists to measure exactly that.
- **Four exceptions, no more.** Anything else stays a receipt.

## The four checks

Every purchase is read against the assigned vehicle's own evidence. Each check
answers **pass**, **exception**, **can't check** (with the reason — the
`missing` list) or **waiting** (the evidence window is still open).

| Check | Exception when | $ at risk |
|---|---|---|
| **Vehicle not at the pump** (`asset_absent`) | Timed purchase: the vehicle was never within **250 m** of the station within **±30 min** (a stationary fix, or any fix within 100 m — a quick top-off may record no stop). Date-only: it never **stopped** within **300 m** that day. Station not placed: it stopped at **no fuel station** that day (every off-site stop looked up). The sentence says where it was instead, and which **other** company vehicle was at the pump ("wrong vehicle on the card"), and whether the cardholder's phone was there. | the purchase |
| **More gallons than the tank holds** (`gallons_exceed_tank`) | Gallons (as exported, from the pump price, or *estimated* from $ ÷ the default $/gal — labelled "about") exceed the room in the tank + tolerance. Room = tank × (1 − level before the fill); level from the gauge (the fill it matched, else the reading just before — never older than 2 h — else the day's lowest); no gauge = the whole tank. Tolerance = max(2 gal, 10 % of the tank), + 15 % of an estimate. DEF is never compared to the fuel tank. | excess gal × price |
| **No running after** (`no_runtime_after`) | No fill on the gauge and no engine-on / movement in the **24 h** after the purchase (date-only: the day + 24 h), while the tracker kept checking in. A machine with no tracker (a can, a bulk tank) is "can't check". | the purchase |
| **Outside the shift, hours or area** (`outside_shift_or_area`) | Any of: not a company work day; more than **60 min** outside the company's work hours; the cardholder uses the time clock but wasn't clocked in (±30 min); the station is more than **5 mi** from every site, yard, vendor zone, saved place **and** the vehicle's route that day. A property boundary does not count as an approved area. | the purchase |

Severity: **high** = strong evidence (a timed purchase at a pinned station 14 mi
from the truck; actual gallons well past the tank; a gauge that watched and saw
nothing; a Sunday or the middle of the night). **Low** = near misses (under
800 m — the geocode may be a lot off), a report long before the purchase, or
hours just past the grace. Everything else medium.

**Recoverable dollars** = for each purchase with a *valid* exception, the
largest dollars-at-risk among them, never more than the purchase — the same
dollars are never counted twice.

## Exactly what to export

Import at `/receipts/fuel` → **Import purchases**. Paste or pick the CSV; the
preview shows how every column was read (change any of them), which lines are
fuel and why the rest were left out. Re-importing the same file adds nothing.
**Export the last 90 days.**

**Best: a fleet fuel card** (WEX, Fuelman, Comdata, Voyager …). Ask the
provider's portal for the *transaction detail* export as CSV with:

- Transaction date **and time** (the time is what makes "at the pump" strong)
- Site / merchant name, **street address**, city, state (places the station exactly)
- Product (diesel / unleaded / DEF — car washes and merchandise are dropped)
- Units / gallons and price per gallon
- Net amount
- Card number (last 4 is enough), driver, vehicle / unit number, odometer
- Transaction / reference id (makes re-imports exact)

**Also fine: a bank or credit card statement** (Chase, Capital One, Amex …):
*Download account activity → CSV*, 90 days. Date, description and amount are
enough; the issuer's own category ("Gas", "Gas/Automotive",
"Transportation-Fuel", MCC 5541/5542) helps. Only fuel lines are kept (brand —
Spinx, QuikTrip/QT, RaceTrac, Circle K, Speedway, Shell, Exxon/Mobil, BP,
Marathon, Sunoco, Pilot/Flying J, Love's, Murphy, Sam's/Costco fuel,
Kangaroo, Ingles fuel … — a fuel word, or the category); lines under $15 with
no gallons are dropped as "the store, not the pump". Amex's export with
*additional transaction details* carries the merchant's address — use it.

A bank line has **no time of day**, so the presence check falls back to "did it
stop there that day", and gallons are estimated. That is the main gap the
pilot will measure; card **instant alerts** (Receipts → Instant receipt chase)
carry the time and are mirrored into the pilot automatically once live.

Times are read in the company's time zone. Charges written as negatives
(Chase) are flipped; refunds, credits and payments are dropped.

## Setup, once (Cards & tanks)

1. **Which vehicle each card fuels**, from a date. A card that moves to another
   truck gets a new row from the day it moved — earlier purchases keep their
   vehicle. A person's card with no vehicle stays "no vehicle"; the checks then
   say who *was* at the pump instead.
2. **Tank size** for every vehicle and machine (stored as
   `assets.metadata.fuel_tank_gal`, which Ask AI's gallons answers also read).
3. Settings: the pilot start date (set by the first import), default $/gal
   (only to estimate gallons on lines without them), the approved-area radius,
   the run-after window.

An export's vehicle column is matched to a vehicle by name / plate / serial /
VIN when the match is unique; its driver column to a teammate; its job column
to a site.

## The pilot protocol (DCG)

- **Day 1** — import 90 days from every card source; set cards → vehicles and
  tank sizes; press *Re-check 14 days* once the setup is in.
- **Days 1–30 — classify every exception.** Open the queue every working day
  (or at least twice a week). For each one: look at the evidence, ask the
  driver if needed, then mark
  - **Valid** — the fuel did not go where it should, or nobody can explain it;
  - **False alarm** — a legitimate explanation (fuel cans for a machine, the
    export named the wrong store, the truck swap wasn't recorded, a bulk tank);
  - **Unsure** — needs follow-up; it stays in the queue and doesn't count as
    decided.
  Always add a one-line note — the notes are how the rules get tuned.
- **Days 31–90** — keep importing (weekly or monthly); verdicts still count.
  The nightly run re-checks the last 14 days as late evidence arrives (a gauge
  reading, the next morning's engine start); an exception that later passes is
  cleared, never deleted, and keeps its verdict.
- **Day 90** — read the three numbers off the scorecard (or ask the AI "how is
  the fuel pilot going"); export the CSV of every exception and verdict.

## Success criteria (the deliverable)

1. **Recoverable dollars** over the 90 days, and annualized for a fleet our
   size. The bar: it pays for the feature for a typical customer.
2. **False-positive rate** = false alarms ÷ decided (valid + false), per check
   and overall. The bar: **≤ 30 %** on at least 20 decided exceptions; a check
   above 50 % gets its rule changed or dropped before any customer sees it.
3. **The missing-telemetry list**, ranked by the dollars each gap left
   unchecked ("3 vehicles have no tank size", "the F650 sends no fuel level",
   "80 % of purchases have no time of day — a fleet-card export or card
   alerts add it") — each with a named fix and a cost.

## What production looked like when the pilot was built (Oct 6 2026)

- `expenses` and `company_cards` are empty — the first data is a CSV export.
- Fuel level (`can.fuel.level`) arrives from the RAM 3500, the Charleston RAM
  2500 and F350 (and the Tundra, last in August). The F650 and F750 (J1939)
  and the 2000 F-250 and 2003 2500HD send none; battery units and the OEM
  dozer never will. The F350's gauge goes silent for hours while driving (the
  "computer stopped answering" fault) — fills are still read across the gap.
- **No vehicle has a tank size.** Every tank check is "can't check" until set.
- The time clock holds 3 entries in total — the shift check stays silent until
  the crew clocks in through the app ("no clock" in the missing list).
- 22 zones, no saved places.

## How it runs

- **Import / Re-check / setup changes** check right away within ~35–40 s;
  whatever is left is finished by the nightly run.
- **Stations** are placed by Photon (OpenStreetMap, keyless — the geocoder the
  rest of the app uses): the brand's stations around the bank line's city
  (`brand` — "the nearest Spinx in Goose Creek"), the brand's station nearest a
  fleet export's address (`exact`), or the city (`city`). Per company cache,
  at most three lookups at once, budgeted; a provider error is retried next
  run, an honest "nothing" is remembered. An unplaced station leaves "at the
  pump" asking whether the vehicle stopped at *any* fuel station (OSM
  fuel-only reverse lookups of its off-site stops).
- **Evidence reads** are bounded and indexed: `fuel_near` (fixes near the
  station in a ≤ 36 h window, via the geom GiST box), `fuel_stops` (stop
  clusters, ≤ 36 h), `fuel_gauge` (only fixes carrying a level, ≤ 60 h), plus
  single-row reads for the fix before/after and the first engine-on after.
  The route for the area check comes from the daily trail rollups.
- **Writes** go through the service role after the edit + costs checks; a check
  never writes a verdict column. Reads need the Receipts page and the $
  figures (RLS: `ht_viewer_can_costs()`), follow asset visibility (111), and
  are closed to prospects (119).

## Known limits

- A bank line without a time can't prove where a truck was at the moment.
- Machines are often fuelled from cans or a bulk tank — expect "vehicle not at
  the pump" false alarms on equipment; mark them and the rate will show it.
- Trucks without a fuel level (J1939 trucks, older OBD) lean on the room check
  against the whole tank and on runtime only.
- Battery GPS units send no ignition and sleep at stops — presence and runtime
  are weaker on them (marked in `missing`).
- Photon's public instance can be slow (seconds a call); a big import places
  its stations over a night or two.
