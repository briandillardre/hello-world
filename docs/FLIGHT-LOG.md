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
3. **The same flight from two files is one flight.** adsb.lol's live
   `trace_full` is "the current trace" — for an aircraft that has not flown
   today it still serves its last session, so the same trip arrives from both
   the live file and the archived day, under the same id. Seen on a real
   Cirrus the day this shipped.
4. **Midnight crossings are stitched**, but only when the two halves meet at
   the boundary in *both* time (≤ 15 min) and space (≤ 40 nm). A coincidence
   of timing must not weld a Georgia trip to a British one.
5. **A segment nobody saw take off or land is flagged, not sold as a short
   flight** (after the field-elevation test above has had its say). An airliner with a coverage hole produced an "11 minute, 63 nm
   flight starting at 25,000 ft". Splitting there is right — we will not draw
   a line through an hour we cannot see — but the row has to say *partial*
   (`departed` / `arrived` / `isPartial()`), or the log is lying about what
   it knows.

## Touch-and-goes and pattern work

Brian, Sep 12, describing his own flight: *"Also need a way to show how many
touch and gos were done etc. Vs categorizing as multiple flights. For example
yesterday I went gmu to grd and did a bunch of touch and gos then back to
gmu. Would be a nice feature to show traffic pattern consistency."*

The "vs categorizing as multiple flights" half already held — a touch-and-go
never produces the four-minute ground stop that ends a flight, so the trip
came through as one. What was missing was saying what happened in the middle.

**What a touch-and-go actually looks like in ADS-B**, from that exact flight
(N575LD at Greenwood County, 11 Sep): the aircraft comes down the pattern to
a few hundred feet above the field, **vanishes for two or three minutes** —
small fields have no receiver coverage at runway height — and reappears
climbing back to circuit altitude. The touchdown itself is essentially never
in the data. So `lib/pattern.ts` detects the DIP, not the wheels: a descent
below 500 ft AGL within 3 nm of a known field, with hysteresis at 800 ft so a
wobble on final is not counted twice.

Two false positives had to be designed out, both real:

* **The take-off is not an arrival.** A flight starts low over the field it
  departed, so every A-to-B trip was reporting a phantom touch-and-go at its
  origin. A dip that begins at the first fix is the departure.
* **A cross-country is not a circuit.** GMU → Greenwood → GMU was reported as
  one lap with a 42 nm downwind. A lap that strays more than 5 nm from the
  field is a departure and a return, not a circuit.

What comes out for that flight, from the real trace:

```
4 touch-and-goes at Greenwood County
Pattern altitude held within 12 ft of 902 ft AGL · laps 4:58 ± 22s
                                                  · downwind 2.0 ± 0.1 nm
```

**Consistency is shown as a shape, not a score.** The laps are drawn on top
of each other at one scale (`components/aircraft/PatternCard.tsx`); three
circuits that stack into a single line say more than any statistic, and the
table underneath is there to be quoted. The laps take a SEQUENTIAL ramp (one
hue, light → dark by lap order) because they are the same thing repeated —
categorical hues would imply they differ in kind. Each touchdown also gets a
tick on the altitude chart, so a row of sawteeth reads as circuits.

Detection runs on the **full-resolution** fix stream inside `segmentFlights`
(the stored `track` is downsampled to 400 points, which thins a two-minute
circuit past the point the dips survive), and the result is stored on
`aircraft_flights.pattern` by migration 109.

### What the review pass caught

Three of these would have shipped as silent wrong answers:

* **Pressure altitude is not MSL.** Trace altitudes are `alt_baro`, referenced
  to 29.92; field elevations are true MSL. A tenth of an inch of mercury is
  ~100 ft, and the real flight bottoms out 81 ft under the 500 ft threshold —
  so on an ordinary high-pressure morning the same flight detected **zero**
  touch-and-goes. The segmenter now measures the day's offset where the
  aircraft is known to be ON a field (`baroOffset`) and subtracts it. The
  harness sweeps ±300 ft.
