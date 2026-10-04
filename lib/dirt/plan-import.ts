/**
 * What the plan reader found, as takeoff features — pure. Contours, spot
 * grades, the finished-floor pad and the limit of grading go from page space
 * to lng/lat through the sheet's placement, thinned to fit the design's caps
 * (a contour simplified to 0.15 ft never moves a yard), each marked with the
 * sheet it came from so reading that sheet again replaces them.
 *
 * Fitting the caps (./limits): pads and the grading limit go first — few,
 * and each one matters. Spot grades are promised up to half of what's left,
 * so a dense topo survey can't crowd the contours out and a sheet of contour
 * fragments can't crowd the spots out. Too many contours → the shortest go
 * (thinning can't fix a count); too many points → contours thin, then the
 * shortest go. Spots then fill what the contours left, spread evenly over
 * the sheet when there are too many. A contour longer than one feature may
 * hold is split where it would overflow — the pieces share their end points,
 * so nothing is lost. An elevation a design can't hold is left out.
 */
import { ringSelfCrosses } from './geom'
import { MAX_POINTS_PER_FEATURE, Z_MAX, Z_MIN } from './limits'
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
  /** Contours count once even when split across features. */
  counts: { egContours: number; fgContours: number; egSpots: number; fgSpots: number; pads: number; limits: number }
  /** Horizontal thinning used, feet. */
  tolFt: number
  /** Contours left out to fit the caps (shortest first). */
  dropped: number
  /** Spot grades left out to fit the caps (the rest spread evenly). */
  droppedSpots: number
  warnings: string[]
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const closeOpen = (p: number[]) => {
  const n = p.length
  return n >= 8 && Math.abs(p[0] - p[n - 2]) < 1e-9 && Math.abs(p[1] - p[n - 1]) < 1e-9 ? p.slice(0, -2) : p
}
const inRange = (z: number | null) => z !== null && Number.isFinite(z) && z >= Z_MIN && z <= Z_MAX
const s_ = (n: number) => (n === 1 ? '' : 's')

/** Features a line of `np` points becomes (consecutive pieces share an end point). */
export const piecesOf = (np: number) => (np <= MAX_POINTS_PER_FEATURE ? 1 : Math.ceil((np - 1) / (MAX_POINTS_PER_FEATURE - 1)))

function splitLine(p: number[]): number[][] {
  const np = p.length / 2
  if (np <= MAX_POINTS_PER_FEATURE) return [p]
  const out: number[][] = []
  for (let s = 0; s < np - 1; s += MAX_POINTS_PER_FEATURE - 1) out.push(p.slice(s * 2, Math.min(np, s + MAX_POINTS_PER_FEATURE) * 2))
  return out
}

/** A ring (pad outline, grading limit) thinned until one feature can hold it. */
function fitRing(ring: number[], tol: number): number[] {
  let r = closeOpen(simplify(ring, tol))
  for (let i = 0; r.length / 2 > MAX_POINTS_PER_FEATURE && i < 40; i++) { tol *= 2; r = closeOpen(simplify(ring, tol)) }
  return r
}

