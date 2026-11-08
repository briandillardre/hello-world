/**
 * The ground under the site, from its borings and test pits (Plans &
 * Takeoff phase 4) — pure.
 *
 * What a boring says spreads across the site by the plan doc's rules:
 *   - inside the borings every value passes through each boring exactly
 *     (inverse-distance weighting); outside them the nearest boring's value
 *     holds, and the place is counted "beyond the borings";
 *   - thicknesses (topsoil, existing fill, unsuitable soil — each a depth
 *     below the ground) spread as depths; the PWR, rock and water lines
 *     spread by ELEVATION, because the ground rises and falls between borings;
 *   - a boring that stopped without hitting rock says "soil down to my
 *     bottom", never "no rock": the cut below its bottom is UNEXPLORED —
 *     counted apart, never priced as common or as rock. Each kind of evidence
 *     (hit refusal · found PWR only · found neither) carries its own lines and
 *     its share of the weight at a point, so one refusal among clean borings
 *     that went deeper stays rock near it and never smears across the site;
 *   - every point carries its distance to the nearest boring, and every
 *     boring's logged ground is checked against the takeoff's existing ground.
 * Units: feet and inches in, feet / CY / SF out; positions in the dirt
 * engine's frame metres (lib/dirt/tm.ts toFrame) so the rock cut samples the
 * same surfaces the takeoff integrates.
 */

export interface Boring {
  id: string
  name: string
  kind: 'boring' | 'pit'
  /** Frame metres. */
  x: number
  y: number
  /** Ground elevation printed on the log (ft), when it has one. */
  groundFt: number | null
  /** How deep it went (ft). */
  depthFt: number
  /** Topsoil (in); null = the log doesn't say. */
  topsoilIn: number | null
  /** Existing fill down to this depth (ft); null = none noted. */
  fillFt: number | null
  /** Depth to partially weathered rock (ft); null = none above its bottom. */
  pwrFt: number | null
  /** Depth to auger refusal — rock (ft); null = none above its bottom. */
  refusalFt: number | null
  /** Depth to water (ft) — the shallower reading; null = none found. */
  waterFt: number | null
  /** Unsuitable soil down to this depth (ft); null = none called out. */
  unsuitableFt: number | null
}

export const FT = 0.3048
const M3_PER_CY = 0.764554857984
const r1 = (v: number) => Math.round(v * 10) / 10
const r0 = (v: number) => Math.round(v)

interface Pt { x: number; y: number }

/** Inverse-distance weighting (power 2); exact at a data point. */
export function idw(pts: { x: number; y: number; v: number }[], x: number, y: number): number | null {
  if (!pts.length) return null
  let num = 0, den = 0
  for (const p of pts) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d2 < 1e-6) return p.v
    const w = 1 / d2
    num += w * p.v; den += w
  }
  return num / den
}

/** Convex hull (Andrew's monotone chain), CCW. */
export function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lo: Pt[] = [], up: Pt[] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** Inside (or on) a convex CCW polygon; with fewer than 3 corners nothing is inside. */
export function inHull(h: Pt[], x: number, y: number, tol = 0.01): boolean {
  if (h.length < 3) return false
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length]
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < -tol) return false
  }
  return true
}

export function nearest(bs: Boring[], x: number, y: number): { b: Boring; d: number } | null {
  let best: { b: Boring; d: number } | null = null
  for (const b of bs) {
    const d = Math.hypot(b.x - x, b.y - y)
    if (!best || d < best.d) best = { b, d }
  }
  return best
}

/** The takeoff's existing ground (ft) at a frame point, or null where it has none. */
export type GroundAt = (x: number, y: number) => number | null

/**
 * What the borings say at a point, by the kind of evidence, each with its own
 * lines spread by elevation among the borings of that kind and the share
 * (0–1) of the weight they carry here:
 *   hit  — found refusal: PWR from `pwr` down to `rock`, rock below;
 *   pwr  — found PWR, no refusal: PWR from `pwr` down to its `bottom`, unknown below;
 *   clean — found neither: soil to its `bottom`, unknown below.
 */
