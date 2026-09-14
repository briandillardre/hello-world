/**
 * Colour-coding the selected aircraft's flight trail (Brian, Sep 13: "I want
 * the option to see a color coded flight path based on ground speed vertical
 * speed Etc").
 *
 * The trail is a polyline drawn over SATELLITE IMAGERY, which is the whole
 * problem: a chart sits on one known surface, this sits on dark green forest,
 * pale gravel and everything between. Two rules follow from that, and they are
 * why this is not a chart ramp copy-pasted onto a map:
 *
 *  1. The dark end of a classic light→dark sequential ramp is INVISIBLE over
 *     terrain. So magnitude runs dim→bright within ONE hue instead — still a
 *     single-hue sequential ramp, still monotone in lightness, just anchored
 *     so the low end clears the imagery rather than sinking into it.
 *  2. Every hue is one the flight-log charts already use, so the trail and the
 *     charts say the same thing in the same colour: amber is altitude, teal is
 *     ground speed, and vertical speed is the charts' own validated diverging
 *     pair (checked again here against a dark-terrain surface: worst CVD ΔE
 *     12.5 protan, 24.3 normal vision, contrast ≥ 3:1).
 *
 * Vertical speed DIVERGES about zero with a neutral middle, because climb and
 * descent are opposite states and not more-and-less of one thing. Speed and
 * altitude are sequential — one hue, no rainbow.
 *
 * A value we do not have is NEVER painted as zero: an old trail point with no
 * vertical rate reads neutral grey and the legend says "no data", because
 * colouring a gap as "level flight" is a confident lie about a number nobody
 * measured.
 *
 * Pure maths, no DOM and no GL — `scripts/planetrail-test.mjs` runs it.
 */

export type PlaneTrailMode = 'plain' | 'speed' | 'climb' | 'alt'

export interface PlaneTrailModeDef {
  key: PlaneTrailMode
  /** Chip label. Plain words — a foreman is reading this, not a controller. */
  label: string
  unit: string
}

export const PLANE_TRAIL_MODES: PlaneTrailModeDef[] = [
  { key: 'plain', label: 'Plain', unit: '' },
  { key: 'speed', label: 'Speed', unit: 'kt' },
  { key: 'climb', label: 'Climb', unit: 'fpm' },
  { key: 'alt', label: 'Altitude', unit: 'ft' },
]

/** Today's trail colour, and what 'plain' keeps using. */
export const PLAIN: RGB = [1.0, 0.85, 0.35]
/** Anything we have no measurement for. Deliberately colourless. */
export const NO_DATA: RGB = [0.55, 0.60, 0.65]

export type RGB = [number, number, number]

/* ── OKLab, so a ramp is perceptually even ────────────────────────────────
   A naive hex lerp bunches the visible change at one end and leaves a muddy
   middle; interpolating in OKLab keeps each step the same size to the eye.
   Standard Björn Ottosson conversion, sRGB companding included.            */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

export function hexToOklab(hex: string): RGB {
  const h = hex.replace('#', '')
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255)
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255)
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

export function oklabToRgb(lab: RGB): RGB {
  const [L, A, B] = lab
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ]
}

const mix = (a: RGB, b: RGB, t: number): RGB =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/* ── The ramps ──────────────────────────────────────────────────────────── */

// Endpoints as OKLab. The LOW end of each sequential ramp is deliberately not
// dark: it has to stay separable from forest and shadow. The high end is the
// chart's own hue at full strength.
const SEQ: Record<'speed' | 'alt', { lo: RGB; hi: RGB }> = {
  // teal — ground speed, matching the charts' GS series
  speed: { lo: hexToOklab('#0f4f52'), hi: hexToOklab('#5eead4') },
  // amber — altitude, matching the charts' ALT series and the map popup
  alt: { lo: hexToOklab('#5c3a0c'), hi: hexToOklab('#ffc457') },
}
// The charts' validated diverging pair, plus a neutral middle: level flight
// must read as "nothing", which a hue never does.
const CLIMB = hexToOklab('#2dd4a0')
const DESCEND = hexToOklab('#f0a340')
const LEVEL = hexToOklab('#8b9299')

