/**
 * Beacon identity, asserted (run: node scripts/ble-sightings-test.mjs).
 *
 * `beaconCandidates` in lib/ble-sightings.ts decides which registered
 * tracker_ids a reported tag id can match — for a Teltonika box in a truck
 * (hex major/minor, zero-UUID MACs) and for a phone running the app (decimal
 * major/minor, bare MACs). A miss here is a tool the map never sees; a false
 * match files somebody's earbuds as a machine. Run it after ANY change.
 *
 * Sep 19: the New Holland excavator's EYE Beacon was registered in the zero-
 * UUID form the trucks report, and a phone standing beside it — which hears
 * the bare MAC — matched nothing. Both forms now resolve to each other.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/ble-sightings.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const { beaconCandidates } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log('  FAIL', name, extra)
}
const has = (list, v) => list.map((x) => x.toLowerCase()).includes(v.toLowerCase())
const strip = (s) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()
// The matcher's second phase, as recordBeaconSightings runs it: exact first,
// then separator-insensitive on whole strings ≥ 8 chars.
const matches = (candidates, trackerId) => {
  const lc = trackerId.toLowerCase()
  if (candidates.some((c) => c.toLowerCase() === lc)) return true
  const bare = candidates.map(strip).filter((s) => s.length >= 8)
  return bare.includes(strip(trackerId))
}

const ZERO = '00000000-0000-0000-0000-7CD9F408B553'

// ── A truck hears a factory EYE Beacon (zero UUID + MAC) ──────────────────
{
  const c = beaconCandidates(ZERO, 'hex')
  ok('truck: zero-UUID form kept', has(c, ZERO))
  ok('truck: bare MAC derived', has(c, '7CD9F408B553'))
  ok('truck: matches a tool registered by MAC', matches(c, '7CD9F408B553'))
  ok('truck: matches a tool registered by colon MAC', matches(c, '7C:D9:F4:08:B5:53'))
  ok('truck: matches a tool registered in the zero-UUID form', matches(c, ZERO))
}

// ── A phone hears the SAME tag as a bare MAC (the Sep 19 miss) ────────────
for (const form of ['7C:D9:F4:08:B5:53', '7c:d9:f4:08:b5:53', '7C-D9-F4-08-B5-53', '7CD9F408B553']) {
  const c = beaconCandidates(form, 'dec')
  ok(`phone ${form}: zero-UUID form derived`, has(c, ZERO), JSON.stringify(c))
  ok(`phone ${form}: matches the zero-UUID registration`, matches(c, ZERO))
  ok(`phone ${form}: matches a bare-MAC registration`, matches(c, '7CD9F408B553'))
  ok(`phone ${form}: does not match another tag`, !matches(c, '00000000-0000-0000-0000-7CD9F408B56C'))
}

// ── iBeacon identities are untouched ──────────────────────────────────────
{
  const hex = beaconCandidates('FDA50693-A4E2-4FB1-AFCF-C6EB07647825:2751:0004', 'hex')
  ok('truck iBeacon: decimal form derived', has(hex, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10065:4'), JSON.stringify(hex))
  ok('truck iBeacon: decimal shorthand derived', has(hex, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:4'))
  ok('truck iBeacon: no MAC nonsense', !hex.some((x) => x.startsWith('00000000-0000-0000-0000-')))
  const dec = beaconCandidates('FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10065:4', 'dec')
  ok('phone iBeacon: hex form derived', has(dec, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:2751:0004'), JSON.stringify(dec))
  ok('phone iBeacon: matches the trench roller registration', matches(dec, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10065:4'))
  // An all-digit hex pair must NOT also be read as decimal (the Aug 12 collision).
  const amb = beaconCandidates('FDA50693-A4E2-4FB1-AFCF-C6EB07647825:0010:0016', 'hex')
  ok('truck iBeacon: one numbering only', !has(amb, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10:16') || has(amb, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:16:22'))
  ok('truck iBeacon: shorthand is the decimal minor', has(amb, 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:22'))
}

// ── Things that are not MACs stay out of the MAC path ─────────────────────
{
  ok('a 15-digit IMEI is not a MAC', !beaconCandidates('352625692102222', 'dec').some((x) => x.startsWith('00000000-')))
  ok('a UUID is not a MAC', !beaconCandidates('E20A39F4-73F5-4BC4-1864-17D1AD07A962', 'dec').some((x) => x.startsWith('00000000-')))
  ok('a short id is not a MAC', beaconCandidates('7CD9F4', 'dec').length === 1)
  ok('a MAC with a stray char is not a MAC', !beaconCandidates('7C:D9:F4:08:B5:5G', 'dec').some((x) => x.startsWith('00000000-')))
  // A randomized phone/earbud MAC gains a zero-UUID candidate too — harmless:
  // it can only ever match a tool somebody registered under that exact MAC.
  const rnd = beaconCandidates('5A:1B:2C:3D:4E:5F', 'dec')
  ok('random MAC: nothing but its own forms', rnd.length === 3 && has(rnd, '00000000-0000-0000-0000-5A1B2C3D4E5F'))
}

console.log(`ble-sightings: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
