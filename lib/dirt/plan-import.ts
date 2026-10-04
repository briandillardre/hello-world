/**
 * What the plan reader found, as takeoff features — pure. Contours, spot
 * grades, the finished-floor pad and the limit of grading go from page space
 * to lng/lat through the sheet's placement, thinned to fit the design's caps
 * (a contour simplified to 0.15 ft never moves a yard), each marked with the
 * sheet it came from so reading that sheet again replaces them.
 */
import { ringSelfCrosses } from './geom'
import { simplify, type PlanRead } from './plan-read'
import type { SheetMap } from './plan-geo'
import type { DirtFeature } from './takeoff'

export interface ImportPicks {
  egContours: boolean
  fgContours: boolean
  egSpots: boolean
  fgSpots: boolean
  /** Indexes into read.pads. */
  pads: number[]
  limits: boolean
  /** Contour ids the estimator set aside. */
  excluded: ReadonlySet<number>
  /** Platform subgrade below finished floor, inches (DCG's default −8). */
  padOffsetIn?: number
}

export interface ImportBudget { features: number; points: number }

export interface ImportResult {
  features: DirtFeature[]
  counts: { egContours: number; fgContours: number; egSpots: number; fgSpots: number; pads: number; limits: number }
  /** Horizontal thinning used, feet. */
  tolFt: number
  /** Contours left out to fit the caps (shortest first). */
  dropped: number
  warnings: string[]
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const closeOpen = (p: number[]) => {
  const n = p.length
  return n >= 8 && Math.abs(p[0] - p[n - 2]) < 1e-9 && Math.abs(p[1] - p[n - 1]) < 1e-9 ? p.slice(0, -2) : p
}

export function readToFeatures(
  read: PlanRead,
  map: SheetMap,
  picks: ImportPicks,
  budget: ImportBudget,
  src: string,
  newId: (prefix?: string) => string,
): ImportResult {
  const warnings: string[] = []
  const ll = (p: number[]): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < p.length; i += 2) {
      const [lng, lat] = map.toLngLat(p[i], p[i + 1])
      out.push([round(lng, 8), round(lat, 8)])
    }
    return out
  }
  const contours = read.contours.filter(c => c.z !== null && !picks.excluded.has(c.id) && (c.role === 'eg' ? picks.egContours : picks.fgContours))
  const spots = read.spots.filter(s => (s.role === 'eg' && picks.egSpots) || (s.role === 'fg' && picks.fgSpots))
  const pads = picks.pads.map(i => read.pads[i]).filter(p => p && p.outline && p.ring.length >= 6)
  const limits = picks.limits && read.limits && read.limits.length >= 6 ? read.limits : null

  const areas: DirtFeature[] = []
  for (const p of pads) {
    const ring = closeOpen(simplify(p.ring, 0.1 * map.ptPerFt))
    if (ring.length < 6 || ringSelfCrosses(ring)) { warnings.push(`The outline around "${p.text}" crosses itself — trace that pad by hand.`); continue }
    areas.push({ id: newId('p'), kind: 'platform', label: `Building (FF ${p.ffe.toFixed(2)})`, z: p.ffe, offsetIn: picks.padOffsetIn ?? -8, coords: ll(ring), src })
  }
  if (limits) {
    const ring = closeOpen(simplify(limits, 0.25 * map.ptPerFt))
    if (ring.length >= 6 && !ringSelfCrosses(ring)) areas.push({ id: newId('b'), kind: 'boundary', coords: ll(ring), src })
    else warnings.push('The limit of grading crosses itself — draw the grading limits by hand.')
  }
  const points: DirtFeature[] = spots.map((s): DirtFeature => ({ id: newId('s'), kind: s.role === 'eg' ? 'eg_spot' : 'fg_spot', z: s.z, coords: ll([s.x, s.y]), src }))

  // Contours: thin until they fit what's left of the design's caps.
  const fixedPts = areas.reduce((n, f) => n + f.coords.length, 0) + points.length
  const fixedN = areas.length + points.length
  let tolFt = 0.15
  let lines: number[][] = []
  const order = contours.map((c, i) => ({ c, i, len: lenOf(c.pts) })).sort((a, b) => b.len - a.len)
  let kept = order
  for (let round_ = 0; round_ < 6; round_++) {
    lines = kept.map(k => simplify(k.c.pts, tolFt * map.ptPerFt))
    const pts = lines.reduce((n, l) => n + l.length / 2, 0)
    if (pts + fixedPts <= budget.points && kept.length + fixedN <= budget.features) break
    if (round_ < 5) { tolFt *= 2; continue }
    // Still over: the shortest contours go.
    let n = fixedPts, m = fixedN
    const fit: typeof kept = []
    const fitLines: number[][] = []
    kept.forEach((k, j) => {
      const np = lines[j].length / 2
      if (n + np <= budget.points && m + 1 <= budget.features) { fit.push(k); fitLines.push(lines[j]); n += np; m++ }
    })
    kept = fit
    lines = fitLines
  }
  const dropped = order.length - kept.length
  if (tolFt > 0.15) warnings.push(`Contours thinned to ${tolFt.toFixed(2)} ft to fit the takeoff's size limit.`)
  if (dropped) warnings.push(`${dropped} short contour${dropped === 1 ? '' : 's'} left out to fit the takeoff's size limit.`)
  const lineFeats: DirtFeature[] = kept.map((k, j): DirtFeature => ({
    id: newId(k.c.role === 'eg' ? 'e' : 'c'),
    kind: k.c.role === 'eg' ? 'eg_contour' : 'fg_contour',
    z: k.c.z as number,
    coords: ll(lines[j]),
    src,
  })).filter(f => f.coords.length >= 2)

  const features = [...areas, ...lineFeats, ...points]
  const count = (k: DirtFeature['kind']) => features.filter(f => f.kind === k).length
  return {
    features,
    counts: { egContours: count('eg_contour'), fgContours: count('fg_contour'), egSpots: count('eg_spot'), fgSpots: count('fg_spot'), pads: count('platform'), limits: count('boundary') },
    tolFt,
    dropped,
    warnings,
  }
}

function lenOf(p: number[]): number {
  let s = 0
  for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
  return s
}