export interface Column {
  hit: { share: number; pwr: number; rock: number } | null
  pwr: { share: number; pwr: number; bottom: number } | null
  clean: { share: number; bottom: number } | null
  /** Water where it was found, and how much of the evidence found it. */
  water: { share: number; z: number } | null
}

/** Everything the borings say at one point, from one pass over them. */
export interface Sample {
  topsoilIn: number | null
  fillFt: number
  unsuitableFt: number
  column: Column | null
  conf: { ft: number; inside: boolean }
}

export interface Layers {
  hull: Pt[]
  /** All of it at a point (null with no borings) — what the rock cut reads per cell. */
  sample(x: number, y: number): Sample | null
  /** A depth below the ground at a point: topsoil in inches, fill / unsuitable in feet. Topsoil is null where no log says. */
  depth(k: 'topsoilIn' | 'fillFt' | 'unsuitableFt', x: number, y: number): number | null
  /** The column at a point; null when no boring has an elevation. */
  column(x: number, y: number): Column | null
  /** Feet to the nearest boring, and whether the point lies inside them. */
  conf(x: number, y: number): { ft: number; inside: boolean } | null
}

interface Placed {
  cls: 'hit' | 'pwr' | 'clean'
  pwr: number
  rock: number
  bottom: number
  water: number | null
}

/**
 * The site's layers from its borings (elevations from the logs, else
 * `groundAt`). Weights: inverse-distance inside the borings; beyond them (or
 * with one boring, or on one) the nearest boring of each kind of reading
 * alone.
 */
export function layers(bs: Boring[], groundAt: GroundAt): Layers {
  const h = hull(bs)
  const fin = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null)
  const n = bs.length
  const xs = new Float64Array(n), ys = new Float64Array(n)
  // A log silent on topsoil says nothing; silent on fill or unsuitable soil, it found none.
  const top: (number | null)[] = [], fill: number[] = [], unsuit: number[] = []
  const placed: (Placed | null)[] = []
  for (let i = 0; i < n; i++) {
    const b = bs[i]
    xs[i] = b.x; ys[i] = b.y
    top.push(fin(b.topsoilIn))
    fill.push(Math.max(0, fin(b.fillFt) ?? 0))
    unsuit.push(Math.max(0, fin(b.unsuitableFt) ?? 0))
    const g = b.groundFt ?? groundAt(b.x, b.y)
    if (g === null || !Number.isFinite(g)) { placed.push(null); continue }
    const bottom = g - b.depthFt
    const refusal = fin(b.refusalFt)
    const rock = refusal !== null ? g - refusal : null
    // PWR sits above rock: a PWR reading below refusal is read as none.
    const pwrD = fin(b.pwrFt)
    const pwr = pwrD !== null && (rock === null || g - pwrD >= rock) ? g - pwrD : null
    const water = fin(b.waterFt)
    placed.push({
      bottom, water: water !== null ? g - water : null,
      cls: rock !== null ? 'hit' : pwr !== null ? 'pwr' : 'clean',
      rock: rock ?? bottom, pwr: pwr ?? rock ?? bottom,
    })
  }
  const anyTop = top.some((v) => v !== null)
  const placedCount = placed.reduce((c, p) => c + (p ? 1 : 0), 0)
  const d2 = new Float64Array(n)
  const sample = (x: number, y: number): Sample | null => {
    if (!n) return null
    // Nearest overall, nearest with a topsoil reading, nearest with an elevation.
    let nAll = -1, nTop = -1, nPl = -1
    for (let i = 0; i < n; i++) {
      const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2
      d2[i] = d
      if (nAll < 0 || d < d2[nAll]) nAll = i
      if (top[i] !== null && (nTop < 0 || d < d2[nTop])) nTop = i
      if (placed[i] && (nPl < 0 || d < d2[nPl])) nPl = i
    }
    const inside = inHull(h, x, y)
    const idw = inside && n > 1 && d2[nAll] >= 1e-6
    const w = (i: number) => 1 / d2[i]
    // Depths.
    let topsoilIn: number | null = null, fillFt = 0, unsuitableFt = 0
    if (!idw) {
      fillFt = fill[nAll]; unsuitableFt = unsuit[nAll]
      topsoilIn = nTop >= 0 ? top[nTop] : null
    } else {
      let fn = 0, un = 0, den = 0, tn = 0, tden = 0
      for (let i = 0; i < n; i++) {
        const wi = w(i)
        fn += wi * fill[i]; un += wi * unsuit[i]; den += wi
        const t = top[i]
        if (t !== null) { tn += wi * t; tden += wi }
      }
      fillFt = fn / den; unsuitableFt = un / den
      topsoilIn = anyTop && tden > 0 ? tn / tden : null
    }
    // The column, by kind of evidence.
    let column: Column | null = null
    if (placedCount) {
      const acc = { hit: [0, 0, 0], pwr: [0, 0, 0], clean: [0, 0, 0], water: [0, 0] }
      let den = 0
      const add = (p: Placed, wi: number) => {
        den += wi
        const a = acc[p.cls]
        a[0] += wi
        if (p.cls === 'hit') { a[1] += wi * p.pwr; a[2] += wi * p.rock }
        else if (p.cls === 'pwr') { a[1] += wi * p.pwr; a[2] += wi * p.bottom }
        else a[2] += wi * p.bottom
        if (p.water !== null) { acc.water[0] += wi; acc.water[1] += wi * p.water }
      }
      // On a boring, or beyond them: the nearest one with an elevation alone.
      if (!idw || placedCount === 1 || d2[nPl] < 1e-6) add(placed[nPl]!, 1)
      else for (let i = 0; i < n; i++) { const p = placed[i]; if (p) add(p, w(i)) }
      column = {
        hit: acc.hit[0] > 0 ? { share: acc.hit[0] / den, pwr: acc.hit[1] / acc.hit[0], rock: acc.hit[2] / acc.hit[0] } : null,
        pwr: acc.pwr[0] > 0 ? { share: acc.pwr[0] / den, pwr: acc.pwr[1] / acc.pwr[0], bottom: acc.pwr[2] / acc.pwr[0] } : null,
        clean: acc.clean[0] > 0 ? { share: acc.clean[0] / den, bottom: acc.clean[2] / acc.clean[0] } : null,
        water: acc.water[0] > 0 ? { share: acc.water[0] / den, z: acc.water[1] / acc.water[0] } : null,
      }
    }
    return { topsoilIn, fillFt, unsuitableFt, column, conf: { ft: Math.sqrt(d2[nAll]) / FT, inside } }
  }
  return {
    hull: h,
    sample,
    depth: (k, x, y) => { const s = sample(x, y); return s ? s[k] : null },
    column: (x, y) => sample(x, y)?.column ?? null,
    conf: (x, y) => sample(x, y)?.conf ?? null,
  }
}

