/**
 * Progress by drone flight (Plans & Takeoff phase 5; the plan doc's "drone
 * flights on the timeline") — pure.
 *
 * A flight's surface (DSM) is the existing ground ON THAT DAY: run the site's
 * takeoff design against it and the cut and fill left are what remains to
 * move. Two things make that honest:
 *   - the design's topsoil and demo deductions are dropped (the flight already
 *     shows the ground as it is — stripping it again would double-count);
 *   - a drone without survey control can sit metres off vertically, so the
 *     flight is levelled to the existing ground (lidar + the takeoff's datum
 *     offset) on a band just OUTSIDE the grading limits — ground the job has
 *     not touched. The median difference is the correction; the spread says
 *     how far to trust it (trees and stockpiles in the band widen it).
 */
import type { DirtDesign, DirtResults, GroundGrid } from './takeoff'
import type { Surface, GridSurface } from './surface'
import { toFrame, type Frame } from './tm'
import { pointInRing, type Poly } from './geom'

export interface DatumFit {
  /** Correction added to the flight, metres. */
  offsetM: number
  /** Half the spread of the middle half of the differences, metres. */
  spreadM: number
  samples: number
}

/** Fewer band samples than this and the flight is used as flown. */
export const MIN_SAMPLES = 200
/** A spread past this (ft) is called out: the band holds trees, piles or a moved edge. */
export const LOOSE_FT = 0.75

/** The flight's correction from (existing − flight) differences on untouched ground. */
export function datumFit(diffsM: ArrayLike<number>): DatumFit | null {
  const d = Array.from(diffsM).filter((v) => Number.isFinite(v))
  if (d.length < MIN_SAMPLES) return null
  d.sort((a, b) => a - b)
  const q = (p: number) => {
    const i = (d.length - 1) * p
    const lo = Math.floor(i), hi = Math.ceil(i)
    return d[lo] + (d[hi] - d[lo]) * (i - lo)
  }
  return { offsetM: q(0.5), spreadM: (q(0.75) - q(0.25)) / 2, samples: d.length }
}

/** The grading limits as frame rings, and a point-in-limits test. */
export function limitsOf(design: DirtDesign, frame: Frame): { rings: Poly[]; inside: (x: number, y: number) => boolean; box: { x0: number; y0: number; x1: number; y1: number } | null } {
  const rings: Poly[] = []
  for (const f of design.features) {
    if (f.kind !== 'boundary') continue
    const r: Poly = []
    for (const [lng, lat] of f.coords) if (Number.isFinite(lng) && Number.isFinite(lat)) r.push(...toFrame(frame, lng, lat))
    if (r.length >= 6) rings.push(r)
  }
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    box = box ? { x0: Math.min(box.x0, r[i]), y0: Math.min(box.y0, r[i + 1]), x1: Math.max(box.x1, r[i]), y1: Math.max(box.y1, r[i + 1]) } : { x0: r[i], y0: r[i + 1], x1: r[i], y1: r[i + 1] }
  }
  return { rings, box, inside: (x, y) => rings.some((r) => pointInRing(x, y, r)) }
}

/** The band this many metres outside the grading limits is where a flight is levelled. */
export const BAND_M = 30

/**
 * (existing − flight) on untouched ground: points on a grid in the box grown
 * by `bandM`, outside the limits, where both surfaces have ground. The
 * existing carries the takeoff's datum offset, so a levelled flight sits on
 * the plans' datum. At most `max` samples (the grid coarsens to fit).
 */
export function bandDiffs(o: {
  flight: Surface; existing: Surface; inside: (x: number, y: number) => boolean
  box: { x0: number; y0: number; x1: number; y1: number }; bandM?: number; existingOffsetM?: number; max?: number
}): number[] {
  const band = o.bandM ?? BAND_M, max = o.max ?? 20_000
  const x0 = o.box.x0 - band, y0 = o.box.y0 - band, x1 = o.box.x1 + band, y1 = o.box.y1 + band
  const outer = (x1 - x0) * (y1 - y0), inner = (o.box.x1 - o.box.x0) * (o.box.y1 - o.box.y0)
  const step = Math.max(0.5, Math.sqrt(Math.max(outer - inner, 1) / max))
  const out: number[] = []
  for (let y = y0 + step / 2; y < y1 && out.length < max; y += step) {
    for (let x = x0 + step / 2; x < x1 && out.length < max; x += step) {
      if (o.inside(x, y)) continue
      const e = o.existing.zAt(x, y), f = o.flight.zAt(x, y)
      if (Number.isFinite(e) && Number.isFinite(f)) out.push(e + (o.existingOffsetM ?? 0) - f)
    }
  }
  return out
}

