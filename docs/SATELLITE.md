# Satellite pictures of a site

Brian, Oct 6 2026: *"Need to check on the cost of daily aerials from Planet Labs and
implement with per zone cost or whatever makes the most sense there."*

**Short answer.**
- **Planet costs.** Daily Planet pictures cost us about **$18–$27 per site per month** at
  10–50 sites, if Planet sells us next-day area at its published ~$190/km²/yr. If Planet
  insists on its 50 km² block, 10 sites cost about **$91 each**. One site alone is about
  **$190 a month** either way. The reason: Planet bills **at least 1 km² per site**, and our
  median site is 19 acres (0.08 km²), so every small site costs the same.
- **Planet licence.** Planet's **standard licence does not let us show its pictures to our
  customers**. Reselling per site needs a partner agreement with Planet first.
- **Sentinel-2.** Free and open, and its licence allows showing it to customers. At 10 m it
  gives a clear picture of a site every few days. That part is built and works today.

Price options for a Planet tier went to Brian with this work. No customer price for
satellite pictures exists anywhere yet. Once Brian picks one, it goes through the pricing
sync rule in CLAUDE.md.

## What shipped (migration 131)

- **Turning it on.** A site's page has a **Satellite** card. Anyone who can edit turns on
  *Every few days · 10 m · Sentinel-2* for that site. The option shows only when the company
  has the `satellite` add-on (`company_addons`, the dirt-takeoff pattern; the platform
  owner's company is always on).
- *Daily · 3 m · Planet* can be picked only when `PL_API_KEY` is set. Until then the card
  says "ask us to turn it on".
- **The nightly cron.** `/api/cron/satellite` runs at 22:35 UTC. Sentinel-2 crosses the
  eastern US around 16:20 UTC, and Earth Search lists the pass a few hours later. The cron
  claims each watched site with a compare-and-set, then looks at the newest unchecked passes
  first.
  - It reads each pass's **scene classification over the site's own outline**. A tile that
    is 28 % cloud was 100 % cloud over our test site, and a tile that is 40 % cloud can be
    clear over it.
  - If the site is clear (≤ 5 % cloud or shadow, ≤ 5 % outside the picture), it cuts the
    true-colour window: the site plus a margin of context.
  - The window comes from a cloud-optimised GeoTIFF over HTTP range requests, the same
    approach as `lib/dirt/ground.ts`. A 19-acre site is a 43 × 43 px PNG of about 6 KB.
- **Where a picture lands.** Each picture becomes an ordinary dated, **placed**
  `zone_imagery` photo (`source = 'satellite'`, caption *"Sentinel-2 · Sep 27, 2026 · 10 m ·
  Contains modified Copernicus Sentinel data 2026"*). The zone page's photo timeline and the
  map's timeline-aware **Site imagery** layer show it with **no change to the map**: the
  scrubber picks each zone's newest shot on or before the scrubbed day.
- **Map loader fixes.** `lib/db/imagery.ts` now loads the **newest** 500 placed photos
  (oldest-first used to freeze the live map once a company passed 500) and loads plan sheets
  separately. On a day with both a drone shot and a satellite picture, the sharper drone shot
  wins.
- **The record.** `satellite_scenes` records every pass looked at: picture taken, cloudy, no
  data, failed (retried up to 3 times), or a Planet order still in flight. It is the dedupe
  (one picture per site per day) and the cost record. Members read it company-scoped **without
  the cost columns** (column grants). Prospects see neither new table, but they do see the
  pictures, because `zone_imagery` is on 119's allow-list.
- **Backfill.** A newly watched site fills in its last 60 days over its first few nights:
  4 pictures per site per night, newest first.
- **Proven live from this sandbox (Oct 6).** On a 19-acre box at Unity Park, Greenville, the
  runner took 8 clear pictures from the last 60 days in two runs (Aug 13 → Sep 27), skipped 3
  cloudy passes, and added nothing on a third run. A GSP-airport window came back north-up
  with the runway on its true NE–SW line. Harness: `node scripts/satellite-test.mjs`
  (82 offline assertions, including the whole Planet path against a stand-in API; `--live`
  adds 6 against the real catalog and COGs).

### Code map
| File | What it is |
|---|---|
| `lib/satellite/geo.ts` | Pure geometry. UTM pixel windows, corner quads (`lib/dirt/tm.ts`), site cloud from SCL, RGBA, local day. |
| `lib/satellite/pricing.ts` | Pure cost model. Every constant is a published list price, cited below. |
| `lib/satellite/scenes.ts` | Pure catalog parsing (Earth Search, Planet), one-picture-per-day selection, captions. |
| `lib/satellite/sentinel2.ts` | Earth Search search, SCL site cover, TCI window → PNG + corners. |
| `lib/satellite/planet.ts` | Data API quick-search, item coverage estimate, Orders API (visual bundle, clip), download → PNG + corners. Dead without `PL_API_KEY`. |
| `lib/satellite/run.ts` | The cron's per-site work, storage, `zone_imagery` + `satellite_scenes` writes, Planet order collection. |
| `app/api/cron/satellite/route.ts` | Daily cron. Fails closed on `CRON_SECRET`, with a soft deadline and site caps. |
| `app/api/satellite/image/[id]/route.ts` | Signed-in route that serves licensed (Planet) pictures from the **private** `satellite` bucket through a two-minute signed link. |
| `lib/actions/satellite.ts` | `setZoneSatelliteAction`: edit + add-on + site checks, 25 Sentinel / 10 Planet sites per company. |
| `components/zones/ZoneSatellite*.tsx` | The card, plus the founder-only cost line. |

## Research: Planet (read Oct 6 2026)

### Products
- **PlanetScope (SuperDove).** About 3 m (3.7–4.2 m native ground sample), near-daily at
  nadir, 8 bands. The *visual* product is 8-bit RGB, orthorectified, UTM.
  [ESA Earth Online](https://earth.esa.int/eogateway/missions/planetscope)
- **SkySat.** 50 cm class, tasked or from archive.
  [planet.com/pricing](https://www.planet.com/pricing/)
- **APIs.**
  - The Data API searches the catalog
    ([quick-search, item coverage](https://docs.planet.com/develop/apis/data/items/)). Coverage
    gives the clear % over *your* polygon; `mode=estimate` is synchronous.
  - The Orders API buys scenes, with tools such as clip
    ([docs](https://docs.planet.com/develop/apis/orders/)).
  - The Subscriptions API delivers continuously to GCS, S3, Azure or Oracle storage
    ([docs](https://docs.planet.com/develop/apis/subscriptions/)). It does not deliver to
    Supabase, so we use Orders.
  - Tiles: streaming costs 7 credits per tile.
  - Authentication is the header `Authorization: api-key <key>`
    ([docs](https://docs.planet.com/develop/authentication/)).

### What Planet sells, and what it costs ([planet.com/pricing](https://www.planet.com/pricing/), page data read Oct 6 2026)

| Path | Price | What you get |
|---|---|---|
| Insights Flex **Starter** | $110/mo ($1,100/yr), 7,000 credits | **PlanetScope 30 days old or older only.** Ordering costs 50 credits/km², **1 km² minimum**. Enough for about 100 km² of orders a month. |
| Insights Flex **Professional** | $550/mo ($5,500/yr), 40,000 credits | Same data recency. About 500 km² of orders a month. |
| Insights Flex **Scale** | $1,200/mo ($12,000/yr), 100,000 credits | Same data recency. |
| **Enterprise / Committed Use** | Contact sales | **Next-day and near-real-time data**, areas defined up front, lower credit rates. Planet: "Data more recent than the 30-day archive requires an enterprise or Planet Agriculture plan." |
| **Planet Agriculture** | Per hectare per year: Tier One **$1.80** (the US is Tier One — [tier list](https://planet.widen.net/s/q2qsqkqjnz/ps-monitoring-aum-hum--tier-list_2023.1)), Tier Two $0.85, Tier Three $0.35. Sold in 5 km² increments at the start of an annual contract; credits extra. | Next-day PlanetScope plus a 2-year archive, fields from 1 ha. **Marketed "for agriculture use cases"**; a construction site would need Planet's OK. |
| SkySat via **Planet Select** (run by SkyFi) | Archive $6/km², flexible tasking $12/km², assured tasking $40/km²; **25 km² minimum** (from $150 / $300 per order — [SkyFi](https://skyfi.com/en/products/planet-select)) | 50 cm, one picture at a time. |
| Earlier list: **Area Under Management**, May 2026 | $2,700/yr for 50 km² Tier Three; **$9,650/yr for 50 km² global** ([observationdata.com](https://www.observationdata.com/reviews/planet-labs/), secondary) | Daily imagery over a fixed area. Now folded into Committed Use. |
| **Trial** | Free, 30 days, 3,000 credits | Sample ("sandbox") data only; **no ordering over your own area; no commercial use.** |
| **Education / research** | Applied for | University-affiliated people only (Education and Research Program, NASA CSDA). Not for us. |

**Resellers.** None makes small-site daily pictures cheap. Each sells a scene at a time
against an area minimum.

| Reseller | What we found |
|---|---|
| **UP42** | "Planet" minimum chargeable area is 25 km² per order ([docs](https://docs.up42.com/data/catalog-min-charges)). Credits: 100 = €1, minimum purchase €100 ([up42.com/pricing](https://up42.com/pricing)). |
| **SkyFi** | Archive optical "starting at $15" ([skyfi.com/en/pricing](https://skyfi.com/en/pricing)); SkySat via Planet Select as in the table above. |
| **Sentinel Hub** (Planet-owned) | PlanetScope "hectares under management" in 500 ha packages, 1 ha minimum per area, 20 % overage fee ([FAQ](https://www.sentinel-hub.com/faq/how-the-planetscope-area-under-management-work/)). |
| **Apollo Mapping** | PlanetScope about $2.25/km² with a **250 km² minimum** (2025 price list, seen in search results; their site refuses automated reads — unverified). |
| **SkyWatch** | 1–8 m archive $2.50/km², 1 km² minimum, "no annual minimums" ([skywatch.com](https://skywatch.com/data-pricing/)). The provider is not named; it may not be PlanetScope. |
| **LandInfo, EOS LandViewer** | Quote on request. |

### Licence: can we show Planet pictures to our customers?

**Not under Planet's standard terms.**

- **The self-serve Terms of Use** ([planet.com/terms-of-use](https://www.planet.com/terms-of-use/),
  effective Sep 1 2026) let the licensee use and view Planet data "through the Platform and
  third party applications". They also allow building "Application Derivative Products" for
  third parties ("Application End Users") with three limits:
  - only "provided that it **does not contain the source imagery** from the Planet Data and
    from which the Planet Data cannot be extracted";
  - with a separate data request to Planet for every end user, served "directly from Planet
    Insights Platform (i.e. via API) … and **may not rely on caching, redirection, or any
    other local storage**";
  - with "commercially reasonable efforts to prevent, and in no event permit, the download"
    of Planet data, and a copyright notice naming Planet.
- **The enterprise Master Content License Agreement 2026.1**
  ([PDF](https://go.planet.com/master-content-license-agreement-20261)) forbids two things
  unless the order schedule allows them:
  - "(d) sublicense … transfer or distribute the Licensed Materials to any third party";
  - "(f) allow third parties to access or use the Licensed Materials, including without
    limitation in any **application service** … **service bureau, or time-sharing
    arrangements**".
- **Verdict.** Per-site resale of the pictures themselves needs a **negotiated order schedule
  that grants it**. Planet runs this route as **"Powered by Planet"** for software vendors
  ([post](https://www.planet.com/pulse/elevate-your-business-with-the-powered-by-planet-program/)):
  consumption pricing, data bought up front, partners deliver imagery to their customers.
  Its prices are not published.
- **The licence-clean alternative.** A customer licenses Planet **themselves**, and
  HammerTrack is the "third party application" they view it through for their own internal
  use. That needs a per-company Planet key (not built: today's key is one platform key).
- **What the build already does for the licence.** Planet pictures go to a private bucket and
  are served only to signed-in members of the company, through a short-lived signed link.
  They carry "© Planet Labs PBC". **Before Planet is switched on for anyone, the map also
  needs to show that notice:** the Site imagery layer draws pictures with no attribution
  today.

## Free and cheap alternatives (watching earthwork progress)

| Source | Resolution / revisit | Licence | 5-acre site (142 m) | 50-acre site (450 m) |
|---|---|---|---|---|
| **Sentinel-2 L2A** — [Earth Search on AWS](https://registry.opendata.aws/sentinel-2-l2a-cogs/), COGs, no account | 10 m. Sentinel-2B and 2C plus 2A's extended campaign ([ESA](https://sentiwiki.copernicus.eu/web/s2-mission)). Over Greenville: **81 passes, Oct 2025 – Sep 2026; 30 under 20 % tile cloud**. Late summer 2026: 8 clear site pictures in 60 days. | Free, full and open, including commercial redistribution. Credit *"Contains modified Copernicus Sentinel data [Year]"* ([legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)). | 14 × 14 px: cleared vs wooded, a pad, a big stockpile | 45 × 45 px: haul roads, pads, building footprints, red clay vs grass |
| **PlanetScope** | 3 m, near-daily | See the licence section | 47 × 47 px | 150 × 150 px: stockpiles, haul roads, machines as specks |
| **SkySat** | 0.5 m, tasked | See the licence section | 284 × 284 px | 900 × 900 px: individual machines and trucks |
| **NAIP** (USDA) | 0.6 m (half the states at 0.3 m since 2025), **every 2–3 years**, leaf-on summer | Public domain ([data.gov](https://catalog.data.gov/dataset/national-agriculture-imagery-program-naip-imagery)) | 237 × 237 px | 750 × 750 px. A sharp "before" picture, useless for progress. The app already has Esri Wayback for dated history. |
| **Landsat 8/9** | 30 m (15 m panchromatic), 8-day combined revisit | Public domain, no restrictions ([USGS](https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain)) | about 5 × 5 px: nothing | 15 × 15 px: "something changed" at best |

Pixel counts cover the site alone; the stored picture adds a margin of context (60 m
minimum). What 10 m can and cannot show is the honest line on the card: *"Shows clearing,
pads and big grading changes — not machines or stakes."* A machine is 3 × 6 m, a fraction of
one pixel.

## The cost model (`lib/satellite/pricing.ts`, asserted in the harness)

- **Sentinel-2.** About $0.0005 per pass looked at: ~5 s of a 1 GB function plus a ~6 KB
  picture. Around 7 passes a month comes to **under a cent per site per month**, or about $2
  a year for 50 sites. The real limit is cron time (~3 s per picture), not money.
- **Planet next-day, area model.** Planet's published area price for next-day US imagery is
  $180–$193/km²/yr; we plan on **$190**. Each site bills its **1 km² floor**. The total is
  bought in **5 km² packages**, plus a Starter plan for platform credits ($110/mo, our
  assumption):

  `cost/yr = ceil(Σ max(1 km², site picture km²) / 5) × 5 × $190 + $1,320`

- **Planet, if it insists on the old 50 km² Area Under Management block:**

  `ceil(Σ billed km² / 50) × $9,650 + $1,320`

- **Insights Flex.** Daily orders of 30-day-old pictures, 15 clear days a month,
  50 credits/km² at a 1 km² minimum, on the cheapest plan that covers the credits.

| Sites (each < 110 acres) | Next-day area model | 50 km² block | Flex, 30-day-old pictures | Sentinel-2 |
|---|---|---|---|---|
| 1 | $2,270/yr = **$189/site/mo** | $10,970/yr = $914/site/mo | $1,320/yr = $110/site/mo | ≈ $0 |
| 10 | $3,220/yr = **$27/site/mo** | $10,970/yr = $91/site/mo | $6,600/yr = $55/site/mo | ≈ $0 |
| 50 | $10,820/yr = **$18/site/mo** | $10,970/yr = $18/site/mo | $6,600/yr = $11/site/mo | ≈ $2/yr |

- **What a small contractor would pay Planet directly** (for their own use, which the licence
  allows) to watch **10 sites daily for a year**: about **$3,200** if Planet sells it 10 km²
  of next-day area, up to **$11,000** if the 50 km² block is the floor. Self-serve today buys
  only 30-day-old pictures ($6,600/yr on Professional).
- **Buying single pictures through resellers instead** costs about $150 per SkySat picture,
  or $55k/yr per site daily. Not viable.
- **Per-site cost is flat** for any site under about 110 acres, because the picture, margin
  included, stays under 1 km². That makes **per site** (not per acre) the natural selling
  unit, and a site over 1 km² counts once per started km². A company pool (for example
  5 sites) lines up with Planet's 5 km² packages.
- **Founder view.** The zone page's Satellite card shows the platform owner this site's cost
  line (`siteEstimate`), and nobody else sees it.

## Turning on Planet

1. **Licence first.** Ask Planet sales for the **Powered by Planet / partner** order schedule.
   Two must-haves:
   - display to our customers inside HammerTrack (multi-tenant, per company);
   - next-day PlanetScope over customer sites that we define as we go.

   Ask for:
   - the price per km²/yr in the US (Tier One);
   - the minimum commitment;
   - whether the 1 km² per-area floor applies;
   - whether stored clips in our private bucket are allowed. The Terms of Use say "no local
     storage" for multi-user derived products.

   **Don't set the key before the schedule says yes.**
2. Get an API key for the organisation the contract is on (Planet account → API keys).
3. In Vercel, **project `hammertrackjune28`** (team hammertrack-team-23757fd4): add
   **`PL_API_KEY`**, Production only, then redeploy. The zone page then offers
   *Daily · 3 m · Planet*, and the cron searches, orders and collects:
   - one order per site per day, at most;
   - clipped to the site plus its margin;
   - collected in the same run or the next one;
   - stored in the private `satellite` bucket.
4. Add "© Planet Labs PBC" to the map's attribution when a Planet picture is on screen
   (MapView: open item).
5. Turn the add-on on for a company:
   `insert into company_addons (company_id, addon, source, note) values ('<company>', 'satellite', 'founder', '…')`
   (service role / SQL editor).

## Open items
- The map shows satellite pictures with no attribution line. Copernicus asks for its notice
  where data is "communicated to the public"; the zone timeline's caption carries it.
  Planet's licence requires one: a small MapView follow-up before Planet goes live.
- Deleting a picture removes its row, not its file. That has always been true for drone shots
  too; a health-cron sweep could tidy both.
- Per-company Planet keys (the licence-clean "customer brings their own Planet" route) are
  not built.
- Sentinel-1 radar (free, sees through cloud) could fill the cloudy months. June 2026 had no
  pass under 20 % cloud over Greenville. A radar picture doesn't read like a photo; worth a
  look only if customers ask about summer gaps.
