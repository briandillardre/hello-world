import type { AssetTrack } from './trails'
import type { AssetType } from './types'

/**
 * 3D activity terrain — bins the fleet's pings into a hexagonal grid and
 * extrudes each cell by TIME SPENT there. Height answers "how much", which a
 * flat heatmap can't: parked hours tower over drive-throughs, idle hotspots
 * at the gate stand up and point at themselves. Rendered with MapLibre's
 * native fill-extrusion (no extra deps), driven by the timeline scrubber.
 *
 * Dwell accrues at each segment's START point — a sleep gap means the asset
 * sat exactly there, so overnight parking builds honest towers.
 */

const M_PER_DEG = 111_320
const SQRT3 = Math.sqrt(3)
const H_MAX = 1400
const H_MIN = 12
/** ABSOLUTE height references (Brian, Aug 24: "a single drive = flat long
 *  mole trail; a busy jobsite grows over the timeframe"). Full height means
 *  ~6 crew-hours (or ~$1,200) accumulated in one cell — so a drive-through
 *  is honestly low no matter how quiet the rest of the window is, instead
 *  of the old tallest-cell-wins relative scale. Windows that exceed the
 *  reference still stretch it upward (a 30-day view stays sane). */
const HOURS_REF_SEC = 6 * 3600
const DOLLARS_REF = 1200

export type Heat3dUnits = 'hours' | 'dollars'

