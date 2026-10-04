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

## Next (the "ideal world" half)

1. **Plans place themselves.** Read the sheet's scale text and north arrow,
   grid-tick or survey-control coordinates and the site address (pdf.js text
   layer; GeoPDF when present) → the sheet lands in place, the estimator only
   nudges.
2. **Contours pick themselves.** Civil PDFs are vector: group polylines by
   stroke style (existing dashed vs proposed solid), read the elevation labels
   along them, step the unlabelled ones by the interval.
3. **Plan vs. actual.** Drone flights (HammerTrack Aerial, #169) as a third
   surface → yards moved so far; machine hours on the site → cost per yard.
4. Cross-sections, phases, LandXML/DXF import, a flat-triangle fix at contour
   bends (spot grades at peaks and low points cover it for now).
5. Validate against one of DCG's real Kubla takeoffs (board #184); phase 2 is board #186.
