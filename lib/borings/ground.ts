/**
 * The site's borings against one takeoff run (Plans & Takeoff phase 4). The
 * editor's worker and the server's Save both call this, so the numbers on the
 * device are the numbers that get stored.
 */
import { FT, lookups, pointAt, type TakeoffContext } from '../dirt/takeoff'
import { toFrame } from '../dirt/tm'
import { checkAgainstGround, layers, rockCut, type Boring, type BoringCheck, type RockCut } from './layers'

/** A boring or test pit as the pages and the server hand it over. */
export interface BoringIn {
  id: string
  name: string
  kind: 'boring' | 'pit'
  lat: number
  lng: number
  groundFt: number | null
  depthFt: number
  topsoilIn: number | null
  fillFt: number | null
  pwrFt: number | null
  refusalFt: number | null
  waterFt: number | null
  water24hFt: number | null
  unsuitableFt: number | null
}

export interface GroundResults {
  v: 1
  borings: number
  pits: number
  /** Null when no boring sits near the grading limits. */
  rock: RockCut | null
  checks: BoringCheck[]
  /** Borings more than 1 km from the grading limits — left out (a typed coordinate gone wrong). */
  far: string[]
}

/** How far outside the grading limits' box a boring may sit and still count, metres. */
export const NEAR_M = 1000

/** The shallower of the two water readings (at drilling, after 24 hours). */
export function shallowerWater(a: number | null, b: number | null): number | null {
  const ok = (v: number | null): v is number => v !== null && Number.isFinite(v)
  return ok(a) && ok(b) ? Math.min(a, b) : ok(a) ? a : ok(b) ? b : null
}

export function groundResults(ctx: TakeoffContext, input: BoringIn[], maxCells = 150_000): GroundResults | null {
  if (!input.length || !ctx.boundary.length) return null
  const box = ctx.boundary.reduce((b, a) => ({ x0: Math.min(b.x0, a.box.x0), y0: Math.min(b.y0, a.box.y0), x1: Math.max(b.x1, a.box.x1), y1: Math.max(b.y1, a.box.y1) }), { ...ctx.boundary[0].box })
  const bs: Boring[] = []
  const far: string[] = []
  for (const b of input) {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || !Number.isFinite(b.depthFt) || b.depthFt <= 0) continue
    const [x, y] = toFrame(ctx.frame, b.lng, b.lat)
    const out = Math.hypot(Math.max(box.x0 - x, 0, x - box.x1), Math.max(box.y0 - y, 0, y - box.y1))
    if (out > NEAR_M) { far.push(b.name); continue }
    bs.push({
      id: b.id, name: b.name, kind: b.kind, x, y, groundFt: b.groundFt, depthFt: b.depthFt,
      topsoilIn: b.topsoilIn, fillFt: b.fillFt, pwrFt: b.pwrFt, refusalFt: b.refusalFt,
      waterFt: shallowerWater(b.waterFt, b.water24hFt), unsuitableFt: b.unsuitableFt,
    })
  }
  const counts = { borings: bs.filter((b) => b.kind === 'boring').length, pits: bs.filter((b) => b.kind === 'pit').length }
  if (!bs.length) return { v: 1, ...counts, rock: null, checks: [], far }
  const groundAt = (x: number, y: number) => {
    if (!ctx.eg) return null
    const z = ctx.eg.zAt(x, y)
    return Number.isFinite(z) ? z / FT : null
  }
  const L = layers(bs, groundAt)
  const look = lookups(ctx)
  const rock = rockCut((x, y) => {
    const p = pointAt(ctx, look, x, y)
    return { ...p, eg0: ctx.eg ? ctx.eg.zAt(x, y) : NaN }
  }, L, box, maxCells)
  return { v: 1, ...counts, rock, checks: checkAgainstGround(bs, groundAt), far }
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

/** The ground in plain words, worst first — the Results step and the bid memo read the same lines. */
export function groundWords(g: GroundResults, boundarySf: number): string[] {
  const out: string[] = []
  const r = g.rock
  const of = `${g.borings + g.pits} ${g.borings + g.pits === 1 ? 'log' : 'logs'}`
  if (!r) {
    if (g.far.length) out.push(`No boring sits within 1 km of the grading limits — ${g.far.slice(0, 4).join(', ')}${g.far.length > 4 ? '…' : ''} ${g.far.length === 1 ? 'is' : 'are'} too far to be this site's.`)
    return out
  }
  if (r.rockCy > 0) out.push(`Rock: ${n0(r.rockCy)} CY of the cut is below auger refusal — ram or blast, priced apart.`)
  if (r.pwrCy > 0) out.push(`Partially weathered rock: ${n0(r.pwrCy)} CY — rippable, slower digging than common.`)
  if (r.unexploredCy > 0) out.push(`Unexplored: ${n0(r.unexploredCy)} CY of the cut is deeper than the borings went without finding rock — not priced as common or as rock. Ask for deeper borings or carry an allowance.`)
  if (r.undercutCy > 0) out.push(`Undercut: ${n0(r.undercutCy)} CY of unsuitable soil stays under the work — dig it out and replace it.`)
  if (r.unsuitableInCutCy > 0) out.push(`${n0(r.unsuitableInCutCy)} CY of the cut is unsuitable soil — waste it, don't place it as fill.`)
  if (r.fillLeftCy > 0) out.push(`Existing fill: ${n0(r.fillLeftCy)} CY stays under the new work — check the geotech's undercut call.`)
  if (r.fillInCutCy > 0) out.push(`${n0(r.fillInCutCy)} CY of the cut is existing fill.`)
  if (r.belowWaterSf > 0) out.push(`Water: ${n0(r.belowWaterSf)} SF is graded below the water the borings found — plan for dewatering.`)
  const flagged = g.checks.filter((c) => c.flag)
  for (const c of flagged.slice(0, 4)) out.push(`${c.name}: its log puts the ground ${Math.abs(c.diffFt ?? 0).toFixed(1)} ft ${(c.diffFt ?? 0) > 0 ? 'above' : 'below'} the takeoff's existing — another datum, or the site changed since it was drilled.`)
  if (flagged.length > 4) out.push(`${flagged.length - 4} more logs disagree with the existing ground by over a foot.`)
  if (boundarySf > 0 && r.beyondSf > 0.25 * boundarySf) out.push(`${Math.round((100 * r.beyondSf) / boundarySf)}% of the grading limits is beyond the borings — the nearest log is carried there.`)
  if (g.far.length) out.push(`Left out ${g.far.length === 1 ? 'one log' : `${g.far.length} logs`} more than 1 km from the grading limits: ${g.far.slice(0, 4).join(', ')}${g.far.length > 4 ? '…' : ''}.`)
  if (!out.length) out.push(`The ${of} show no rock, PWR, unsuitable soil or water in the cut.`)
  return out
}