export interface RockCut {
  /** Cut below the PWR line and above the rock line, where the borings found it (rippable). */
  pwrCy: number
  /** Cut below the rock (auger refusal) line, where the borings found it — ram or blast. */
  rockCy: number
  /** Cut below where the borings stopped without finding rock: unknown ground. */
  unexploredCy: number
  /** Unsuitable soil left under the subgrade — to dig out and replace. */
  undercutCy: number
  /** Unsuitable soil the cut digs anyway — waste it, don't place it as fill. */
  unsuitableInCutCy: number
  /** Existing fill the cut digs. */
  fillInCutCy: number
  /** Existing fill left under the subgrade. */
  fillLeftCy: number
  /** Area graded below the water line, SF. */
  belowWaterSf: number
  /** Area of the grading limits beyond the borings, SF. */
  beyondSf: number
  /** Topsoil the borings average over the grading limits (in); null when no log says. */
  topsoilIn: number | null
  /** The cut this was sampled from (to check against the takeoff's own cut). */
  sampledCutCy: number
  cellFt: number
}

/** What the takeoff sees at a frame point — elevations in METRES: the existing as dug (after demo and topsoil), the subgrade, and the raw existing. */
export type SampleAt = (x: number, y: number) => { inside: boolean; eg: number; sg: number; eg0: number }

const span = (top: number, bottom: number) => Math.max(0, top - bottom)

/**
 * The ground in the cut: sample the takeoff's surfaces on a grid (frame
 * metres) and measure what lies below each line, share by share.
 */
