/**
 * The flight-trail ramps, asserted (run: node scripts/planetrail-test.mjs).
 *
 * Colour on a map is not decoration here — it is the reading. These are the
 * properties that make it honest, and each one is a mistake this file exists
 * to stop coming back.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Run the TS through the same transpile Next uses, so the test exercises the
// shipped source rather than a hand-kept copy.
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/plane-trail.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { trailColor, trailScale, legendStops, PLANE_TRAIL_MODES, NO_DATA, PLAIN, rgbToHex } = mod

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// ── A value we never measured must never be painted as a real one ──────────
for (const m of ['speed', 'climb', 'alt']) {
  const sc = trailScale(m, [0, 100, 200])
  ok(`${m}: NaN reads as no-data`, rgbToHex(trailColor(m, NaN, sc)) === rgbToHex(NO_DATA))
  ok(`${m}: no-data is NOT the zero colour`, rgbToHex(trailColor(m, NaN, sc)) !== rgbToHex(trailColor(m, 0, sc)))
}
ok('plain ignores the value entirely', rgbToHex(trailColor('plain', NaN, { lo: 0, hi: 1 })) === rgbToHex(PLAIN))

// ── Sequential: one hue, brightness rising with magnitude ─────────────────
for (const m of ['speed', 'alt']) {
  const sc = trailScale(m, [0, 250, 500])
  const steps = Array.from({ length: 9 }, (_, i) => trailColor(m, sc.lo + (sc.hi - sc.lo) * (i / 8), sc))
  let monotone = true
  for (let i = 1; i < steps.length; i++) if (lum(steps[i]) <= lum(steps[i - 1])) monotone = false
  ok(`${m}: ramp brightens monotonically`, monotone, steps.map((c) => lum(c).toFixed(3)).join(' '))
  // The low end has to survive dark forest — a ramp that bottoms out at black
  // is invisible exactly where slow flight happens.
  ok(`${m}: low end stays visible over terrain`, lum(steps[0]) > 0.06, `lum ${lum(steps[0]).toFixed(3)}`)
}

// ── Diverging: climb and descent are OPPOSITE, level is neutral ───────────
{
  const sc = trailScale('climb', [-1200, -300, 0, 400, 1500])
  ok('climb: symmetric about zero', Math.abs(sc.lo + sc.hi) < 1e-6, `${sc.lo}..${sc.hi}`)
  const up = trailColor('climb', sc.hi, sc)
  const down = trailColor('climb', sc.lo, sc)
  const level = trailColor('climb', 0, sc)
  ok('climb: the two arms are different colours', rgbToHex(up) !== rgbToHex(down))
  // "Neutral" means low saturation — a hue at the midpoint would read as a
  // third state instead of as nothing.
  const sat = (c) => Math.max(...c) - Math.min(...c)
  ok('climb: level flight is neutral', sat(level) < 0.12, `sat ${sat(level).toFixed(3)}`)
  ok('climb: both arms are more saturated than level', sat(up) > sat(level) && sat(down) > sat(level))
  // Equal magnitudes either side must be equally far from neutral, or one
  // direction silently looks stronger than the other.
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  ok('climb: arms are balanced', Math.abs(d(up, level) - d(down, level)) < 0.18)
}

// ── The scale comes from the data, and one wild fix cannot own it ─────────
{
  const sane = Array.from({ length: 100 }, (_, i) => 120 + (i % 20))
  const withSpike = [...sane, 900]
  const a = trailScale('speed', sane)
  const b = trailScale('speed', withSpike)
  ok('speed: one bad fix does not squash the ramp', Math.abs(a.hi - b.hi) < 30, `${a.hi} vs ${b.hi}`)
  ok('speed: a flat track still gets a usable range', trailScale('speed', [100, 100, 100]).hi > trailScale('speed', [100, 100, 100]).lo)
  ok('missing values are excluded, not counted as zero', trailScale('speed', [200, NaN, 210]).lo > 100)
}

// ── The legend has to carry real numbers ─────────────────────────────────
{
  const sc = trailScale('alt', [1000, 5000, 9000])
  const stops = legendStops('alt', sc)
  ok('legend: five stops', stops.length === 5)
  ok('legend: every stop names a number', stops.every((s) => /\d/.test(s.label)))
  ok('legend: ends match the ramp ends', stops[0].hex === rgbToHex(trailColor('alt', sc.lo, sc)) && stops[4].hex === rgbToHex(trailColor('alt', sc.hi, sc)))
  ok('legend: climb marks the positive side', legendStops('climb', trailScale('climb', [-500, 500])).some((s) => s.label.startsWith('+')))
  ok('legend: plain explains nothing', legendStops('plain', sc).length === 0)
}

ok('every mode is reachable from the chip row', PLANE_TRAIL_MODES.length === 4)

console.log(`\n${fail ? '✗' : '✓'} plane-trail: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