/** A flight's grid (frame metres) as the ground the takeoff reads (UTM), raised or lowered by the levelling. */
export function flightGround(gs: GridSurface, frame: Frame, offsetM: number, source: string, resolutionM: number): GroundGrid {
  const z = new Float32Array(gs.z.length)
  for (let i = 0; i < z.length; i++) z[i] = Number.isFinite(gs.z[i]) ? gs.z[i] + offsetM : NaN
  return { zone: frame.zone, epsg: frame.epsg, x0: frame.e0 + gs.x0, y0: frame.n0 + gs.y0, dx: gs.dx, dy: gs.dy, nx: gs.nx, ny: gs.ny, z, source, resolutionM }
}

/** The design as it applies to a flight: no topsoil or demo deductions; the flight is the existing ground. */
export function progressDesign(design: DirtDesign): DirtDesign {
  return {
    ...design,
    features: design.features.filter((f) => f.kind !== 'topsoil' && f.kind !== 'demo'),
    existing: { source: 'lidar', offsetFt: 0 },
  }
}

export interface ProgressResults {
  v: 1
  flownOn: string
  /** Cut and fill still to move, CY. */
  cutLeftCy: number
  fillLeftCy: number
  /** What was left to cut and to fill at the start of the job — the same design against the ORIGINAL ground, measured the way a flight is (no topsoil or demo deductions), CY. */
  cutCy: number
  fillCy: number
  /** 0–100: how much of the design's cut + fill is done. */
  pctDone: number
  /** Share of the grading limits the flight covered, 0–100. */
  coveredPct: number
  datum: { mode: 'levelled' | 'as-flown'; offsetFt: number | null; spreadFt: number | null; samples: number }
  resolutionM: number
  warnings: string[]
}

const r0 = (v: number) => Math.round(v)
const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * The numbers for one flight. The yardstick is `start` — the same design run
 * against the ORIGINAL ground, measured exactly the way the flight is — so a
 * flight of untouched ground reads 0% and a finished site 100%. (Adding the
 * takeoff's topsoil strip to its cut read a 10 ft fill pad as 9% done before
 * anyone showed up — ship-check, Nov 8.) Without a start (no lidar for the
 * original ground) the takeoff's own cut + fill stand in, and the result says so.
 */
export function progressResults(o: {
  flownOn: string; left: Pick<DirtResults, 'cutCy' | 'fillCy' | 'coveredPct' | 'warnings'>
  start: Pick<DirtResults, 'cutCy' | 'fillCy'> | null
  original: Pick<DirtResults, 'cutCy' | 'fillCy'>
  fit: DatumFit | null; asFlown: boolean; resolutionM: number
}): ProgressResults {
  const base = o.start ?? o.original
  const cut0 = Math.max(0, base.cutCy), fill0 = Math.max(0, base.fillCy)
  const total = cut0 + fill0
  const left = Math.max(0, o.left.cutCy) + Math.max(0, o.left.fillCy)
  const pct = total > 0 ? Math.max(0, Math.min(100, 100 * (1 - left / total))) : 0
  const warnings: string[] = []
  if (!o.start) warnings.push('The start of the job couldn’t be measured the way the flight is (no lidar for the original ground here) — % done is against the takeoff’s own cut and fill.')
  const FT = 0.3048
  if (!o.asFlown && !o.fit) warnings.push('This flight couldn’t be levelled on the ground around the grading limits (too little untouched ground there, or no lidar to compare) — it is used as flown. A drone without survey control can sit feet off; check a known spot before trusting these numbers.')
  if (o.fit && o.fit.spreadM / FT > LOOSE_FT) warnings.push(`The ground around the limits disagreed with the flight by ±${(o.fit.spreadM / FT).toFixed(1)} ft (trees, piles or edges in the band) — the levelling is rough.`)
  if (o.left.coveredPct < 95) warnings.push(`The flight covers ${Math.round(o.left.coveredPct)}% of the grading limits — what is left is counted only where it flew.`)
  warnings.push(...o.left.warnings.filter((w) => !/lidar/i.test(w)))
  return {
    v: 1, flownOn: o.flownOn, cutLeftCy: r0(Math.max(0, o.left.cutCy)), fillLeftCy: r0(Math.max(0, o.left.fillCy)),
    cutCy: r0(cut0), fillCy: r0(fill0), pctDone: Math.round(pct * 10) / 10, coveredPct: Math.round(o.left.coveredPct * 10) / 10,
    datum: o.asFlown || !o.fit
      ? { mode: 'as-flown', offsetFt: null, spreadFt: null, samples: o.fit?.samples ?? 0 }
      : { mode: 'levelled', offsetFt: r2(o.fit.offsetM / FT), spreadFt: r2(o.fit.spreadM / FT), samples: o.fit.samples },
    resolutionM: Math.round(o.resolutionM * 100) / 100,
    warnings: warnings.slice(0, 8),
  }
}

/** Yards moved between consecutive flights (newest first in, same order out; the oldest has none). */
export function movedBetween(flights: { cutLeftCy: number; fillLeftCy: number }[]): (number | null)[] {
  return flights.map((f, i) => {
    const prev = flights[i + 1]
    if (!prev) return null
    return Math.max(0, prev.cutLeftCy - f.cutLeftCy) + Math.max(0, prev.fillLeftCy - f.fillLeftCy)
  })
}