export function rockCut(at: SampleAt, L: Layers, box: { x0: number; y0: number; x1: number; y1: number }, maxCells = 150_000): RockCut {
  const w = box.x1 - box.x0, hgt = box.y1 - box.y0
  const cell = Math.max(0.5, Math.sqrt(Math.max(w * hgt, 1e-6) / maxCells))
  const cyOf = (ft: number) => (ft * FT * cell * cell) / M3_PER_CY
  const sfCell = (cell * cell) / (FT * FT)
  const o = { pwr: 0, rock: 0, unex: 0, under: 0, unsuitCut: 0, fillCut: 0, fillLeft: 0, water: 0, beyond: 0, cut: 0, topSum: 0, topN: 0 }
  for (let y = box.y0 + cell / 2; y < box.y1; y += cell) {
    for (let x = box.x0 + cell / 2; x < box.x1; x += cell) {
      const p = at(x, y)
      if (!p.inside || !Number.isFinite(p.eg) || !Number.isFinite(p.sg)) continue
      const eg = p.eg / FT, sg = p.sg / FT
      const g0 = Number.isFinite(p.eg0) ? p.eg0 / FT : eg
      const smp = L.sample(x, y)
      if (!smp) continue
      if (!smp.conf.inside) o.beyond += sfCell
      if (smp.topsoilIn !== null) { o.topSum += smp.topsoilIn; o.topN++ }
      // The soils given as depths below the ground: what the cut digs, and what the work leaves under it.
      const low = Math.min(sg, eg) // the bottom of the dig, or the old ground under a fill
      if (smp.unsuitableFt > 0) {
        const base = g0 - smp.unsuitableFt
        o.under += cyOf(span(low, base))
        o.unsuitCut += cyOf(span(eg, Math.max(sg, base)))
      }
      if (smp.fillFt > 0) {
        const base = g0 - smp.fillFt
        o.fillLeft += cyOf(span(low, base))
        o.fillCut += cyOf(span(eg, Math.max(sg, base)))
      }
      const col = smp.column
      if (col?.water && sg < col.water.z) o.water += sfCell * col.water.share
      if (sg >= eg) continue
      o.cut += cyOf(eg - sg)
      if (!col) continue
      if (col.hit) {
        o.pwr += cyOf(col.hit.share * span(Math.min(eg, col.hit.pwr), Math.max(sg, col.hit.rock)))
        o.rock += cyOf(col.hit.share * span(Math.min(eg, col.hit.rock), sg))
      }
      if (col.pwr) {
        o.pwr += cyOf(col.pwr.share * span(Math.min(eg, col.pwr.pwr), Math.max(sg, col.pwr.bottom)))
        o.unex += cyOf(col.pwr.share * span(Math.min(eg, col.pwr.bottom), sg))
      }
      if (col.clean) o.unex += cyOf(col.clean.share * span(Math.min(eg, col.clean.bottom), sg))
    }
  }
  return {
    pwrCy: r0(o.pwr), rockCy: r0(o.rock), unexploredCy: r0(o.unex), undercutCy: r0(o.under), unsuitableInCutCy: r0(o.unsuitCut),
    fillInCutCy: r0(o.fillCut), fillLeftCy: r0(o.fillLeft), belowWaterSf: r0(o.water), beyondSf: r0(o.beyond),
    topsoilIn: o.topN ? r1(o.topSum / o.topN) : null, sampledCutCy: r0(o.cut), cellFt: r1(cell / FT),
  }
}

export interface BoringCheck { id: string; name: string; logFt: number | null; groundFt: number | null; diffFt: number | null; flag: boolean }

/** Each boring's logged ground against the takeoff's existing: more than a foot apart is flagged (the site changed, or another datum). */
export function checkAgainstGround(bs: Boring[], groundAt: GroundAt, tolFt = 1): BoringCheck[] {
  return bs.map((b) => {
    const l = groundAt(b.x, b.y)
    const diff = b.groundFt !== null && l !== null ? b.groundFt - l : null
    return { id: b.id, name: b.name, logFt: b.groundFt, groundFt: l === null ? null : r1(l), diffFt: diff === null ? null : r1(diff), flag: diff !== null && Math.abs(diff) > tolFt }
  })
}
