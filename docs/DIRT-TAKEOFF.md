# Dirt takeoff — the earthwork add-on

*Oct 4 2026. Brian, after an InSite Elevation Pro ad: "Can we do the dirt
takeoff similar to kubla as a separate dirtwork plugin with additional cost in
hammertrack" … "I know it is a triangulation method and some of the issues with
kubla are vertical deduct surfaces like topsoil cut, construction thickness of
asphalt or concrete etc. We should just handle these as steep walls not quite
vertical. Ideal world a project comes in, pdf plans show up on the map in
actual location, dirt takeoff gets run, cut fill visible on map."*

Phase 1 shipped the same day: migration 127, `lib/dirt/*`, `/dirt/<id>`, the
site page's **Dirt takeoff** card and the map's **Cut / fill** layer.

## What it replaces: DCG's Kubla steps (takeoff process, Apr 2025)

| Kubla tab (DCG process doc) | HammerTrack |
|---|---|
| Scale each sheet (existing topo, demo, grading, site) and stack them by hand | Sheets placed once on the site page (Scaled Plans, 055) already sit in their real location — on each other AND on the satellite and lidar |
| Existing contours, traced or picked from lines | **USGS 1 m lidar fills it in by itself** (bare earth, NAVD88); tracing the plan's existing contours is still there for plans on an assumed datum or sites changed since the flight |
| Demo tab — reduce each demo type by its thickness | **Demo** step: presets (asphalt 4", concrete 6", slab 8", gravel 6") or your own |
| Topsoil tab — area + depth from the geotech borings (1–3" fields, 5" woods) | **Topsoil** step, same rule in the hint |
| Proposed tab — contours, spot elevations | **Proposed** step: grading limits, contours (elevation steps by the interval after each one), spot grades |
| Reduce areas with an external batter of 0:0.01 | **Thickness** step: light duty 8" (6"+2"), heavy duty 11" (8"+1.5"+1.5"), sidewalk, pad, custom — **exact vertical edges, no batter needed** |
| Platform at FFE with a Z offset of −8" | **Building pad**: finished floor + subgrade offset (−8" default) |
| Screenshot, then copy topsoil / onsite / import-export CY into the estimate | Cut/fill drawn on the map (and on the main map's Cut / fill layer); **Copy for estimate** puts the lines on the clipboard |

## The method (why the numbers can be defended)

- **Surfaces are TINs.** Lidar: the DEM's pixel centres, each cell split on its
  SW→NE diagonal (the integrator walks exactly the triangles `zAt` reads — no
  bilinear patch beside a triangulated one). Traced: constrained Delaunay
  (Delaunator + Constrainautor) with every contour segment forced in as an
  edge, so no triangle bridges two contours.
- **Proposed ties into existing at the grading limits** (sampled every 2 m off
  the ORIGINAL existing ground). No proposed contours at all = finished grade
  is existing (a pave-over job: the cut is just the section).
- **Volumes are exact over the overlay.** Each existing triangle is clipped by
  each proposed triangle (both convex), then cut along every area edge that
  crosses it — demo, topsoil, thickness, pads, grading limits. On every piece
  both surfaces are linear and every area is fully in or out, so ∫max(d,0) and
  ∫max(−d,0) are closed-form (the zero line cuts off a corner triangle:
  A·p³ / 3(p−q)(p−r)).
- **Vertical deducts are exact.** Brian's "steep walls not quite vertical" is
  Kubla's 0:0.01 batter — a workaround for a TIN that can't hold a vertical
  face. Here the step is applied per piece on each side of the edge, so the
  wall is truly vertical and costs no sliver of volume.
- **Stacking order (Kubla's):** existing → minus demo → minus topsoil;
  subgrade = proposed − thickness, or the pad's FFE + offset (pads win over
  paving). Overlaps within one kind: the area drawn LAST wins (a concrete pad
  drawn on an asphalt lot).
- **Units.** UTM metres (NAD83, the lidar tiles' own grid — never resampled);
  every area and volume ÷ k² (UTM scale at the site, ~0.9998 at Greenville);
  feet / inches in and out; 1 CY = 0.764554857984 m³.
- **Shrink:** fill × (1 + shrink %) = bank yards it takes. Onsite = cut placed
  back as fill; export / import = cut − adjusted fill; loads at the truck size.

`node scripts/dirt-test.mjs` — 99 assertions: a flat pad (370.37 CY), a sloped
plane split at its zero line (2,500 ft³ each side), vertical asphalt deducts,
topsoil stacking, overlapping areas both ways, a pad beating paving, demo, a
planar TIN from traced contours, tie-in mounds, the datum check, lidar gaps,
the UTM projection against the published 4,427,757.22 m, and a fuzz of random
sites integrated exactly vs. a fine brute-force grid (worst 0.43% at 5 cm,
converging onto the exact number as the grid halves), plus the review pass:
paving under a pad, self-crossing areas, overlapping pads, the grid's last
node, the work budget and deadline, and the 5 km site span. **Run it after ANY
change to lib/dirt/*.**

## Lidar (lib/dirt/ground.ts)

The National Map products API lists the 1 m DEM tiles under the site; each is
a cloud-optimised GeoTIFF on S3, read over HTTP range requests (geotiff.js) —
~2.5 s for a 300 m site. Checked Oct 4: downtown Greenville and Clemson
(SC Savannah–Pee Dee 2019) and Charleston (SC Charleston 2016) all at 100%
coverage. Nodes no 1 m tile covers fill from the 3DEP ImageServer's best
available (often 10 m — the source line says so). The grid is cached in the
private `dirt` bucket keyed by a snapped UTM box (`lib/dirt/ground-box.ts`),
so the editor's preview and the server's run read the same numbers.
**Datum:** lidar is NAVD88; a plan on an assumed datum shows up as proposed
grades far from existing (warned past 15 ft), and two or three traced existing
spot grades measure the offset.

## Limits and safety (review pass, Oct 4 — ship-check + sec-check on #180)

- **Save runs first, then writes.** The server validates the design, reads
  lidar, runs it, uploads the picture, and only then stores design + numbers
  + picture in one compare-and-set on the row's `updated_at`. A design too
  big to run (`TakeoffTooBig`: 15M units of work or 40 s — a real 1.2 km site
  with 40 contours and 20 paving areas is ~3M / ~10 s) is never stored, so it
  can't hang a colleague's editor. Two saves racing: the second is told to
  save again. Lidar down at Save: the traces are stored with no numbers yet
  (honest), never zeros. 6 saves a minute per person.
- **One site, not a county.** Every trace must fit ~5 km (`schema.ts`);
  grading-limit tie-in samples stop at 20k; a self-crossing area (bowtie) is
  refused in the editor and skipped by the run with a warning.
- **Lidar route** (`/api/dirt/ground?takeoff=&bbox=`): signed in, `zones`
  view level, add-on, never a prospect, and only within 1.5 km of that
  takeoff's zone or saved traces. New USGS reads: 10 per person per 10 min
  (shared with Save). Tiles only from `prd-tnm.s3.amazonaws.com`.
- **Cache.** Per company (a shared one let a customer tell, by speed, that
  another had pulled a site), flat `ground/<company>_<grid>.bin` in the
  private bucket. A read that partly failed is never stored (memory only,
  5 min). A stored grid is handed to the browser as a 2-minute signed link —
  a big site's grid is 6–8 MB, past what a function response should carry.
  The health cron (step 8) drops grids after 60 days, deleted takeoffs after
  30, and stray pictures after a day.
- **Big sites** step to a 2/4/8 m grid and read the COG's overview level;
  overviews carry no georeferencing, so origin and EPSG come from image 0.
- **Rows (128).** A deleted takeoff is invisible to the API too;
  `company_addons` has no member read policy (only the service role reads it).
- **Caps.** 25 live takeoffs per site, 300 per company; no takeoff on a
  personal zone (its name and outline would reach the whole company).

## Where it lives

- `/dirt/<id>` — the editor (live preview in a web worker, `lib/dirt/worker.ts`,
  one run in flight). **Save** validates the design (`lib/dirt/schema.ts`),
  runs it on the SERVER and stores it (`saveTakeoffAction`): the stored numbers
  and the cut/fill PNG (`lib/dirt/png.ts`) are the server's, never a figure a
  browser posted, and they stand on screen until you change something. Unsaved
  work is kept on the device (offered back on open) and in-app links ask
  before leaving it. Number boxes keep what's typed — a type=number box reads
  '' for a lone minus sign, so the first cut turned "-10" into +10.
- Site page → **Dirt takeoff** card (list + New takeoff; locked for companies
  without the add-on).
- Main map → layers → My sites → **Cut / fill** (`/api/dirt-map`).

## The add-on

`company_addons` (127) — rows written by the service role only; the founder's
own company always has it. No price is published yet ("ask us to turn it on");
when Brian sets one it becomes a Stripe line (`STRIPE_PRICE_DIRT`) and goes
through the pricing sync rule (/pricing, splash, /demo, /help/billing,
docs/PRICING-TIERS.md in one commit). Market: Kubla Cubed $295/yr per user
(free Lite), InSite Elevation Pro from $3,900/yr.

## Reading plans — contours pick themselves (Oct 4, phase 2)

Plans step → a placed sheet → **Read contours, spot grades and pads off this
sheet** → pick the PDF it came from (its name is in the sheet's caption). The
PDF is read **on the device** and never uploaded; only what's imported goes
into the takeoff. Civil sets are vector drawings, so nothing is traced from a
picture — every contour, label and spot comes out as geometry:

- **Which page** (`components/dirt/PlanReader.tsx`): the caption says
  ("… — p7"); the placed raster confirms by a picture match (middle of the
  sheet — title blocks repeat on every page). No match → it searches the PDF,
  and a sheet it can't find is refused unless the estimator overrides.
- **Pulling the linework** (`lib/dirt/pdf-vectors.ts`, pure): pdf.js operator
  list → every stroked path with its pen (CAD layer from the PDF's optional
  content, colour, width, dash), curves flattened; words from the text layer
  and from AutoCAD's "SHX Text" comments (the words of SHX fonts ride as
  Square annotations).
- **Reading it** (`lib/dirt/plan-read.ts`, pure, in `lib/dirt/plan-worker.ts`):
  1. *Pens.* Each pen gets a suggested role — existing, proposed, not
     contours — from its layer name (TOPO/MAJR/MINR…, V- survey vs C- civil,
     NCS status -E/-N), the elevation labels on it, dashes and grey screening,
     smooth vs straight/zig-zag lines; white pens (masks) and short marks
     (text drawn as strokes, hatching, a seal) never are. The estimator flips
     any pen with one tap; a pen row lights its lines on the map.
  2. *Lines.* Pieces of a pen join end to end — dashes drawn one by one, a
     contour broken by the drafter — and labels stitch the two sides of their
     gap back into one line.
  3. *Labels.* Whole numbers sitting on a line (parallel) or in a gap cut for
     them; "(271)" counts. Never a label: survey point numbers touching their
     shot's elevation, numbers nowhere near the plan's spot elevations, a
     stray outlier ("100" from a station — judged against every elevation on
     the plan when a kind has under 3 labels of its own). Words that sit in
     HALF a gap (one line end faces them, its partner is clipped by the read
     area, cut at a match line, set aside, on another pen) or near the read
     area's edge never go to a line that merely passes by — the editor reads
     the site + 60 ft, so crop edges are the normal case (60 random site
     crops of the test sheet: 0 labels on the wrong line, 0 wrong values
     unflagged; it was 5 of 60). A line crossing a labelled contour of its
     own kind is not a contour (a wall drawn on the topo layer). A decimal
     far from the plan's elevations ("24.00", a drive width) is no spot grade.
  4. *Elevations* (`resolveElevations`): rays across the contours give
     ladders (every crossing, so a hilltop reads 809·810·809; a ray breaks at
     a label gap, a contour ending beside it, a building wall). Between two
     known contours the others step evenly — the interval is measured, never
     assumed. Then the USGS lidar where it is sure (datum = what most
     label − lidar values agree on within ~⅓ interval — two labels a contour
     apart agree on nothing — else the GS spot shots the same way, else no
     datum; a label the datum doesn't fit is flagged), proposed contours that
     END on an existing one tie in at its level (the grading limits — not
     where both stop at the read area, a match line or the sheet's edge), and
     last a trend guess two contours past the last label at most, never past
     a hilltop, flagged "check it". Guesses import by default with their
     count shown and a box to leave them out (41 test reads: 272 right, 3
     wrong — leaving them out cost 12% of the fill on the test sheet).
     A neighbour more than one interval off takes back a guess; two labels
     that disagree are both flagged. **Nothing is named wrong silently: a
     contour the read can't name stays unnamed.**
  5. *Spots, pads, limits.* Spot grades with their tags (GS/EG existing; FG,
     FS, BC, FL, EP, HP… proposed; TC, TW, INV, RIM… skipped as not ground),
     paired across separate SHX words; the x or + marker is the point. The
     finished floor ("FFE = 811.50", "GFF= 89.90") with the building around
     it — a closed ring, or the wall band flooded from the label when the
     outline is filled slivers. The limit of grading from its layer or its
     words.
- **Fixing what it couldn't** (the estimator): tap a contour → its number
  (a typed one wins, and survives a re-read), or *Not a contour* — the sheet
  is read again WITHOUT that line, so it takes no label, sets aside no
  neighbour and feeds no ladder, datum or tie-in (grey on the map; tap it →
  *It is a contour*). **Number contours along a line**: type the first one's
  elevation, draw across the run — they step by the interval (the kind's
  own interval). The first tap may land a hair past the contour it means:
  the one within ~10 px counts as the start. If any contour on the line
  already has a different number on the plan, nothing is written and the
  number the labels imply is offered ("the plan's labels make the first one
  803, not 801"); numbers counted between labels are checks too (*number
  from …* or *Use my numbers anyway*).
- **Import** (`lib/dirt/plan-import.ts`): contours, spot grades, the pad (FF
  −8") and the limit become takeoff features through the sheet's placement
  (`lib/dirt/plan-geo.ts` — the same triangles MapLibre draws the raster
  with, so they land exactly on the picture), thinned to 0.15 ft, each
  marked with its sheet (`src`) so reading the sheet again replaces them.
  It fits the design's caps (`lib/dirt/limits.ts`) whatever the sheet holds:
  pads and the limit first; spot grades promised half of what's left (a
  dense survey can't crowd the contours out, nor fragments the spots); too
  many contours → the shortest go, too many points → contours thin first; a
  contour past 6,000 points is split where it would overflow (lossless);
  spots past the room left are kept evenly over the sheet; an elevation
  outside −1,500…30,000 ft is left out and said.
  Existing contours can become the existing ground ("traced") or just set
  the lidar's datum offset.
- **Proof** — `node scripts/plan-read-test.mjs` (184 assertions; run it after
  ANY change to pdf-vectors / plan-read / plan-geo / plan-lidar /
  plan-import): `scripts/plan-pdf-fixture.mjs` writes a REAL PDF drawn the
  way Civil 3D exports look (layers, dashed grey existing with exploded-dash
  minors and SHX labels, solid proposed with labels in gaps and white masks,
  survey shots with point numbers, a building, a legend and a seal outside
  the site, a pipe size and a station number on lines), reads it through
  pdf.js and checks every number — and the whole chain PDF → read → import →
  takeoff lands within 2% of the exact volumes (fill 3,118 vs 3,107 CY).
  Real county grading sets were used to harden it (scratch only, never in
  the repo): residential and small-site sheets read partly — the tools
  above finish them.

## Next (the "ideal world" half)

1. **Plans place themselves.** Read the sheet's scale text and north arrow,
   grid-tick or survey-control coordinates and the site address (pdf.js text
   layer; GeoPDF when present) → the sheet lands in place, the estimator only
   nudges.
2. **Remember the reading.** Pen roles and typed numbers per sheet, so a
   revised set reads itself the same way.
3. **Plan vs. actual.** Drone flights (HammerTrack Aerial, #169) as a third
   surface → yards moved so far; machine hours on the site → cost per yard.
4. Cross-sections, phases, LandXML/DXF import, a flat-triangle fix at contour
   bends (spot grades at peaks and low points cover it for now).
5. Validate against one of DCG's real Kubla takeoffs (board #184); the rest of
   phase 2 is board #186.

## Stockpiles (migration 136, Oct 2026)

Brian: a stockpile option like Propeller's — "point, click and calculate from current drone survey data". Same add-on gate (`dirtAddonActive`).

- **Where:** site page → Dirt takeoff card → *Measure a stockpile* → `/dirt/stockpiles/<zoneId>`.
- **Surface:** a drone survey's elevation export (DSM GeoTIFF, one band, ≤ 50 MB) uploaded straight to the private `dirt` bucket on a signed URL; `finalizeSurfaceAction` opens it by range requests and reads its GeoKeys (`dsmCrs`: WGS84 / NAD83 / NAD83(2011) UTM, or lng/lat; metres, feet or US survey feet; heights by `VerticalUnitsGeoKey`, else the ground unit, else metres — the uploader can override). State plane is refused with the export to ask for. Fallback: USGS lidar (`groundCached`) with a warning on every result that lidar is years old and not today's pile.
- **Math** (`lib/dirt/stockpile.ts`, pure): the survey under the toe is resampled onto a frame grid (`planPileGrid` / `sourceWindow` / `sampleToFrame`, ≤ 600k nodes); base = constrained TIN through toe heights (`buildTin`) or a flat floor at the lowest toe height; integrated exactly like the takeoff (top triangle ∩ base triangle, cut along toe edges, `polyPosNeg`), ÷ k². Below-base volume is reported apart. CY, m³, tons (editable density per material), area, max height.
- **Over time:** each measurement is a row dated by the survey's flight; the same pile name groups them (`lib/dirt/pile-history.ts`) and shows the change.
- **Tables:** `dirt_surfaces`, `dirt_stockpiles` — company read (live rows only), service-role writes, `ht_prospect_lockdown(…, false)`. Not yet: purging soft-deleted rows/files in the health cron, deleting a survey from the UI.
- Harness: `node scripts/dirt-test.mjs` (cone / pyramid / sloped base / pit / k² / UTM-feet resample / GeoKeys).
