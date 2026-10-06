/**
 * Satellite site imagery, asserted (run: node scripts/satellite-test.mjs).
 *
 * lib/satellite/* decides what a site's satellite picture costs us, where its
 * corners go on the map, which pass to take and which to skip. Offline by
 * default: the catalog answers come from a REAL Earth Search response saved
 * in scripts/fixtures/satellite/ (two overlapping Sentinel-2 tiles, Aug–Oct
 * 2026); the Planet answer is synthetic (no key here). The UTM corners are
 * checked against Element 84's own tile footprint — an independent PROJ
 * pipeline. Run after ANY change to lib/satellite/*.
 *
 *   node scripts/satellite-test.mjs --live [out.png]
 *     also searches Earth Search for a Greenville site, reads the scene
 *     classification and the true-colour window over HTTP range, and writes
 *     the PNG (needs the network; behind a proxy set NODE_USE_ENV_PROXY=1).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const npm = (spec) => import.meta.resolve(spec)
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const tmUrl = transpile('../lib/dirt/tm.ts')
const geoUrl = transpile('../lib/satellite/geo.ts', { '../dirt/tm': tmUrl })
const pricingUrl = transpile('../lib/satellite/pricing.ts')
const scenesUrl = transpile('../lib/satellite/scenes.ts', { './geo': geoUrl, './pricing': pricingUrl })
const tm = await import(tmUrl)
const geo = await import(geoUrl)
const pr = await import(pricingUrl)
const sc = await import(scenesUrl)

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Number.isFinite(a) && Math.abs(a - b) <= eps
// Ground distance between two lng/lat points, metres (equirectangular — fine over a few metres).
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110_574)

// ── Pricing (our cost; no customer price lives in code) ────────────────────
{
  ok('247.1 acres is 1 km²', near(pr.acresToKm2(247.105), 1, 1e-4), pr.acresToKm2(247.105))
  ok('Planet bills a 19-acre site at its 1 km² floor', pr.planetBilledKm2(0.076) === 1)
  ok('Planet bills a big site to the next 0.01 km²', pr.planetBilledKm2(1.234) === 1.24, pr.planetBilledKm2(1.234))
  ok('a nonsense area still bills the floor', pr.planetBilledKm2(NaN) === 1 && pr.planetBilledKm2(-3) === 1)
  ok('Starter credits cost $110 / 7,000', near(pr.usdPerMc('starter'), 110 / 7000, 1e-12))
  ok('one ordered 1 km² scene = 50 credits ≈ $0.79', near(pr.planetSceneUsd(1), 0.7857, 1e-4), pr.planetSceneUsd(1))
  ok('a Sentinel-2 scene costs us $0.0005, a Planet scene its credits', pr.sceneCostUsd('sentinel2', 0) === 0.0005 && pr.sceneCostUsd('planet', 1) === 0.7857)
  ok('Flex plan sizing: 750 credits → Starter', pr.flexPlanFor(750).plan === 'starter')
  ok('Flex plan sizing: 7,500 credits → Professional', pr.flexPlanFor(7500).plan === 'professional')
  ok('Flex plan sizing: past Scale → more Scale plans', pr.flexPlanFor(250_000).units === 3 && pr.flexPlanFor(250_000).usdMonth === 3600)
  const sites = (n, km2 = 0.17) => Array.from({ length: n }, () => km2)
  ok('next-day area, 1 site: a 5 km² package + platform = $2,270/yr', pr.planetAreaYearUsd(sites(1)) === 2270, pr.planetAreaYearUsd(sites(1)))
  ok('next-day area, 10 sites: 10 km² + platform = $3,220/yr', pr.planetAreaYearUsd(sites(10)) === 3220, pr.planetAreaYearUsd(sites(10)))
  ok('next-day area, 50 sites: 50 km² + platform = $10,820/yr', pr.planetAreaYearUsd(sites(50)) === 10820, pr.planetAreaYearUsd(sites(50)))
  ok('no sites, no cost', pr.planetAreaYearUsd([]) === 0 && pr.planetAumYearUsd([]) === 0 && pr.planetFlexYearUsd([]) === 0)
  ok('a 3.2 km² site still fits one 5 km² package', pr.planetAreaYearUsd([3.2]) === 2270)
  ok('May-2026 AUM block: 1 site pays the whole 50 km² block', pr.planetAumYearUsd(sites(1)) === 10970)
  ok('May-2026 AUM block: 51 sites need two blocks', pr.planetAumYearUsd(sites(51)) === 2 * 9650 + 1320)
  ok('Flex daily (30-day-old): 1 site on Starter = $1,320/yr', pr.planetFlexYearUsd(sites(1)) === 1320)
  ok('Flex daily (30-day-old): 10 and 50 sites on Professional = $6,600/yr', pr.planetFlexYearUsd(sites(10)) === 6600 && pr.planetFlexYearUsd(sites(50)) === 6600)
  const table = pr.scenarioTable(0.17)
  ok('scenario table: 10 sites ≈ $26.83 per site per month (area model)', table[1].sites === 10 && table[1].area.siteMonthUsd === 26.83, table[1])
  ok('scenario table: Sentinel-2 for 50 sites costs about two dollars a year', table[2].sentinel2.yearUsd < 3, table[2].sentinel2)
  ok('price for a 60 % margin on $15.83 → $49', pr.priceForMargin(15.83, 0.6) === 49)
  ok('price for a 60 % margin on $26.83 → $69', pr.priceForMargin(26.83, 0.6) === 69)
  ok('price ending in 9 at exactly cost (no margin) stays $39', pr.priceForMargin(39, 0) === 39)
  ok('price never below $9; a 100 % margin is refused', pr.priceForMargin(0, 0.5) === 9 && Number.isNaN(pr.priceForMargin(10, 1)))
  ok('break-even at $49/site on area pricing: 4 sites', pr.breakEvenSites(49, (n) => pr.planetAreaYearUsd(sites(n))) === 4)
  ok('break-even at $49/site if Planet insists on the 50 km² block: 19 sites', pr.breakEvenSites(49, (n) => pr.planetAumYearUsd(sites(n))) === 19)
  ok('a price under cost never breaks even', pr.breakEvenSites(10, (n) => pr.planetAreaYearUsd(sites(n)), 200) === Infinity)
  const est = pr.siteEstimate(0.17)
  ok('site estimate: 1 km² billed, $15.83 area, $11.79 Flex, Sentinel ≈ $0', est.planetBilledKm2 === 1 && est.planetAreaUsd === 15.83 && est.planetFlexUsd === 11.79 && est.sentinel2Usd === 0, est)
}

// ── Grids, windows, corners ────────────────────────────────────────────────
{
  const u = geo.utmFromEpsg(32617)
  ok('EPSG 32617 is UTM 17 north', u && u.zone === 17 && !u.south)
  ok('EPSG 32717 is UTM 17 south; 26917 is NAD83 UTM 17; 4326 is not UTM',
    geo.utmFromEpsg(32717)?.south === true && geo.utmFromEpsg(26917)?.zone === 17 && geo.utmFromEpsg(4326) === null)
  ok('EPSG codes read from numbers and "EPSG:…" strings only', geo.epsgOf('EPSG:32617') === 32617 && geo.epsgOf(32617) === 32617 && geo.epsgOf('32617') === null && geo.epsgOf('foo') === null)

  // The whole 17SLU tile, cornered by our pipeline vs Element 84's footprint (PROJ).
  const fx = JSON.parse(readFileSync(new URL('./fixtures/satellite/earth-search-overlap.json', import.meta.url), 'utf8'))
  const tile = fx.features.find((f) => f.id === 'S2C_T17SLU_20261002T162316_L2A')
  const raster = { originX: 300000, originY: 3900000, resX: 10, resY: -10, width: 10980, height: 10980 }
  const corners = geo.windowCorners(u.tm, raster, { c0: 0, r0: 0, c1: 10980, r1: 10980, clipped: false })
  const fp = tile.geometry.coordinates[0] // TL, BL, BR, TR as Earth Search lists them
  const worst = Math.max(dist(corners[0], fp[0]), dist(corners[1], fp[3]), dist(corners[2], fp[2]), dist(corners[3], fp[1]))
  ok('tile corners match Earth Search\'s own footprint within 3 m (a 10 m pixel)', worst < 3, worst)

  const p = tm.utmParams(17)
  const [lng, lat] = tm.tmInverse(p, 371003.25, 3857004.5)
  const [e, n] = tm.tmForward(p, lng, lat)
  ok('UTM round trip within 1 mm', near(e, 371003.25, 1e-3) && near(n, 3857004.5, 1e-3), [e, n])

  // A 200 m × 120 m site, drawn in UTM metres off the 10 m grid.
  const site = [[371003, 3857004], [371203, 3857004], [371203, 3857124], [371003, 3857124]].map(([x, y]) => tm.tmInverse(p, x, y))
  const w = geo.windowFor(u.tm, site, raster, 60)
  ok('site window: columns 7094–7126, rows 4281–4305 (60 m of context)', w && w.c0 === 7094 && w.c1 === 7127 && w.r0 === 4281 && w.r1 === 4306 && !w.clipped, w)
  const wc = geo.windowCorners(u.tm, raster, w)
  const tlBack = tm.tmForward(p, wc[0][0], wc[0][1])
  ok('window corner lands on the pixel edge (≤ 2 cm, 7-decimal rounding)', near(tlBack[0], 370940, 0.02) && near(tlBack[1], 3857190, 0.02), tlBack)
  const edgeRaster = { ...raster, width: 7110 }
  ok('a site cut by the tile edge comes back clipped', geo.windowFor(u.tm, site, edgeRaster, 60)?.clipped === true)
  ok('a site off the tile has no window', geo.windowFor(u.tm, site, { ...raster, originX: 500000 }, 60) === null)
  ok('a south-up raster is refused', geo.windowFor(u.tm, site, { ...raster, resY: 10 }, 60) === null)
  ok('margin: a quarter of the long side, 60 m at least, 400 m at most', geo.marginFor(200, 120) === 60 && geo.marginFor(1000, 800) === 250 && geo.marginFor(4000, 10) === 400)
  const k = tm.scaleAt(p, lng, lat)
  ok('site area = UTM area ÷ k² (24,000 m² of grid)', near(geo.ringAreaM2(site) * k * k, 24_000, 1), geo.ringAreaM2(site))
  ok('outline cleaning drops the closing vertex and refuses junk',
    geo.cleanRing([[0, 0], [1, 0], [1, 1], [0, 0]])?.length === 3 && geo.cleanRing([[0, 0], [1, 1]]) === null && geo.cleanRing([[0, 0], [1, 0], [NaN, 1], [0, 0]]) === null)

  // Scene classes under the site: a 10 × 10 window of 20 m pixels, the site in the middle 6 × 6.
  const sclRaster = { originX: 0, originY: 1000, resX: 20, resY: -20, width: 10, height: 10 }
  const sclTm = tm.utmParams(17)
  const sqSite = [[40, 920], [160, 920], [160, 800], [40, 800]].map(([x, y]) => tm.tmInverse(sclTm, x + 500000, y + 3_000_000))
  const shifted = { ...sclRaster, originX: 500000, originY: 3_001_000 }
  const scl = new Uint8Array(100).fill(4) // vegetation
  scl[5 * 10 + 4] = 9; scl[5 * 10 + 5] = 8; scl[6 * 10 + 6] = 3 // two clouds + a shadow inside
  scl[0] = 9; scl[99] = 9 // clouds outside the site don't count
  scl[7 * 10 + 7] = 0 // a no-data pixel inside
  const cov = geo.sclZoneCover(sclTm, sqSite, shifted, { c0: 0, r0: 0, c1: 10, r1: 10, clipped: false }, scl)
  ok('site cloud: 3 of the 36 pixels inside (clouds outside ignored)', cov.pixels === 36 && near(cov.cloudyPct, (3 / 36) * 100, 1e-9) && near(cov.nodataPct, (1 / 36) * 100, 1e-9), cov)
  const tiny = [[100, 900], [105, 900], [105, 895], [100, 895]].map(([x, y]) => tm.tmInverse(sclTm, x + 500000, y + 3_000_000))
  const covTiny = geo.sclZoneCover(sclTm, tiny, shifted, { c0: 0, r0: 0, c1: 10, r1: 10, clipped: false }, scl)
  ok('a site smaller than a few pixels is judged on the whole window', covTiny.pixels === 100 && near(covTiny.cloudyPct, 5, 1e-9), covTiny)

  const rgb = geo.toRgba([0, 0, 0, 10, 20, 30, 1, 0, 0], 3, 3)
  ok('true colour → RGBA: black is no data (transparent), the rest opaque', rgb.rgba[3] === 0 && rgb.rgba[7] === 255 && rgb.rgba[11] === 255 && near(rgb.emptyPct, 100 / 3, 1e-9))
  const rgba = geo.toRgba([5, 5, 5, 0, 0, 0, 0, 255], 2, 4)
  ok('a 4th band is the mask', rgba.rgba[3] === 0 && rgba.rgba[7] === 255)

  ok('local day: a 16:24 UTC pass over Greenville is that day', geo.localSolarDate('2026-10-02T16:23:48.793Z', -82.4) === '2026-10-02')
  ok('local day: a 23:10 UTC pass at 170°E is the next morning there', geo.localSolarDate('2026-10-02T23:10:00Z', 170) === '2026-10-03')
  ok('local day: garbage in, null out', geo.localSolarDate('nope', 0) === null)

  const box = geo.siteBoxWithMargin(site, 100)
  const plain = geo.boxSize(geo.ringBox(site)), wide = geo.boxSize(box)
  ok('a 100 m margin widens the box by ~200 m each way', near(wide.widthM - plain.widthM, 200, 1) && near(wide.heightM - plain.heightM, 200, 1), [wide.widthM - plain.widthM, wide.heightM - plain.heightM])
  ok('the picture box of a 200 × 120 m site is ~0.13 km²', near(geo.boxSize(geo.siteAoiBox(site)).km2, (200 + 120) * (120 + 120) / 1e6, 0.01), geo.boxSize(geo.siteAoiBox(site)).km2)
}

// ── Catalog answers → which pass to take ───────────────────────────────────
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/satellite/earth-search-overlap.json', import.meta.url), 'utf8'))
  const cands = sc.parseStacSearch(fx)
  ok('the saved Earth Search answer gives 15 Sentinel-2 scenes', cands.length === 15, cands.length)
  ok('every scene has its true-colour + classification COGs on the Earth Search bucket', cands.every((c) => /^https:\/\/e84-earth-search-sentinel-data\.s3\.us-west-2\.amazonaws\.com\/.+\/TCI\.tif$/.test(c.visualHref) && /SCL\.tif$/.test(c.sclHref) && c.epsg === 32617))
  const poisoned = JSON.parse(JSON.stringify(fx))
  poisoned.features[0].assets.visual.href = 'http://169.254.169.254/latest/meta-data.tif'
  poisoned.features[1].assets.scl.href = 'https://evil.example.com/SCL.tif'
  poisoned.features[2].assets.visual.href = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/a/../../x.tif'
  poisoned.features[3].properties.datetime = 'yesterday'
  ok('a catalog answer pointing anywhere else is dropped', sc.parseStacSearch(poisoned).length === 11)
  ok('nothing parses from nothing', sc.parseStacSearch(null).length === 0 && sc.parseStacSearch({ features: 'x' }).length === 0)

  const days = sc.groupByDay(cands, -82.05)
  ok('two overlapping tiles of one pass are one day: 8 days, newest first', days.length === 8 && days[0].day === '2026-10-02' && days[7].day === '2026-08-23', days.map((d) => d.day))
  const oct2 = days.find((d) => d.day === '2026-10-02')
  ok('Oct 2: the clearer tile (17SMU, 4 %) goes first', oct2.scenes[0].id === 'S2C_T17SMU_20261002T162316_L2A' && oct2.scenes.length === 2)
  const aug25 = days.find((d) => d.day === '2026-08-25')
  ok('Aug 25: the clearer tile (17SLU, 3 %) goes first', aug25.scenes[0].id === 'S2A_T17SLU_20260825T161703_L2A')
  ok('Aug 28: one tile only', days.find((d) => d.day === '2026-08-28').scenes.length === 1)
  ok('a fresh site looks at its newest days first, capped', sc.daysToCheck(days, [], 3).map((d) => d.day).join() === '2026-10-02,2026-09-27,2026-09-17')

  const row = (day, sceneId, status, attempts = 1) => ({ day, sceneId, status, attempts })
  const SMU = 'S2C_T17SMU_20261002T162316_L2A', SLU = 'S2C_T17SLU_20261002T162316_L2A'
  ok('a day with a picture is done', sc.daySettled(oct2, [row('2026-10-02', SMU, 'ingested')]))
  ok('a cloudy day is done (both tiles are one photograph)', sc.daySettled(oct2, [row('2026-10-02', SMU, 'cloudy')]))
  ok('a day with a Planet order out is done', sc.daySettled(oct2, [row('2026-10-02', SMU, 'pending')]))
  ok('a failure with tries left keeps the day open', !sc.daySettled(oct2, [row('2026-10-02', SMU, 'failed', 1)]))
  ok('one tile cutting the site off leaves the other tile to try', !sc.daySettled(oct2, [row('2026-10-02', SMU, 'nodata')]))
  ok('both tiles spent (cut off / failed 3×) closes the day', sc.daySettled(oct2, [row('2026-10-02', SMU, 'nodata'), row('2026-10-02', SLU, 'failed', 3)]))
  ok('settled days drop out of the run; the rest keep their order',
    sc.daysToCheck(days, [row('2026-10-02', SMU, 'ingested'), row('2026-09-27', 'S2B_T17SMU_20260927T162129_L2A', 'cloudy')], 2).map((d) => d.day).join() === '2026-09-17,2026-09-14')
  ok('a scene is retried until it fails three times', sc.sceneOpen(SMU, [row('2026-10-02', SMU, 'failed', 2)]) && !sc.sceneOpen(SMU, [row('2026-10-02', SMU, 'failed', 3)]) && !sc.sceneOpen(SMU, [row('2026-10-02', SMU, 'ingested')]) && sc.sceneOpen(SLU, []))

  ok('Sentinel-2 caption: source · date · resolution · Copernicus notice',
    sc.captionFor('sentinel2', '2026-09-27', 10) === 'Sentinel-2 · Sep 27, 2026 · 10 m · Contains modified Copernicus Sentinel data 2026', sc.captionFor('sentinel2', '2026-09-27', 10))
  ok('Planet caption carries © Planet Labs PBC', sc.captionFor('planet', '2026-09-27', 3) === 'PlanetScope · Sep 27, 2026 · 3 m · © 2026 Planet Labs PBC')

  // Planet (synthetic — no key in this sandbox): quality, units, ranking.
  const planet = {
    type: 'FeatureCollection',
    features: [
      { id: '20260927_153012_45_2479', properties: { acquired: '2026-09-27T15:30:12.45Z', cloud_cover: 0.12, clear_percent: 85, pixel_resolution: 3, quality_category: 'standard', satellite_id: '2479' } },
      { id: '20260927_160455_11_24c1', properties: { acquired: '2026-09-27T16:04:55.11Z', cloud_cover: 0.01, clear_percent: 99, pixel_resolution: 3, quality_category: 'standard', satellite_id: '24c1' } },
      { id: '20260927_161000_00_2400', properties: { acquired: '2026-09-27T16:10:00Z', cloud_cover: 0, clear_percent: 100, pixel_resolution: 3, quality_category: 'test' } },
      { id: '../../etc', properties: { acquired: '2026-09-26T15:00:00Z', cloud_cover: 0, clear_percent: 100 } },
      { id: '20260926_150101_22_2481', properties: { acquired: '2026-09-26T15:01:01Z', cloud_cover: 0.4, clear_percent: 60, gsd: 3.9, quality_category: 'standard' } },
    ],
  }
  const pc = sc.parsePlanetSearch(planet)
  ok('Planet: test-quality and bad ids dropped, cloud as a percentage', pc.length === 3 && near(pc[0].cloudPct, 12, 1e-9) && pc[0].gsdM === 3 && pc[2].gsdM === 3.9, pc)
  const pdays = sc.groupByDay(pc, -82.4)
  ok('Planet: the clearest pass of the day goes first', pdays[0].day === '2026-09-27' && pdays[0].scenes[0].id === '20260927_160455_11_24c1')
}

// ── The cron's runner, against stand-ins (no network) ──────────────────────
// A tiny in-memory Supabase (just the calls run.ts makes) and a fake Planet
// API serving a synthetic UTM GeoTIFF: search → site-clear check → order →
// collect → private picture on the timeline. Proves the Planet path end to end
// without a key, and the dedupe that keeps a paid order from being placed twice.
const pngUrl = transpile('../lib/dirt/png.ts')
const s2Url = transpile('../lib/satellite/sentinel2.ts', { geotiff: npm('geotiff'), '../dirt/png': pngUrl, './geo': geoUrl, './scenes': scenesUrl })
const planetUrl = transpile('../lib/satellite/planet.ts', { geotiff: npm('geotiff'), '../dirt/png': pngUrl, './geo': geoUrl, './scenes': scenesUrl, './sentinel2': s2Url })
const runUrl = transpile('../lib/satellite/run.ts', { './geo': geoUrl, './scenes': scenesUrl, './pricing': pricingUrl, './sentinel2': s2Url, './planet': planetUrl })
{
  const run = await import(runUrl)
  const { writeArrayBuffer } = await import(npm('geotiff'))
  const tables = { satellite_scenes: [], zone_imagery: [], zone_satellite: [] }
  const objects = new Map()
  const fakeDb = {
    from(table) {
      const filters = []
      let op = 'select', payload = null, onConflict = null, limitN = Infinity
      const exec = () => {
        const rows = tables[table]
        const hit = (r) => filters.every((f) => f(r))
        if (op === 'select') return { data: rows.filter(hit).slice(0, limitN), error: null }
        if (op === 'insert') { rows.push({ ...payload }); return { data: null, error: null } }
        if (op === 'update') { for (const r of rows) if (hit(r)) Object.assign(r, payload); return { data: null, error: null } }
        const keys = onConflict.split(',')
        const same = rows.find((r) => keys.every((k) => r[k] === payload[k]))
        if (same) Object.assign(same, payload); else rows.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload })
        return { data: null, error: null }
      }
      const q = {
        select() { return q }, order() { return q },
        eq(c, v) { filters.push((r) => r[c] === v); return q },
        gte(c, v) { filters.push((r) => String(r[c]) >= String(v)); return q },
        limit(n) { limitN = n; return q },
        upsert(row, o) { op = 'upsert'; payload = row; onConflict = o.onConflict; return q },
        insert(row) { op = 'insert'; payload = row; return q },
        update(row) { op = 'update'; payload = row; return q },
        maybeSingle() { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
        then(res, rej) { return Promise.resolve(exec()).then(res, rej) },
      }
      return q
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes) => { objects.set(`${bucket}/${path}`, bytes); return { error: null } },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://db.example/storage/v1/object/public/${bucket}/${path}` } }),
        remove: async (paths) => { for (const p of paths) objects.delete(`${bucket}/${p}`); return { error: null } },
      }),
    },
  }

  // A 19-acre site in UTM 17N and the clip Planet would send back for it: 3 m RGB, north-up.
  const p = tm.utmParams(17)
  const E0 = 371_000, N0 = 3_857_000, side = 277
  const ring = [[0, 0], [side, 0], [side, side], [0, side]].map(([x, y]) => tm.tmInverse(p, E0 + x, N0 + y))
  const w = 140, h = 140, originX = E0 - 70, originY = N0 + side + 70
  const rgb = new Uint8Array(w * h * 3).map((_, i) => 40 + (i % 3) * 30)
  rgb.fill(0, 0, 3 * w) // first row empty (clipped edge)
  const tif = writeArrayBuffer(rgb, {
    width: w, height: h, ProjectedCSTypeGeoKey: 32617, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1,
    ModelPixelScale: [3, 3, 0], ModelTiepoint: [0, 0, 0, originX, originY, 0],
  })

  const ORDER = '0b6c1f44-5d7e-4f8a-9b2c-3d4e5f6a7b8c'
  let polls = 0, orders = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    const auth = init.headers?.authorization
    if (auth !== 'api-key test-key') return new Response('no', { status: 401 })
    if (u.includes('/data/v1/quick-search')) {
      return Response.json({ features: [
        { id: '20261005_152001_11_2479', properties: { acquired: '2026-10-05T15:20:01Z', cloud_cover: 0.2, clear_percent: 80, pixel_resolution: 3, quality_category: 'standard' } },
        { id: '20261005_160344_07_24c1', properties: { acquired: '2026-10-05T16:03:44Z', cloud_cover: 0.25, clear_percent: 75, pixel_resolution: 3, quality_category: 'standard' } },
      ] })
    }
    if (u.includes('/coverage?mode=estimate')) {
      // The clearest scene overall has a cloud over the site; the other one is clear there.
      return Response.json({ status: 'complete', clear_percent: u.includes('20261005_152001_11_2479') ? 40 : 97 })
    }
    if (u.endsWith('/compute/ops/orders/v2') && init.method === 'POST') {
      orders++
      const body = JSON.parse(init.body)
      if (body.products[0].item_ids[0] !== '20261005_160344_07_24c1' || !body.tools[0].clip.aoi) return new Response('bad order', { status: 400 })
      return Response.json({ id: ORDER, state: 'queued' }, { status: 202 })
    }
    if (u.endsWith(`/compute/ops/orders/v2/${ORDER}`)) {
      polls++
      if (polls === 1) return Response.json({ id: ORDER, state: 'running', _links: { results: [] } })
      return Response.json({ id: ORDER, state: 'success', _links: { results: [
        { name: `${ORDER}/PSScene/20261005_160344_07_24c1_metadata.json`, location: 'https://api.planet.com/compute/ops/download/?token=meta' },
        { name: `${ORDER}/PSScene/20261005_160344_07_24c1_3B_Visual_clip.tif`, location: 'https://api.planet.com/compute/ops/download/?token=visual' },
      ] } })
    }
    if (u === 'https://api.planet.com/compute/ops/download/?token=visual') return new Response(tif)
    return new Response('unexpected ' + u, { status: 404 })
  }
  process.env.PL_API_KEY = 'test-key'
  try {
    const site = { id: '7e1d2c3b-0000-4000-8000-000000000001', companyId: '7e1d2c3b-0000-4000-8000-0000000000c0', ring }
    const sub = { zone_id: site.id, company_id: site.companyId, provider: 'planet', enabled_at: new Date(Date.now() - 86_400_000).toISOString(), last_scene_at: null }
    // The fake scenes were "acquired" on Oct 5 2026; pin the clock to that evening.
    const realNow = Date.now
    Date.now = () => Date.parse('2026-10-05T22:35:00Z')
    let t1, t2, c1, c2
    try {
      sub.enabled_at = new Date(Date.now() - 86_400_000).toISOString()
      t1 = await run.runPlanetSite(fakeDb, sub, site, Date.now() + 60_000)
      t2 = await run.runPlanetSite(fakeDb, sub, site, Date.now() + 60_000)
      c1 = await run.collectPlanetOrders(fakeDb, Date.now() + 60_000)
      c2 = await run.collectPlanetOrders(fakeDb, Date.now() + 60_000)
    } finally {
      Date.now = realNow
    }
    const scene = tables.satellite_scenes[0]
    ok('Planet: one order, for the scene that is clear over the SITE (not the clearest scene)', t1.ordered === 1 && orders === 1 && scene?.scene_id === '20261005_160344_07_24c1', { t1, orders, scene })
    ok('Planet: the order bills the 1 km² floor at list price', scene?.billed_km2 === 1 && scene?.est_cost_usd === 0.7857 && near(scene?.zone_cloud_pct, 3, 1e-9), scene)
    ok('Planet: a second run the same day places no second order', t2.ordered === 0 && orders === 1, t2)
    ok('Planet: a running order is left to wait, a finished one collected', c1.waiting === 1 && c1.collected === 0 && c2.collected === 1, { c1, c2 })
    const img = tables.zone_imagery[0]
    ok('Planet: the picture is a placed satellite photo on the timeline, behind the signed-in route', img && img.source === 'satellite' && img.kind === 'photo' && img.url === `/api/satellite/image/${img.id}` && img.taken_on === '2026-10-05', img)
    ok('Planet: the file sits in the PRIVATE bucket at <company>/<site>/<picture>.png', objects.has(`satellite/${site.companyId}/${site.id}/${img?.id}.png`) && scene?.storage_path === `${site.companyId}/${site.id}/${img?.id}.png`, [...objects.keys()])
    const back = tm.tmForward(p, img.bounds[0][0], img.bounds[0][1])
    const br = tm.tmForward(p, img.bounds[2][0], img.bounds[2][1])
    ok('Planet: corners come from the GeoTIFF\'s own grid (TL and BR within 2 cm)', near(back[0], originX, 0.02) && near(back[1], originY, 0.02) && near(br[0], originX + 3 * w, 0.02) && near(br[1], originY - 3 * h, 0.02), [back, br])
    ok('Planet: caption carries © Planet Labs PBC', /^PlanetScope · Oct 5, 2026 · 3 m · © 2026 Planet Labs PBC$/.test(img?.caption ?? ''), img?.caption)
    ok('Planet: the scene row says ingested and points at the picture', scene?.status === 'ingested' && scene?.imagery_id === img?.id)
    ok('Planet: a download link off planet.com is refused', !(await import(planetUrl)).planetHost('https://evil.example/x.tif') && (await import(planetUrl)).planetHost('https://api.planet.com/compute/ops/download/?token=x'))
  } finally {
    globalThis.fetch = realFetch
    delete process.env.PL_API_KEY
  }
}

// ── Live: Earth Search + a real COG window (opt-in) ────────────────────────
if (process.argv.includes('--live')) {
  const s2 = await import(s2Url)
  // A 19-acre (our median site) square in Greenville's Unity Park area.
  const p = tm.utmParams(17)
  const [e0, n0] = tm.tmForward(p, -82.4087, 34.8456)
  const side = Math.sqrt(19 * geo.ACRE_M2)
  const ring = [[0, 0], [side, 0], [side, side], [0, side]].map(([x, y]) => tm.tmInverse(p, e0 + x, n0 + y))
  const box = geo.ringBox(ring)
  const t0 = Date.now()
  const now = new Date()
  const cands = await s2.searchSentinel2(box, new Date(now.getTime() - 45 * 86_400_000).toISOString(), now.toISOString(), AbortSignal.timeout(30_000))
  const days = sc.groupByDay(cands, (box.minLng + box.maxLng) / 2)
  console.log(`  live: ${cands.length} scenes on ${days.length} days in 45 days (${Date.now() - t0} ms)`)
  ok('live: Earth Search lists Sentinel-2 passes over Greenville', days.length >= 3, days.length)
  let shot = null
  for (const d of days) {
    const c = d.scenes[0]
    const t1 = Date.now()
    const cover = await s2.siteCover(c, ring, AbortSignal.timeout(30_000))
    console.log(`  live: ${d.day} ${c.id} tile ${c.cloudPct.toFixed(1)}% · site ${cover.cloudyPct.toFixed(1)}% cloud, ${cover.nodataPct.toFixed(1)}% no data (${Date.now() - t1} ms)`)
    if (cover.nodataPct <= s2.S2_SITE_NODATA_MAX && cover.cloudyPct <= s2.S2_SITE_CLOUD_MAX) { shot = { c, d }; break }
  }
  ok('live: a clear pass was found in 45 days', !!shot)
  if (shot) {
    const t2 = Date.now()
    const pic = await s2.readSitePicture(shot.c, ring, AbortSignal.timeout(60_000))
    console.log(`  live: picture ${pic.width}×${pic.height} px, ${pic.png.length} bytes, ${pic.emptyPct.toFixed(1)}% empty (${Date.now() - t2} ms)`)
    const sig = Array.from(pic.png.slice(0, 8)).join(',')
    ok('live: a real PNG', sig === '137,80,78,71,13,10,26,10')
    ok('live: ~276 m site + 2 × 69 m context at 10 m ≈ 42 px square', pic.width >= 40 && pic.width <= 45 && pic.height >= 40 && pic.height <= 45, [pic.width, pic.height])
    const c0 = pic.corners[0], c2 = pic.corners[2]
    ok('live: the corners frame the site', c0[0] < box.minLng && c0[1] > box.maxLat && c2[0] > box.maxLng && c2[1] < box.minLat, pic.corners)
    ok('live: almost no empty pixels mid-tile', pic.emptyPct < 1, pic.emptyPct)
    const out = process.argv[process.argv.indexOf('--live') + 1]
    if (out && !out.startsWith('--')) { writeFileSync(out, pic.png); console.log(`  live: wrote ${out} (${shot.d.day}, ${sc.captionFor('sentinel2', shot.d.day, pic.gsdM)})`) }
  }
}

console.log(`satellite: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
