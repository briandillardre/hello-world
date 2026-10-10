/**
 * Stall counting assist — pure. Along a line drawn across a row of stalls
 * (along the curb or the stall ends), sample the picture's brightness and
 * find the painted stripes: bright, narrow peaks standing out of the asphalt.
 * Stalls = stripes − 1 (a row painted at both ends). The count is a STARTING
 * number the estimator corrects — faded paint, a parked car over a stripe or
 * a double line all change it.
 */
import type { Pixels } from './wand'

const lum = (img: Pixels, x: number, y: number) => {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)))
  const i = (yi * img.width + xi) * 4
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
}

/**
 * Brightness every `step` pixels from A to B, each sample the MAX across a
 * short perpendicular (±halfWidth px) — a stripe is found even when the line
 * is drawn a little off its painted end.
 */
export function sampleProfile(img: Pixels, ax: number, ay: number, bx: number, by: number, step = 1, halfWidth = 3): number[] {
  const L = Math.hypot(bx - ax, by - ay)
  if (!(L > 0)) return []
  const ux = (bx - ax) / L, uy = (by - ay) / L
  const px = -uy, py = ux
  const n = Math.floor(L / step) + 1
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const cx = ax + ux * i * step, cy = ay + uy * i * step
    let m = -Infinity
    for (let k = -halfWidth; k <= halfWidth; k++) m = Math.max(m, lum(img, cx + px * k, cy + py * k))
    out.push(m)
  }
  return out
}

export interface StripeResult {
  /** Stripe centres, in sample index. */
  stripes: number[]
  stalls: number
  /** Median gap between stripes, samples. */
  spacing: number | null
  /** A gap is far off the usual spacing (a missed or extra stripe) — check the count. */
  irregular: boolean
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = a.slice().sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Find stripes in a brightness profile. A stripe is a run above the
 * threshold (asphalt median + half the way to the bright end, at least
 * `minContrast` brighter) no wider than `maxWidth` samples; runs closer than
 * `minGap` merge (a double line is one stall divider).
 */
export function findStripes(profile: number[], opts: { minContrast?: number; maxWidth?: number; minGap?: number } = {}): StripeResult {
  const none: StripeResult = { stripes: [], stalls: 0, spacing: null, irregular: false }
  if (profile.length < 5) return none
  // Smooth with a 3-tap box.
  const p = profile.map((_, i) => (profile[Math.max(0, i - 1)] + profile[i] + profile[Math.min(profile.length - 1, i + 1)]) / 3)
  const base = median(p)
  const hi = p.slice().sort((a, b) => a - b)[Math.floor(p.length * 0.98)]
  const minContrast = opts.minContrast ?? 35
  if (hi - base < minContrast) return none
  const thr = base + Math.max(minContrast * 0.6, (hi - base) * 0.5)
  const maxWidth = opts.maxWidth ?? 40
  const minGap = opts.minGap ?? 6
  let runs: [number, number][] = []
  let s = -1
  for (let i = 0; i <= p.length; i++) {
    const up = i < p.length && p[i] > thr
    if (up && s < 0) s = i
    if (!up && s >= 0) { runs.push([s, i - 1]); s = -1 }
  }
  // Merge runs closer than minGap (double lines, a crack through a stripe).
  const merged: [number, number][] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r[0] - last[1] <= minGap) last[1] = r[1]
    else merged.push([r[0], r[1]])
  }
  runs = merged.filter(r => r[1] - r[0] + 1 <= maxWidth)
  const stripes = runs.map(r => (r[0] + r[1]) / 2)
  const gaps = stripes.slice(1).map((c, i) => c - stripes[i])
  const spacing = gaps.length ? median(gaps) : null
  let irregular = false
  if (gaps.length >= 2 && spacing) irregular = gaps.some(g => g > spacing * 1.5 || g < spacing * 0.6)
  return { stripes, stalls: Math.max(0, stripes.length - 1), spacing, irregular }
}