* **A low pattern was invisible.** Helicopters and ultralights fly circuits at
  500-700 ft AGL and never climb through a fixed 800 ft "clear" height, so
  every lap merged into one endless dip and the whole session vanished. A dip
  now also ends 300 ft above **its own** lowest point.
* **A session across UTC midnight was two rows.** Pattern work was
  concatenated blind across a stitch, so one airfield appeared twice with the
  count split between them — and 00:00 UTC is 8 PM Eastern, which is exactly
  when a pilot flies night landings for currency. `mergePatternWork` unions by
  field, re-flags the seam approach as a go-around and recomputes the spread.

Also: a lap that leaves to do airwork at 3,000 ft is no longer averaged in
with the circuits (it was reporting "1,500 ft ± 866" for a pattern flown at a
rock-steady 1,000); a single balked landing reads "1 go-around", not "1
touch-and-go"; circuit paths are thinned to 64 points before banking; and the
flight LIST no longer drags every circuit's ground track out of Postgres just
to show a count.

Field elevation earns its keep twice here: it is how a dip is measured, and
it is how `departed` / `arrived` are decided now that the resolver is
injected into the segmenter — so the two layers cannot disagree about whether
an aircraft was ever on the ground.

## Run the harness

```
./scripts/flightlog-test/run.sh
```

Same standing as the ledger and navigation harnesses: **run it after ANY
change to `lib/aircraft-log.ts`.** It drives two REAL archive files (baked in
under `scripts/flightlog-test/`, so it needs no network) plus synthetic edge
cases, plus `pattern-day.json`, the real trace of Brian's Greenwood County training
flight, and asserts the things a pilot reading their own log would notice — a
takeoff that never happened, two trips welded together, a red-eye cut in
half, a training session filed as eight flights instead of one, a chart with
holes in it. 71 assertions.

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

## Flying it back

`components/aircraft/FlightPlayback.tsx`. Play, scrub, 10× – 120×.

Speeds are multiples of **real time**, the way FR24 and the rest of this app
mean them: at 60× a minute of flight passes in a second. The clock is what
advances, not an index — stepping one fix per frame would run a sparse
stretch of track faster than a dense one, which is exactly the lie the map's
trail scrubber avoids. The plan view brightens the flown portion and carries
the aircraft; the three charts' crosshair follows the same moment.

Two rules kept from the map timeline: **nothing animates while paused**, and
the pointer always wins — hovering a chart reads the point under your finger
even mid-replay, and dragging one scrubs the replay rather than fighting it.

## One box, three answers

FR24's search takes "Flight number, airport, route or reg", and now so does
ours:

| Typed | Answer |
|---|---|
| `N628TS`, `a835af` | the aircraft |
| `KGMU`, `GMU` | that airfield's board |
| `GMU-CLT`, `GMU to CLT` | the board, filtered to that route |

**Aircraft is tried first**, deliberately: a registration can look exactly
like an airport code (N92 is both a tail number and a New Jersey field), and
someone typing into a flight log means the aeroplane. A field the company is
not watching still opens — with a line saying nobody is recording it yet.

### …including the map's search bar

Brian typed `N575ld` into the map's find-anything box — the obvious place to
type a tail number — and got **"N5 2LD, London"**, the geocoder happily
reading a registration as a British postcode.

`MapSearch` now asks the flight log too, and ranks aircraft and airfields
**above** every address hit, because a tail number that also looks like a
postcode is an aeroplane. It only asks when the text could BE one
(`looksAeronautical`: an airfield code, a route, or letters-with-a-digit) —
verified that "Greenville", "Woodruff Road" and "Chevy" make zero calls to
our API. Picking the row opens that aircraft's log or that field's board.
Hidden entirely for a role without the `aircraft` view level.