export interface PlaneTrailScale {
  lo: number
  hi: number
  /** How many fixes actually carried this measurement. Fewer than two and
   *  there is no reading to draw a legend for, whatever lo/hi say — climb's
   *  fallback range is symmetric by necessity, not because anyone measured
   *  it. */
  samples: number
}

/**
 * The range to stretch the ramp over, from the data itself.
 *
 * Percentiles, not min/max: one bad fix at 900 kt would otherwise squash the
 * entire real flight into the bottom of the ramp. Values we don't have are
 * excluded rather than counted as zero.
 */
export function trailScale(mode: PlaneTrailMode, values: ArrayLike<number>): PlaneTrailScale {
  const ok: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) ok.push(v)
  }
  // Nothing to scale. Climb still has to come back symmetric about zero, or
  // a single +64 fpm fix paints FULL climb against a legend reading 0 at both
  // ends.
  if (ok.length < 2) return mode === 'climb' ? { lo: -200, hi: 200, samples: ok.length } : { lo: 0, hi: 1, samples: ok.length }
  ok.sort((a, b) => a - b)
  const at = (p: number) => ok[Math.min(ok.length - 1, Math.max(0, Math.round(p * (ok.length - 1))))]
  if (mode === 'climb') {
    // Symmetric about zero, or the colour stops meaning "which side of level".
    const span = Math.max(Math.abs(at(0.05)), Math.abs(at(0.95)), 200)
    return { lo: -span, hi: span, samples: ok.length }
  }
  const lo = at(0.05)
  const hi = at(0.95)
  return hi - lo < 1e-6 ? { lo, hi: lo + 1, samples: ok.length } : { lo, hi, samples: ok.length }
}

/** A value → its colour, as 0..1 floats ready for a vertex buffer. */
export function trailColor(mode: PlaneTrailMode, value: number, scale: PlaneTrailScale): RGB {
  if (mode === 'plain') return PLAIN
  if (!Number.isFinite(value)) return NO_DATA
  if (mode === 'climb') {
    const span = scale.hi || 1
    const t = Math.max(-1, Math.min(1, value / span))
    // Each arm gets its own equal run from the neutral middle.
    return oklabToRgb(t >= 0 ? mix(LEVEL, CLIMB, t) : mix(LEVEL, DESCEND, -t))
  }
  const { lo, hi } = scale
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)))
  const ramp = SEQ[mode]
  return oklabToRgb(mix(ramp.lo, ramp.hi, t))
}

const hex2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
export const rgbToHex = (c: RGB) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`

/**
 * The legend: five stops with their REAL numbers, because a ramp with no
 * numbers on it is decoration. 'plain' has nothing to explain.
 */
export function legendStops(mode: PlaneTrailMode, scale: PlaneTrailScale): { label: string; hex: string }[] {
  if (mode === 'plain') return []
  // A trail with no measurements (or one collapsed to a single value) has no
  // ramp to explain — five swatches all labelled "0 kt" over a grey line is
  // decoration pretending to be a reading.
  if (scale.samples < 2) return []
  if (mode !== 'climb' && !(scale.hi - scale.lo > 1)) return []
  const def = PLANE_TRAIL_MODES.find((d) => d.key === mode)!
  const n = 5
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const v = scale.lo + (scale.hi - scale.lo) * t
    const rounded = mode === 'alt' ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10
    const sign = mode === 'climb' && rounded > 0 ? '+' : ''
    return { label: `${sign}${rounded.toLocaleString()}${def.unit ? ' ' + def.unit : ''}`, hex: rgbToHex(trailColor(mode, v, scale)) }
  })
}
