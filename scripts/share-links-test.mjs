/**
 * Share links, asserted (run: node scripts/share-links-test.mjs).
 *
 * A shared view is applied straight to the map's state on the recipient's
 * phone, so the validator in lib/share-links.ts is the whole safety story:
 * what it lets through is what a link can make somebody's map do. Run it
 * after ANY change to that file.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/share-links.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const {
  mintLinkId, LINK_ID_RE, LINK_ALPHABET, LINK_ID_LEN, cleanSharedView, defaultViewTitle, cleanTitle,
  viewLinkPath, shortLinkUrl, smsHref, VIEW_JSON_MAX,
} = mod

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}

// ── ids ───────────────────────────────────────────────────────────────────
{
  const a = mintLinkId(), b = mintLinkId()
  ok('id is 12 chars of the alphabet', LINK_ID_RE.test(a) && a.length === LINK_ID_LEN, a)
  ok('two mints differ', a !== b)
  ok('alphabet has no look-alikes', !/[01oil]/.test(LINK_ALPHABET) && LINK_ALPHABET.length === 31)
  // Deterministic bytes: 0..11 map to the first twelve letters …
  const seq = mintLinkId(() => Uint8Array.from({ length: 24 }, (_, i) => i))
  ok('bytes map onto the alphabet in order', seq === LINK_ALPHABET.slice(0, 12), seq)
  // … and a byte in the biased tail (≥ 248) is skipped, never wrapped.
  const skip = mintLinkId(() => Uint8Array.from([250, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
  ok('tail bytes are rejected, not wrapped', skip === LINK_ALPHABET.slice(0, 12), skip)
  ok('regex refuses the wrong length and letters', !LINK_ID_RE.test('abc') && !LINK_ID_RE.test('0123456789ab') && !LINK_ID_RE.test('ABCDEFGHJKMN'))
}

// ── views ─────────────────────────────────────────────────────────────────
const cfg = (extra = {}) => ({ base: 'hybrid', threeD: false, radar: false, precip: false, precipPeriod: '24h', overlays: {}, parcels: false, trailMode: 'trails', zones: true, ...extra })
const cam = { lng: -82.394, lat: 34.852, zoom: 14.25 }
{
  ok('not an object → null', cleanSharedView(null) === null && cleanSharedView('x') === null && cleanSharedView(42) === null)
  ok('no cfg → null', cleanSharedView({ cam }) === null)
  ok('no camera → null', cleanSharedView({ cfg: cfg() }) === null)
  ok('camera out of range → null', cleanSharedView({ cfg: cfg(), cam: { lng: 200, lat: 0, zoom: 10 } }) === null)
  const v = cleanSharedView({ cfg: cfg(), cam, range: 'live' })
  ok('minimal view passes', v && v.v === 1 && v.range === 'live' && v.cfg.base === 'hybrid' && v.cfg.trailMode === 'trails', v)
  ok('live carries no playhead or window', v && v.t === undefined && v.from === undefined && v.to === undefined)
  ok('camera rounded, bearing/pitch absent when zero', v && v.cam.lng === -82.394 && v.cam.zoom === 14.25 && v.cam.bearing === undefined && v.cam.pitch === undefined, v && v.cam)
}
{
  const v = cleanSharedView({ cfg: cfg({ base: 'mars', trailMode: 'lasers', precipPeriod: 'DROP TABLE', zones: 'yes' }), cam })
  ok('unknown basemap falls back to hybrid', v.cfg.base === 'hybrid', v.cfg.base)
  ok('unknown trail mode falls back to off', v.cfg.trailMode === 'off', v.cfg.trailMode)
  ok('bad precip period falls back to 24h', v.cfg.precipPeriod === '24h')
  ok('zones is a boolean, "yes" reads as on', v.cfg.zones === true)
}
{
  const overlays = { topo: true, streams: 'true', 'bad key!': true, wetlands: false, traffic: true }
  const v = cleanSharedView({ cfg: cfg({ overlays, terrain: true, clouds: 'no', terrainExag: 2.456, markers: 'arrow' }), cam, junk: 1, evil: '<script>' })
  ok('overlays keep only true values under valid keys', JSON.stringify(v.cfg.overlays) === JSON.stringify({ topo: true, traffic: true }), v.cfg.overlays)
  ok('terrain on, clouds string ignored', v.cfg.terrain === true && v.cfg.clouds === undefined)
  ok('exaggeration rounded to cents', v.cfg.terrainExag === 2.46)
  ok('marker style kept', v.cfg.markers === 'arrow')
  ok('unknown keys dropped', !('junk' in v) && !('evil' in v))
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`layer${i}`, true]))
  const w = cleanSharedView({ cfg: cfg({ overlays: many }), cam })
  ok('overlay list capped at 40', Object.keys(w.cfg.overlays).length === 40)
}
{
  const good = cleanSharedView({ cfg: cfg(), cam, range: 'custom', from: 1700000000000.7, to: 1700100000000, t: 0.42857 })
  ok('custom window kept as ints with rounded playhead', good.range === 'custom' && good.from === 1700000000001 && good.to === 1700100000000 && good.t === 0.429, good)
  const bad = cleanSharedView({ cfg: cfg(), cam, range: 'custom', from: 5, to: 5, t: 0.5 })
  ok('custom with an empty window opens on Live, no playhead', bad.range === 'live' && bad.from === undefined && bad.t === undefined, bad)
  const rng = cleanSharedView({ cfg: cfg(), cam, range: 'lastweek', t: 0.5 })
  ok('unknown range reads as live', rng.range === 'live' && rng.t === undefined)
  const rep = cleanSharedView({ cfg: cfg(), cam, range: 'yesterday', t: 7 })
  ok('replay range keeps, out-of-range playhead dropped', rep.range === 'yesterday' && rep.t === undefined)
}
{
  const v = cleanSharedView({
    cfg: cfg(), cam, follow: 'zone:6f1e2d3c-0000-4000-8000-000000000000', asset: 'phone-abc123', zone: 'bad id with spaces',
    division: 'none', labels: false, sun: true, opacity: { topo: 0.456, 'bad key!': 0.5, traffic: 2 },
  })
  ok('follow and asset ids kept, a malformed zone id dropped', v.follow === 'zone:6f1e2d3c-0000-4000-8000-000000000000' && v.asset === 'phone-abc123' && v.zone === undefined, v)
  ok('division "none" is a real pick', v.division === 'none')
  ok('labels false and sun true kept', v.labels === false && v.sun === true)
  ok('opacity rounded, bad keys and values dropped', JSON.stringify(v.opacity) === JSON.stringify({ topo: 0.46 }), v.opacity)
  const w = cleanSharedView({ cfg: cfg(), cam, labels: true, sun: false })
  ok('default-valued flags are not stored', w.labels === undefined && w.sun === undefined)
  ok('a clean view is small', JSON.stringify(v).length < VIEW_JSON_MAX / 4)
}

// ── words ─────────────────────────────────────────────────────────────────
{
  ok('default title joins the parts', defaultViewTitle({ range: 'Today', subject: 'Chevy 1500', base: 'Satellite' }) === 'Today · Chevy 1500 · Satellite')
  ok('default title skips blanks', defaultViewTitle({ range: 'Live', subject: null, base: '  ' }) === 'Live')
  ok('title strips control chars and squeezes spaces', cleanTitle('  Creek\u0000side   burn\n') === 'Creek side burn')
  ok('title caps length', cleanTitle('x'.repeat(200)).length === 80 && cleanTitle('x'.repeat(200), 10).length === 10)
  ok('blank title is null', cleanTitle('   ') === null && cleanTitle(42) === null)
  ok('paths and urls', viewLinkPath('abc') === '/map?v=abc' && shortLinkUrl('hammertrack.ai', 'abc') === 'https://hammertrack.ai/x/abc')
  ok('sms body per platform', smsHref('hi there', 'android') === 'sms:?body=hi%20there' && smsHref('hi', 'ios') === 'sms:&body=hi')
}

console.log(`share-links: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