**Sep 21 — it had never worked on the live site.** Brian typed N575LD into
the box again and sent the screenshot: four addresses, no aircraft. The
browser check above had run the demo render. The production map boots
"shell first" (`app/(dashboard)/map/page.tsx`), and that branch handed the
flight-log flag to the map as a hard `false` — so on hammertrack.ai the box
never asked the flight log, and the aircraft popup never showed its
"flight log & charts" link either. Reproduced first on the live site at
phone size (one geocoder call, zero `/api/aircraft/search` calls), then
fixed by passing the real permission, the same one that puts the Flight log
tile in More. Two lessons kept: verify on the LIVE site with a signed-in
account, and a flag that is hard-coded in one render branch and computed in
the other is a bug waiting for the branch nobody tests.

And when the log IS asked but does not answer (rate limit, registry outage,
unreachable), the box no longer goes quiet: a row reads "Flight log didn't
answer — open it for N575LD" and takes you to the log, which reports the
outage in its own words. A real "nothing found" stays silent, so typing an
address like "123 Main" never grows a flight-log row.

The reviewer pass on that commit caught that the field half of the row had
never worked either: `/aircraft?tail=KGMU` (what the map's airfield row and
the new fallback row open) only knew aircraft, so a field code landed on
"No aircraft found with that tail number" while pressing Search on the same
box opened the board. The page now reads every search answer through ONE
function for its three doors (Search, a board's tail tap, the deep link), so
they cannot disagree again. Same pass: Enter takes the fallback row when it
is the only row (Android's Go key), and tapping the backdrop closes like the
X does — clearing the text aborts the lookups in flight, so a late outage
answer cannot park itself on the next open.

## Airport boards

`/aircraft` → **By airfield**. Migration 110.

FR24 locks a field's departures past 12 hours behind a paid tier, and no free
endpoint answers "what used KGMU today" at any price. So this is assembled
from what the flight log already does, plus one genuinely new step:

1. **Discovery** — `/api/cron/airport-board`, every 20 minutes, makes ONE
   call per watched field to see which aircraft are near it.
2. **Reading** — for each airframe found (skipping any already banked today),
   the same trace → flights pipeline runs.
3. **Filing** — flights whose *confirmed* origin or destination is that field
   are banked with `from_ident` / `to_ident`.

The board itself is then a plain query on those two columns: no upstream
calls, instant, and a local circuit correctly appears as both a departure and
an arrival. An ident is only ever written for a **confirmed** end — "near
Hickory" must not put a flight on Hickory's board.

**The honesty problem is bigger here than anywhere else in the log.** An empty
board means one of two completely different things, so the page always says
which: it shows when the field was first watched and when it was last checked,
and the empty state distinguishes "nothing flew" from "nobody was looking yet".
Watching a field is the same bargain as saving a plane — it starts recording
from that moment, and there is no history before it.

Capped at 10 fields per company, 60 upstream reads per sweep.

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

## Naming the ends

`lib/airports.ts` + `lib/data/airports.json` — OurAirports, which is **public
domain**, so unlike adsbdb's route database we can bundle it outright.
Trimmed to real airfields (no heliports, closed fields, seaplane bases) and
to eight fields: 48,009 rows, ~3.3 MB, loaded once per lambda into a 1°
lat/lon grid. 2,000 lookups take ~22 ms.

Rows read the way anyone expects — `Greenville Downtown (GMU) → Knoxville
Downtown Island (KDKX)` — resolved once at bank time, since the field a
flight left from does not change.

**Field elevation is also how we tell a real departure from a coverage gap.**
The feed's ground flag is authoritative when present, but on light aircraft
at small fields it usually is not: N575LD, a Cirrus working out of Greenville
Downtown, has ZERO ground rows in a whole day's trace — its lowest fix is
925 ft against a field elevation of 1,048 ft. Judging it by the ground flag
labelled an ordinary training flight "part of a flight". So `atField()` adds
the geographic test: an endpoint over a known field, within ~1,500 ft of that
field's own elevation, is a takeoff or a landing. Anything still unconfirmed
is written "near X", never stated.

## Saved planes on the map (Sep 21)

Brian: "save planes as a user then those planes be red or blinking or
something when active."

* **Save from the map.** The aircraft card (tap a plane) carries the same Save
  button as this page — `saveAircraftAction` — and says what it does: red and
  blinking on the map whenever it is in the air, flights kept from tonight.
  Once saved the card's title wears a ★ and the plane's label, if it has one.
* **Red, breathing, with a halo.** `lib/sat-3d.ts` draws saved aircraft in
  their own batch, last, in the app's alert red pulsing on the asset-pulse
  tempo (~1.4 s), with a soft red disc behind the body so it is findable from
  state zoom. On the ground it is dark red and still — "active" means in the
  air. `prefers-reduced-motion` gets a steady red.
* **Wherever it is.** The map's own feed only covers 250 nm around the view.
  `/api/aircraft/saved?live=1` asks adsb.lol for the whole watchlist by hex
  in ONE call (`lib/aircraft-live.ts`: `/v2/hex/<a>,<b>,…`, verified with two
  live airframes; cached per company, stale-served for 90 s, the same 429
  cooldown as `/api/planes`). MapView polls it every 15 s while an aircraft
  layer is on and the range is live, marks the saved ones in the local
  snapshot, and ADDS any saved plane flying beyond the feed's reach
  (`Plane3D.injected`) so it dead-reckons and draws like the rest. A red
  chip per airborne saved plane sits in the top-left legend stack; tapping
  it flies there.
* **This page says it too.** Watchlist rows read "in the air now · 35,000 ft
  · 460 mph" (or "on the ground, transmitting") with a Map link that opens
  the map on the aircraft with the layer on. A plane whose avionics are off
  sends nothing, so nothing is said — never "on the ground".
* **Privacy shape.** `/api/planes` is public (the /live page renders it
  signed out) and knows nothing about who saved what; the watchlist join
  happens in `/api/aircraft/saved` under RLS and on the signed-in client.

## One row per airframe (Sep 21)

Brian, of his own watchlist: "should not have duplicate saved planes."

Two bugs with one symptom, and they were on opposite sides of the wire.

* **The screen.** Save ran inside a `useTransition` whose pending flag was
  discarded, so the button never disabled — two taps on a phone fired two
  `saveAircraftAction` calls, and each success PREPENDED an optimistic row.
  The server deduped to one row; the list showed two until the next reload,
  which is the worst kind of wrong (it corrects itself, so nobody believes
  the bug report). The optimistic row now replaces any row for the same hex,
  and the button is disabled while the save is in flight.
* **The table.** 108's unique index is `(company_id, hex) WHERE active` —
  partial, because a removed plane keeps its row so re-saving picks the log
  back up. But the save path looked for an existing row with `active = true`,
  found nothing, and INSERTED a second row beside the dead one. Save → remove
  → save left two rows for one airframe (seen in production: two N99ZZ rows
  two seconds apart). It now reads every row for that hex, active first and
  newest first, revives that one, and deletes the strays. Nothing is lost
  with them: banked flights live in `aircraft_flights`, keyed by hex.
* **Belt.** `getSavedAircraft` collapses by hex on the way out, so a second
  row for one airframe can never reach the watchlist even if it exists.

## A plane from the search bar stays on the map (Sep 21)

Brian: "when I click a plane from search bar it should match trails with
timeline slider selection or show last known location with a popup."

Picking an aircraft row in the map's search box used to leave the map for
this page. Now the map answers in place, and the answer depends on where the
timeline sits (`MapSearch` → `onPickAircraft` → `loadSearchedPlane` in
`MapView`):

* **Live.** If the aircraft is in the feed (or on the watchlist beyond the
  feed's reach) the map flies to it and opens its card, trail and all. If it
  is not transmitting, `/api/plane-track` now serves the epoch second of
  every trace point and the trace's LAST fix (`lastSeen`, with the feed's
  own on-ground flag — never an altitude threshold): the map flies there,
  draws today's track, and puts a grey **ghost** at the last fix with a card
  that says *last seen 3 h ago (2:14 PM) · on the ground · not transmitting
  now — this is its last known position*. If it has not flown today, the
  newest logged flight (last ~30 days) is drawn and the ghost sits where it
  landed, the card saying so. Nothing at all in 30 days = a toast that says
  exactly that. The ghost is a placeholder, not a claim: the moment the
  re-centred feed carries the real aircraft, the ghost stands down and the
  live plane takes the card.
* **Any replay range** (Today · Yesterday · 7d · 30d · YTD · All · Custom).
  `/api/plane-track?hex&from&to` (signed in + the aircraft view level — the
  archive reads are spent on our behalf) returns every flight the log has
  inside the window, with times. `lib/plane-replay.ts` joins them into ONE
  timed trail, the map frames it, and the aircraft becomes a **replay head
  on the slider**: the trail is cut at the playhead exactly as the trucks'
  trails are, the head is interpolated between the two fixes around that
  moment (position, altitude, speed, vertical speed, heading), and the card
  reads the moment in plain words — *2:14 PM · altitude 3,500 ft · speed
  128 mph · ↑ 700 ft/min · flight 2 of 3 in this range · Greenville Downtown
  (GMU) → Charlotte (CLT) · 1:52–2:40 PM*. Between two flights the head is
  a grey ghost parked where the earlier one landed ("landed at Anderson
  (AND) 2:40 PM · next flight 4:10 PM"); before the first fix it waits where
  the first flight begins; after the last it stays where it landed. A colour
  ramp (speed / climb / altitude) is fixed over the WHOLE window's trail, so
  scrubbing never re-normalises the colours under the person's eyes.
* **It rides the timeline.** Changing the range re-asks the question for
  the new window (Live included); the head follows every drag and every
  playback tick; a tap on empty sky lets the plane go; turning the aircraft
  layer off clears it. The searched aircraft wears a steady teal halo and is
  never zoom-culled or decluttered away (`Plane3D.searched`); a remembered
  position is always drawn in the inert grey (`Plane3D.ghost`) — never in a
  class colour, so it cannot pass for traffic in the air.
* **Harness.** `node scripts/plane-replay-test.mjs` (31 assertions) — run
  it after ANY change to `lib/plane-replay.ts`. The awkward moments are the
  ones asserted: before the first fix, in the gap between flights, past the
  last, a value only one end of a leg sent, a fix running backwards in time.
* **Reviewer pass (same night).** The window branch of `/api/plane-track`
  had reopened the watchlist oracle the flights route closed on Sep 12 —
  banked flights older than the public month exist only because SOME
  company saved that airframe, so answering them to anyone says who watches
  what; only the company that saved a plane now reads past `ARCHIVE_DAYS`,
  and `beyondArchive` is masked for everyone else. `getFlights` takes the
  asked window and spends its archive reads on the days that window touches
  (it used to fetch the newest eight days whatever was asked). On the map:
  the saved-plane chip flies to where the plane is NOW, not where it was
  when the chip appeared; a saved plane outranks strangers in the declutter
  cell so its halo never vanishes under an airliner at state zoom; the
  ghost's borrowed (weeks-old) trail is dropped when the live plane takes
  over; the searched card patches its state block in place instead of
  re-setting the whole popup on every playhead commit (buttons stayed under
  the finger; the colour ramp is computed once per window and sliced at the
  cut); switching both aircraft layers off clears the searched plane; and an
  upstream outage says "could not reach the feed" instead of "not heard from
  in 30 days".

## Known gaps
* **Banked flights are keyed by airframe, not company.** Two companies
  watching the same jet share one copy — it is public ADS-B, and fetching it
  twice would be rude to the upstream. Who watches what stays private:
  `aircraft_saved` is company-scoped under RLS.
* **The cron does 40 airframes a run.** Fine for now; past that it needs the
  longest-unsynced-first queue it already has plus more runs per day.
* **Nothing links a flight to a job.** The obvious next step if Brian ever
  wants this to be more than an extras layer: match a landing against a site
  zone and put the trip on the day's timeline.
