# High-Accuracy Positioning — RTK, State Plane, and the "Stand on the Plan" Feature

*Research memo, Jul 15 2026. Verify current pricing/policies before buying —
figures are ballpark from vendor norms.*

## The accuracy ladder (horizontal; vertical is ~1.5–2× worse except RTK)

| Tier | Accuracy | Hardware | What it costs |
|---|---|---|---|
| Phone, single-band GNSS | 3–5 m | any phone | $0 |
| Phone, dual-band (L1+L5) | 1–3 m | most flagships since ~2021 (incl. recent Galaxy/iPhone) | $0 |
| Our trackers (T1/T2 class) | ~2.5 m CEP | consumer GNSS chip (u-blox M8/M10-class, MediaTek/Airoha in that tier) | in the unit |
| SBAS/WAAS corrections | ~1–2 m | built into most receivers | $0 |
| Sub-meter DGNSS | 0.3–0.6 m | Bad Elf Flex, survey-lite Bluetooth pucks | $600–1,500 |
| **RTK** | **1–2 cm horiz / 2–4 cm vert** | multi-band receiver + correction stream | $400–2,700 + corrections |
| PPP (e.g. Galileo HAS, PointPerfect) | 10–30 cm after convergence | multi-band receiver | $0–$50/mo |

## RTK — the tier that changes the game

Real-Time Kinematic works by comparing carrier-phase measurements against a
base station with a known position; the rover resolves centimeters in real
time. Three pieces:

1. **Receiver (rover)** — the chips that matter:
   - **u-blox ZED-F9P** — the workhorse dual-band RTK module (~$200 as a
     module); inside most prosumer RTK gear.
   - **Unicore UM980/UM982** — newer triple-band Chinese chips (~$100–200)
     driving the current wave of cheap RTK hardware.
   - **Septentrio Mosaic-X5** — the premium option (better multipath/interference
     rejection, ~$500+ module).
   - Products built on them: **SparkFun RTK Torch (~$400, UM980)** — best
     value entry; **Emlid Reach RX (~$1,600)** / **RS3 (~$2,700)** — polished
     survey rovers; Bad Elf Flex Extreme; DIY F9P builds ~$300.
2. **Corrections** — the rover needs a data stream (NTRIP over the phone's
   internet):
   - **South Carolina Real-Time Network (SCRTN)** — the state runs CORS
     reference stations with free registration (SC Geodetic Survey). This is
     the first thing to check — free corrections statewide is the whole
     ballgame. (Confirm current signup policy.)
   - Paid networks if ever needed outside coverage: Point One Polaris
     (~$125/mo), Trimble VRS, Onocoy (crypto-weird but cheap).
   - Or your own base: a second F9P on a known point at the shop broadcasts
     corrections ~10–20 km around — one-time ~$400.
3. **Getting RTK into HammerTrack — the native app makes this free to build:**
   - **Android:** RTK rovers pair over Bluetooth and act as a **mock location
     provider** — the OS-level position IS the RTK position, so our existing
     /track "Go Live" and the wrapped app inherit 2 cm accuracy with **zero
     code changes**.
   - **iOS:** MFi receivers (Bad Elf, Emlid via their app) replace Core
     Location globally — same effect.
   - Later, a direct NTRIP/NMEA integration in the app can read the receiver
     natively and record fix quality (RTK-fixed vs float) per point.

## Vertical / altitude — the part everyone gets wrong

- GPS altitude is **ellipsoid height**; plans and surveys use **orthometric
  height** (NAVD 88). The difference in Greenville is roughly −30 m and
  varies by location — apply the **GEOID18** model to convert. RTK gets you
  2–4 cm vertical, but only after geoid correction is it a real elevation.
- This matters the moment we do grade checks, pad elevations, or pipe invert
  depths against plan.

## State Plane Coordinate System (SPCS) — the language plans speak

- Civil drawings, plats, and county GIS in our market are in **South Carolina
  State Plane (NAD83, single zone)** — **EPSG:2273** (US survey feet) or
  EPSG:32133 (meters). Charleston (Holy City) is the same single SC zone.
- Web maps are WGS84/Web Mercator. Converting SPCS→map is a proj4js one-liner
  client-side, **but** at RTK accuracy the NAD83-vs-WGS84 datum difference
  (~1–2 m) is no longer noise — use the proper NAD83(2011) transform, not the
  lazy "treat them as equal" shortcut.
- Rule of thumb: **meter-accurate work can ignore datums; centimeter work
  cannot.**

## The killer feature — "stand where the plan says"

Vision: foreman uploads the site plan (PDF/DXF), georeferences it once, and
then anyone on site sees **themselves as a dot standing on the actual
drawing** — waterlines, building corners, silt fence — at RTK accuracy.

Build order:
1. **Parcel lines layer (near-free)** — we already render county parcels
   (lib/parcels.ts). Reframe it: parcel boundaries + a disclaimer. County GIS
   parcel lines are digitized approximations (often feet to tens of feet off)
   — good for "whose land is this," **never** for staking. Legal line: only a
   licensed surveyor's marks establish boundaries.
2. **Plan overlay** — upload plan image/PDF page → georeference by typing the
   two SPCS coordinates printed on most civil sheets (or two-point pin on the
   map) → render as a raster overlay with opacity slider. proj4js + an affine
   fit; a weekend of work, huge demo value.
3. **RTK "you are here"** — phone paired to a ~$400 rover + free SCRTN
   corrections; the app shows your position on the plan at 2 cm. Show fix
   quality prominently (RTK-fixed green / float yellow / GPS red).
4. **Stakeout mode** — pick a point on the plan, get arrow + live distance
   ("3.2 ft NE"). This is a $5–15k Trimble SiteVision/receiver workflow for
   ~$400 in hardware — the Tenna-killer demo.

## Recommendation

- **Now:** ship the plan-overlay (phase 2) — valuable even at phone accuracy.
- **Pilot RTK:** one SparkFun RTK Torch (~$400) + SCRTN registration; pair to
  Brian's phone; validate /track accuracy on a known survey mark.
- **Package later:** "Precision kit" add-on — rover + app mode, ~$500 hardware
  + $10–20/mo margin line. No competitor in our price class has it.