/** `k` of `items` spread over the sheet: Z-order, then evenly strided. */
function spreadEvenly<T extends { x: number; y: number }>(items: T[], k: number): T[] {
  if (k <= 0) return []
  if (k >= items.length) return items
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of items) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y) }
  const sx = 1023 / Math.max(1e-9, x1 - x0), sy = 1023 / Math.max(1e-9, y1 - y0)
  const code = (s: T) => {
    const x = Math.round((s.x - x0) * sx), y = Math.round((s.y - y0) * sy)
    let c = 0
    for (let b = 0; b < 10; b++) c |= (((x >> b) & 1) << (2 * b)) | (((y >> b) & 1) << (2 * b + 1))
    return c
  }
  const sorted = items.map(s => ({ s, c: code(s) })).sort((a, b) => a.c - b.c)
  const out: T[] = []
  for (let i = 0; i < k; i++) out.push(sorted[Math.floor(((i + 0.5) * sorted.length) / k)].s)
  return out
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
  let outOfRange = 0
  const keepZ = (z: number | null) => { if (inRange(z)) return true; outOfRange++; return false }
  const contours = read.contours.filter(c => c.z !== null && !picks.excluded.has(c.id) && (c.role === 'eg' ? picks.egContours : picks.fgContours) && keepZ(c.z))
  const spots = read.spots.filter(s => ((s.role === 'eg' && picks.egSpots) || (s.role === 'fg' && picks.fgSpots)) && keepZ(s.z))
  const pads = picks.pads.map(i => read.pads[i]).filter(p => p && p.outline && p.ring.length >= 6 && keepZ(p.ffe))
  const limits = picks.limits && read.limits && read.limits.length >= 6 ? read.limits : null
  if (outOfRange) warnings.push(`${outOfRange} elevation${s_(outOfRange)} outside ${Z_MIN.toLocaleString()} to ${Z_MAX.toLocaleString()} ft left out — check that sheet's labels.`)

  const F = Math.max(0, Math.floor(budget.features)), P = Math.max(0, Math.floor(budget.points))
  let usedN = 0, usedP = 0
  const fits = (np: number) => usedN + 1 <= F && usedP + np <= P

  // Pads and the grading limit first.
  const areas: DirtFeature[] = []
  for (const p of pads) {
    const ring = fitRing(p.ring, 0.1 * map.ptPerFt)
    if (ring.length < 6 || ringSelfCrosses(ring)) { warnings.push(`The outline around "${p.text}" crosses itself — trace that pad by hand.`); continue }
    if (!fits(ring.length / 2)) { warnings.push(`No room left in this takeoff for the pad "${p.text}" — trace it by hand.`); continue }
    areas.push({ id: newId('p'), kind: 'platform', label: `Building (FF ${p.ffe.toFixed(2)})`, z: p.ffe, offsetIn: picks.padOffsetIn ?? -8, coords: ll(ring), src })
    usedN++; usedP += ring.length / 2
  }
  if (limits) {
    const ring = fitRing(limits, 0.25 * map.ptPerFt)
    if (ring.length < 6 || ringSelfCrosses(ring)) warnings.push('The limit of grading crosses itself — draw the grading limits by hand.')
    else if (!fits(ring.length / 2)) warnings.push('No room left in this takeoff for the limit of grading — draw it by hand.')
    else { areas.push({ id: newId('b'), kind: 'boundary', coords: ll(ring), src }); usedN++; usedP += ring.length / 2 }
  }

  // Contours, within what's left after half of it is promised to the spots.
  const reserve = Math.min(spots.length, Math.floor(Math.max(0, Math.min(F - usedN, P - usedP)) / 2))
  const capN = F - usedN - reserve, capP = P - usedP - reserve
  const order = contours.map(c => ({ c, len: lenOf(c.pts) })).sort((a, b) => b.len - a.len)
  let tolFt = 0.15
  const thin = () => order.map(k => simplify(k.c.pts, tolFt * map.ptPerFt))
  let lines = thin()
  const keep = order.map(() => true)
  let nf = 0
  order.forEach((_, j) => { const b = piecesOf(lines[j].length / 2); if (nf + b <= capN) nf += b; else keep[j] = false })
  const ptsKept = () => lines.reduce((n, l, j) => (keep[j] ? n + l.length / 2 : n), 0)
  for (let pass = 0; pass < 5 && ptsKept() > capP; pass++) { tolFt *= 2; lines = thin() }
  if (ptsKept() > capP) {
    let np = 0
    order.forEach((_, j) => { if (!keep[j]) return; const a = lines[j].length / 2; if (np + a <= capP) np += a; else keep[j] = false })
  }
  const dropped = keep.filter(k => !k).length
  if (tolFt > 0.15) warnings.push(`Contours thinned to ${tolFt.toFixed(2)} ft to fit the takeoff's size limit.`)
  if (dropped) warnings.push(`${dropped} short contour${s_(dropped)} left out to fit the takeoff's size limit.`)
  const lineFeats: DirtFeature[] = []
  let egC = 0, fgC = 0
  order.forEach((k, j) => {
    if (!keep[j]) return
    const eg = k.c.role === 'eg'
    let any = false
    for (const piece of splitLine(lines[j])) {
      if (piece.length < 4) continue
      lineFeats.push({ id: newId(eg ? 'e' : 'c'), kind: eg ? 'eg_contour' : 'fg_contour', z: k.c.z as number, coords: ll(piece), src })
      usedN++; usedP += piece.length / 2
      any = true
    }
    if (any) { if (eg) egC++; else fgC++ }
  })

  // Spot grades fill what the contours left.
  const room = Math.max(0, Math.min(F - usedN, P - usedP))
  const keptSpots = spreadEvenly(spots, room)
  const droppedSpots = spots.length - keptSpots.length
  if (droppedSpots) warnings.push(`${droppedSpots} of ${spots.length} spot grades left out to fit the takeoff's size limit — the ${keptSpots.length} kept are spread evenly over the sheet.`)
  const points: DirtFeature[] = keptSpots.map((s): DirtFeature => ({ id: newId('s'), kind: s.role === 'eg' ? 'eg_spot' : 'fg_spot', z: s.z, coords: ll([s.x, s.y]), src }))

  const features = [...areas, ...lineFeats, ...points]
  const count = (k: DirtFeature['kind']) => features.filter(f => f.kind === k).length
  return {
    features,
    counts: { egContours: egC, fgContours: fgC, egSpots: count('eg_spot'), fgSpots: count('fg_spot'), pads: count('platform'), limits: count('boundary') },
    tolFt,
    dropped,
    droppedSpots,
    warnings,
  }
}

function lenOf(p: number[]): number {
  let s = 0
  for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
  return s
}
