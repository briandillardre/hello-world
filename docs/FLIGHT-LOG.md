# Flight log — aircraft history by tail number

Built Sep 12 2026. Brian: *"I want plane flight log history added. Should be
able to search tail numbers, see all prior flights, save planes etc. Also
altitude and ground speed and vertical speed charts as an option when a plane
or flight from flight log is clicked."*

/ `lib/aircraft-log.ts` (the math) · `lib/aircraft-source.ts` (upstream) ·
`lib/db/aircraft.ts` (storage) · `/aircraft` (the page) ·
`scripts/flightlog-test/run.sh` (the harness) /

## The one fact the whole design turns on

**The free archive keeps a rolling ~30 days.** Probed the day this shipped:
12 Aug answered, 5 Aug was gone, today was 12 Sep. There is no free source
for older tracks at any price — the same honest-NO list that ruled out live
AIS and freight rail (CLAUDE.md → Navigation wave, open-data recon).

So the feature splits in two, and the split is the product:

| | Where it comes from | How far back |
|---|---|---|
| **Search any tail** | adsb.lol archive, read live | ~30 days, instantly, nothing set up |
| **A saved plane** | our own `aircraft_flights` rows | forever, from the day it was saved |

That is what the save button is *for*. It is not a bookmark — it is the
instruction that starts writing the history down. The UI says so at the
button, because a bookmark that quietly turns out to be the only copy of
your history is a nasty surprise.

## The pieces

| Piece | What it does |
|---|---|
| `lib/aircraft-log.ts` | PURE. Parse a trace file → fixes → flights. No network, no DB. |
| `lib/aircraft-source.ts` | adsb.lol traces (today + archive) and adsbdb identity, cached, staggered. |
| `lib/db/aircraft.ts` | Saved planes, banked flights, and `getFlights` — banked first, upstream only for the days we lack. |
| `lib/actions/aircraft.ts` | Save / rename / remove, behind `requireEditOrThrow`. |
| `/api/aircraft/search` | Tail number **or** hex → one airframe. |
| `/api/aircraft/flights` | The list for one airframe (tracks stripped). |
| `/api/aircraft/flight` | One flight **with** its track, for the charts. |
| `/api/cron/aircraft-log` | Nightly, 02:20 UTC. Banks every saved plane's finished flights. |
| `components/aircraft/` | The page, the flight rows, the plan view, the three charts. |

## Reading a trace

One file is one UTC day for one airframe. Each fix is a positional array:

```
[0] seconds after the file's `timestamp`
[1] lat   [2] lon
[3] barometric altitude ft, or the STRING "ground"
[4] ground speed kt      [5] track deg
[6] flags                [7] baro rate fpm  ← vertical speed, ~87% populated
[8] details object (carries `flight`, the callsign)
```

All three charts Brian asked for are in there already. Where `baro_rate` is
missing it is derived from the altitude either side of the fix (never the
step before it — one jittery reading would spike the chart), clamped at
±12,000 fpm because anything beyond that is an artefact, not an aeroplane.

## Cutting a day into flights

A flight is a run of airborne fixes, ended by a ground stop of 4 minutes or a
hole in the data of 15. Four rules earned their place:

1. **"On the ground" is the feed's own flag, never an altitude threshold.**
   Barometric altitude is above sea level, so a jet parked at Denver reads
   ~5,300 ft. Any "below N feet = landed" rule loses every takeoff from a
   high-elevation field.
2. **A short airborne run that never climbs is dropped** — taxiing with a
   flickering ground flag is not a two-minute flight. But this applies ONLY
   to segments closed at both ends: a fragment running to the edge of its day
   file is half of something bigger, and the far side of a red-eye is pure
   cruise with no climb in it. Applying the climb test to fragments deleted
   every midnight crossing. The harness caught it.
3. **Midnight crossings are stitched**, but only when the two halves meet at
   the boundary in *both* time (≤ 15 min) and space (≤ 40 nm). A coincidence
   of timing must not weld a Georgia trip to a British one.
4. **A segment nobody saw take off or land is flagged, not sold as a short
   flight.** An airliner with a coverage hole produced an "11 minute, 63 nm
   flight starting at 25,000 ft". Splitting there is right — we will not draw
   a line through an hour we cannot see — but the row has to say *partial*
   (`departed` / `arrived` / `isPartial()`), or the log is lying about what
   it knows.

## Run the harness

```
./scripts/flightlog-test/run.sh
```

Same standing as the ledger and navigation harnesses: **run it after ANY
change to `lib/aircraft-log.ts`.** It drives two REAL archive files (baked in
under `scripts/flightlog-test/`, so it needs no network) plus synthetic edge
cases, and asserts the things a pilot reading their own log would notice — a
takeoff that never happened, two trips welded together, a red-eye cut in
half, a chart with holes in it. 48 assertions.

The ledger harness exists because hours are money and the nav harness exists
because a missed turn is dangerous. This one exists because a flight log that
invents a flight is worse than no flight log.

## The charts

Three charts, never one with three y-axes — altitude in feet, speed in knots
and climb rate in feet-per-minute share nothing but time. They are small
multiples on a shared x with ONE crosshair and ONE readout across all three,
which answers the actual question ("what was it doing *here*?").

* Altitude and ground speed are single series, so no legend — and they keep
  the brand hues the map popup already uses for the same quantities.
* **Vertical speed is diverging**: climbing and descending are opposite
  states, not more-and-less of one. Two hues, neutral gray midpoint, symmetric
  about zero. The pair (`#0d9488` / `#d97706`) is validated against the navy
  surface — OKLCH band, chroma, CVD ΔE 12.5, normal-vision 24.3, contrast, all
  pass.
* The line **breaks at coverage gaps** rather than drawing straight through
  them, and a "Show numbers" table gives the same data without hovering or
  reading a colour.

## Being a good guest

adsb.lol and adsbdb are free community services and this feature could
trivially abuse them.

* Archive days are immutable once past, so a day read once is never read
  again — it goes into `aircraft_flights` and stays. A saved plane costs one
  fetch per day, ever.
* Day files go out three at a time with a stagger, never thirty at once.
* In-process caches on top (60 s for today, 6 h for a finished day, 24 h for
  identity).
* Every route is signed-in and rate-limited; none of this is an open proxy.
* adsb.lol data is **ODbL** and credited on the page. adsbdb stays
  query-and-display — one airframe at a time, never bulk-imported (same rule
  as the map popup's filed routes).

## Known gaps

* **No airport names.** Departure and arrival are coordinates, drawn as a
  plan view. Naming them needs an airport table — OurAirports is public
  domain and importable (unlike adsbdb's route DB), and `from_label` /
  `to_label` columns are already waiting in 108.
* **Banked flights are keyed by airframe, not company.** Two companies
  watching the same jet share one copy — it is public ADS-B, and fetching it
  twice would be rude to the upstream. Who watches what stays private:
  `aircraft_saved` is company-scoped under RLS.
* **The cron does 40 airframes a run.** Fine for now; past that it needs the
  longest-unsynced-first queue it already has plus more runs per day.
* **Nothing links a flight to a job.** The obvious next step if Brian ever
  wants this to be more than an extras layer: match a landing against a site
  zone and put the trip on the day's timeline.