export function hexHeatGeoJSON(
  tracks: AssetTrack[],
  filter: Set<AssetType>,
  t: number,
  windowSec: number,
  cellMeters = 110,
  /** 'dollars' extrudes $ (dwell-seconds × the asset's $/hr) instead of time. */
  units: Heat3dUnits = 'hours',
  /** assetId → $/hr; assets missing here contribute $0 in dollars mode. */
  ratePerHr?: Map<string, number>,
  /** Selection spotlight: this asset's share of each cell emits `dim: 0`
   *  (full-strength layer), everyone else's `dim: 1` (ghost layer) — built
   *  in ONE pass so both halves share the same hex lattice and the same
   *  height reference. Two subset calls let whichever half held the tallest
   *  cell rescale itself once past the absolute reference (ship-check). */
  selId?: string | null
): GeoJSON.FeatureCollection {
  const bins = new Map<string, { q: number; r: number; sec: number; usd: number; selSec: number; selUsd: number }>()
  let lat0: number | null = null
  let cosLat = 1

  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    // Tools clone their carrier's path (pairing episodes) — counting them
    // here doubles the carrier's dwell once per tag aboard (Brian's truck
    // with 3 tags would stack 4× hills). The carrier already tells it.
    if (tr.type === 'tool') continue
    const isSel = selId != null && tr.assetId === selId
    const rate = ratePerHr?.get(tr.assetId) ?? 0
    const pts = tr.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.t > t) break
      const dt = (Math.min(b.t, t) - a.t) * windowSec
      if (dt <= 0) continue
      if (lat0 === null) { lat0 = a.lat; cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180)) }
      // Presence damping (Aug 24): a machine WORKING a cell builds it at
      // full value; an asset merely parked there (speed ~0) accrues at 12%
      // so overnight yards read as mounds, not towers. Unknown speed keeps
      // full weight (old rows without speed).
      const presence = a.mph == null ? 1 : a.mph > 0.5 ? 1 : 0.12
      // meters-ish planar coords → pointy-top axial hex → cube-round
      const x = a.lng * cosLat * M_PER_DEG
      const y = a.lat * M_PER_DEG
      const qf = ((SQRT3 / 3) * x - y / 3) / cellMeters
      const rf = ((2 / 3) * y) / cellMeters
      // cube rounding
      let q = Math.round(qf)
      let r = Math.round(rf)
      const s = Math.round(-qf - rf)
      const dq = Math.abs(q - qf)
      const dr = Math.abs(r - rf)
      const ds = Math.abs(s - (-qf - rf))
      if (dq > dr && dq > ds) q = -r - s
      else if (dr > ds) r = -q - s
      const key = `${q},${r}`
      const eff = dt * presence
      const usd = (eff / 3600) * rate
      const bin = bins.get(key)
      if (bin) { bin.sec += eff; bin.usd += usd; if (isSel) { bin.selSec += eff; bin.selUsd += usd } }
      else bins.set(key, { q, r, sec: eff, usd, selSec: isSel ? eff : 0, selUsd: isSel ? usd : 0 })
    }
  }

  if (bins.size === 0 || lat0 === null) return { type: 'FeatureCollection', features: [] }

  // Rounded terrain, not a hex farm (owner ask Jul 14; smoothed further
  // Aug 24): blur each cell's value across TWO neighbor rings so heights
  // roll like a surface instead of stepping, then draw overlapping
  // near-circular columns — adjacent cells merge into smooth masses.
  const RING1: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]
  const RING2: [number, number][] = [
    [2, 0], [-2, 0], [0, 2], [0, -2], [2, -2], [-2, 2],
    [2, -1], [-2, 1], [1, 1], [-1, -1], [1, -2], [-1, 2],
  ]
  // $ mode with no rates set anywhere falls back to hours — an empty map
  // reads as broken, and heights are the same story either way until rates
  // exist.
  let effUnits = units
  if (units === 'dollars') {
    let anyUsd = false
    for (const b of Array.from(bins.values())) if (b.usd > 0) { anyUsd = true; break }
    if (!anyUsd) effUnits = 'hours'
  }
  const valOf = (b: { sec: number; usd: number }) => (effUnits === 'dollars' ? b.usd : b.sec)
  const selValOf = (b: { selSec: number; selUsd: number }) => (effUnits === 'dollars' ? b.selUsd : b.selSec)
  const smoothed = new Map<string, { q: number; r: number; val: number; selVal: number; own: { sec: number; usd: number }; ownSel: { sec: number; usd: number } }>()
  for (const b of Array.from(bins.values())) {
    // The sel share smooths with the SAME weights as the total, so
    // selVal ≤ val holds cell-by-cell and the ghost share is val − selVal.
    let val = valOf(b)
    let selVal = selValOf(b)
    for (const [dq, dr] of RING1) {
      const n = bins.get(`${b.q + dq},${b.r + dr}`)
      if (n) { val += valOf(n) * 0.3; selVal += selValOf(n) * 0.3 }
    }
    for (const [dq, dr] of RING2) {
      const n = bins.get(`${b.q + dq},${b.r + dr}`)
      if (n) { val += valOf(n) * 0.1; selVal += selValOf(n) * 0.1 }
    }
    smoothed.set(`${b.q},${b.r}`, { q: b.q, r: b.r, val, selVal, own: { sec: b.sec, usd: b.usd }, ownSel: { sec: b.selSec, usd: b.selUsd } })
  }

  // Absolute reference (with adaptive headroom for very long windows): a
  // lone drive's cells sit near the floor — the "mole trail" — while a
  // worked site climbs toward full height as hours/$ accumulate.
  let maxVal = 0
  for (const b of Array.from(smoothed.values())) if (b.val > maxVal) maxVal = b.val
  const ref = Math.max(units === 'dollars' ? DOLLARS_REF : HOURS_REF_SEC, maxVal)

  // HILLS, not columns (Brian, Aug 25): each cell renders as a stack of
  // tapering disks — wide low skirt up to a narrow cap — so neighboring
  // stacks overlap into rounded terrain and a lone cell reads as a knoll.
  // Color rides each tier's height, so hills gradient cool→hot upward.
  const STACK: { rf: number; hf: number }[] = [
    { rf: 1.5, hf: 0.28 },
    { rf: 1.12, hf: 0.52 },
    { rf: 0.8, hf: 0.76 },
    { rf: 0.52, hf: 1.0 },
  ]
  const features: GeoJSON.Feature[] = []
  const pushStack = (b: { q: number; r: number }, val: number, own: { sec: number; usd: number }, dim: 0 | 1) => {
    if (val <= 0) return
    // cell center back to planar meters, then to lng/lat
    const cx = cellMeters * SQRT3 * (b.q + b.r / 2)
    const cy = cellMeters * 1.5 * b.r
    // LINEAR response: drive-through cells sit near the floor (the mole
    // trail); only real accumulated work climbs.
    const ratio = val / ref
    const peak = H_MIN + ratio * (H_MAX - H_MIN)
    for (const s of STACK) {
      const radius = cellMeters * s.rf * (0.7 + 0.35 * ratio)
      const ring: [number, number][] = []
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * Math.PI * 2
        const vx = cx + radius * Math.cos(ang)
        const vy = cy + radius * Math.sin(ang)
        ring.push([vx / (cosLat * M_PER_DEG), vy / M_PER_DEG])
      }
      ring.push(ring[0])
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          ratio: ratio * s.hf,
          h: peak * s.hf,
          dim,
          hours: Math.round((own.sec / 3600) * 10) / 10,
          dollars: Math.round(own.usd),
        },
      })
    }
  }
  for (const b of Array.from(smoothed.values())) {
    if (selId == null) {
      pushStack(b, b.val, b.own, 0)
    } else {
      // A cell both parties worked emits two co-located stacks — bright at
      // the selected asset's share, ghost at everyone else's — each honest
      // against the one shared reference. All-sel cells accumulate the
      // identical float sequence into both counters, so their ghost share
      // is exactly 0, not an epsilon knoll.
      pushStack(b, b.selVal, b.ownSel, 0)
      pushStack(b, b.val - b.selVal, { sec: b.own.sec - b.ownSel.sec, usd: b.own.usd - b.ownSel.usd }, 1)
    }
  }
  return { type: 'FeatureCollection', features }
}
