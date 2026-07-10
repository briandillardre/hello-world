import type { AssetTrack } from './trails'

/**
 * Fleet activity over the playback window — how many assets are MOVING in each
 * time bucket. Drives the heat-colored timeline slider, the pull-up activity
 * chart, and "start playback at first movement instead of midnight".
 */

export const ACTIVITY_BUCKETS = 96

// Degrees of travel inside a segment below which it's GPS jitter, not movement
// (~30 m at mid latitudes).
const MOVE_DEG = 3e-4

/** Per-bucket count of assets moving. counts.length === buckets. */
export function buildActivityCurve(tracks: AssetTrack[], buckets = ACTIVITY_BUCKETS): number[] {
  const counts = new Array<number>(buckets).fill(0)
  const moving = new Array<boolean>(buckets)
  for (const tr of tracks) {
    moving.fill(false)
    const pts = tr.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (b.gap) continue // device asleep — the chord isn't real travel
      if (Math.hypot(b.lng - a.lng, b.lat - a.lat) < MOVE_DEG) continue
      const b0 = Math.min(buckets - 1, Math.max(0, Math.floor(a.t * buckets)))
      const b1 = Math.min(buckets - 1, Math.max(0, Math.floor(b.t * buckets)))
      for (let k = b0; k <= b1; k++) moving[k] = true
    }
    for (let k = 0; k < buckets; k++) if (moving[k]) counts[k]++
  }
  return counts
}

/** Normalized t of the first bucket with any movement (0 when idle all day —
 *  playback then starts at the window start, same as before). */
export function firstMovementT(counts: number[]): number {
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) return i / counts.length
  }
  return 0
}

// ── Heat colors ──────────────────────────────────────────────────────────────
// Same ramp as the map's movement heatmap: quiet blue (nothing moving) →
// teal → amber → red (max concurrent assets). Consistent = learnable.

const QUIET = '#173f63' // calm blue — nobody moving (nights read as blue bands)
const RAMP: [number, [number, number, number]][] = [
  [0, [45, 212, 191]],   // teal
  [0.55, [255, 158, 22]], // amber
  [1, [251, 93, 93]],    // red
]

export function activityColor(count: number, max: number): string {
  if (count <= 0) return QUIET
  const f = max <= 1 ? 1 : (count - 1) / (max - 1)
  for (let i = 1; i < RAMP.length; i++) {
    if (f <= RAMP[i][0]) {
      const [f0, c0] = RAMP[i - 1]
      const [f1, c1] = RAMP[i]
      const k = f1 === f0 ? 0 : (f - f0) / (f1 - f0)
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k))
      return `rgb(${c[0]},${c[1]},${c[2]})`
    }
  }
  return `rgb(${RAMP[RAMP.length - 1][1].join(',')})`
}

/** CSS linear-gradient with a hard stop per bucket — the slider track itself
 *  becomes the heat map. */
export function activityGradient(counts: number[], max: number): string {
  const n = counts.length
  if (n === 0) return QUIET
  const stops: string[] = []
  let runStart = 0
  let runColor = activityColor(counts[0], max)
  for (let i = 1; i <= n; i++) {
    const c = i < n ? activityColor(counts[i], max) : ''
    if (c !== runColor || i === n) {
      const from = ((runStart / n) * 100).toFixed(2)
      const to = ((i / n) * 100).toFixed(2)
      stops.push(`${runColor} ${from}%`, `${runColor} ${to}%`)
      runStart = i
      runColor = c
    }
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** Per-bucket deltas of a cumulative curve (cost ledger → $ per interval). */
export function deltas(cumulative: number[]): number[] {
  return cumulative.map((v, i) => (i === 0 ? v : v - cumulative[i - 1]))
}

/** Human label for one bucket's span, e.g. "15 min" / "2 h" / "1.9 days". */
export function bucketSpanLabel(windowSeconds: number, buckets = ACTIVITY_BUCKETS): string {
  const s = windowSeconds / buckets
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 86_400) return `${(s / 3600) % 1 === 0 ? s / 3600 : (s / 3600).toFixed(1)} h`
  return `${(s / 86_400).toFixed(1)} days`
}

/** Smooth SVG area path ("sexy line") for a series, in a W×H viewBox.
 *  Catmull-Rom → cubic Bézier through per-bucket midpoints. */
export function areaPath(series: number[], max: number, W: number, H: number, pad = 2): string {
  const n = series.length
  if (n === 0 || max <= 0) return ''
  const xs = (i: number) => ((i + 0.5) / n) * W
  const ys = (v: number) => H - pad - (Math.min(v, max) / max) * (H - pad * 2)
  const pts = series.map((v, i) => [xs(i), ys(v)] as [number, number])
  let d = `M 0 ${ys(series[0]).toFixed(1)} L ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  d += ` L ${W} ${ys(series[n - 1]).toFixed(1)}`
  return d
}

/** Tiny heat-colored bar chart as a raw SVG string — for map popups (which are
 *  plain HTML, not React). Bars colored by their own value on the heat ramp. */
export function sparkBarsSVG(series: number[], w = 181, h = 36): string {
  const max = Math.max(...series, 0)
  if (max <= 0) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" stroke="#14506f" stroke-width="1"/></svg>`
  }
  const n = series.length
  const bw = w / n
  let bars = ''
  for (let i = 0; i < n; i++) {
    const v = series[i]
    if (v <= 0) continue
    const bh = Math.max(1.5, (v / max) * (h - 2))
    // color by intensity: reuse the ramp with count≈v, max≈max (continuous)
    const f = v / max
    const color = f < 0.02 ? '#173f63' : activityColor(1 + f * 9, 10)
    bars += `<rect x="${(i * bw + 0.4).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.8, bw - 0.8).toFixed(1)}" height="${bh.toFixed(1)}" rx="0.8" fill="${color}"/>`
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="#14506f" stroke-width="1"/>${bars}</svg>`
}
