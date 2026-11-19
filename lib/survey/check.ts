/**
 * A drone surface checked against rover shots — pure. For every shot, the
 * drone's elevation under it minus the rover's: the BIAS (the median
 * difference — a datum shift the whole flight carries, fixed by one number)
 * and the SPREAD around it (what no datum fix removes). The verdict is the
 * spread, after the bias is taken out, against the tolerances the work needs:
 *
 *   stone ready for asphalt   ±½"  (0.042 ft)
 *   tying to a gutter lip     ±¼"  (0.021 ft)
 *   subgrade / mass grading   ±1"  (0.083 ft)
 *
 * Shots under trees, a parked truck or a stockpile show as outliers — they
 * are listed, not hidden, and they don't move the verdict (95th percentile).
 */
import { KIND_WORDS, type Shot, type ShotKind } from './shots'

export interface ShotResult { id: string; lng: number; lat: number; z: number; code: string; kind: ShotKind; droneZ: number | null; dz: number | null }
export interface Stats { n: number; bias: number; rmse: number; p95: number; maxAbs: number; within: { quarter: number; half: number; inch: number } }
export interface CheckResults {
  v: 1
  shots: ShotResult[]
  missing: number
  all: Stats | null
  byKind: Partial<Record<ShotKind, Stats>>
  verdict: { level: 'curb' | 'stone' | 'subgrade' | 'no'; words: string }
  computedAt: string
}

export const TOL = { quarter: 0.25 / 12, half: 0.5 / 12, inch: 1 / 12 }

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r4 = (v: number) => Math.round(v * 10000) / 10000

/** Stats of differences after removing the bias (median). */
export function stats(dz: number[]): Stats | null {
  if (!dz.length) return null
  const bias = median(dz)
  const res = dz.map((d) => d - bias)
  const abs = res.map(Math.abs).sort((a, b) => a - b)
  const rmse = Math.sqrt(res.reduce((t, r) => t + r * r, 0) / res.length)
  const p95 = abs[Math.min(abs.length - 1, Math.floor(0.95 * (abs.length - 1) + 0.5))]
  const share = (t: number) => Math.round((abs.filter((x) => x <= t).length / abs.length) * 1000) / 10
  return { n: dz.length, bias: r4(bias), rmse: r4(rmse), p95: r4(p95), maxAbs: r4(abs[abs.length - 1]), within: { quarter: share(TOL.quarter), half: share(TOL.half), inch: share(TOL.inch) } }
}

export const inches = (ft: number) => `${(Math.round(ft * 12 * 100) / 100).toFixed(2)}"`

export function checkShots(shots: Shot[], droneZ: (lng: number, lat: number) => number | null, now: Date): CheckResults {
  const out: ShotResult[] = []
  let missing = 0
  for (const s of shots) {
    const d = droneZ(s.lng, s.lat)
    const ok = d !== null && Number.isFinite(d)
    if (!ok) missing++
    out.push({ ...s, droneZ: ok ? r4(d as number) : null, dz: ok ? r4((d as number) - s.z) : null })
  }
  const have = out.filter((s) => s.dz !== null)
  const all = stats(have.map((s) => s.dz as number))
  const byKind: CheckResults['byKind'] = {}
  for (const k of Object.keys(KIND_WORDS) as ShotKind[]) {
    const st = stats(have.filter((s) => s.kind === k).map((s) => s.dz as number))
    if (st) byKind[k] = st
  }
  return { v: 1, shots: out, missing, all, byKind, verdict: verdictOf(all, byKind), computedAt: now.toISOString() }
}

export function verdictOf(all: Stats | null, byKind: CheckResults['byKind']): CheckResults['verdict'] {
  if (!all || all.n < 8) return { level: 'no', words: 'Not enough shots under the flight to judge it — shoot at least 8 (20+ is better), spread across the site.' }
  // the curb tie is judged on curb / lip shots when there are enough of them
  const curb = [byKind.lip, byKind.flowline, byKind.curb_top].filter(Boolean) as Stats[]
  const curbP95 = curb.length ? Math.max(...curb.filter((s) => s.n >= 5).map((s) => s.p95), 0) : null
  const bias = Math.abs(all.bias) > TOL.half ? ` The flight sits ${inches(Math.abs(all.bias))} ${all.bias > 0 ? 'high' : 'low'} overall — one datum correction fixes that; the verdict is after it.` : ''
  if (curbP95 !== null && curbP95 > 0 && curbP95 <= TOL.quarter && all.p95 <= TOL.half)
    return { level: 'curb', words: `Good enough to tie to the curb: 95% of curb shots within ${inches(curbP95)}.${bias}` }
  if (all.p95 <= TOL.half) return { level: 'stone', words: `Good enough to set stone to (±½"): 95% of shots within ${inches(all.p95)}. Use rover shots for the curb tie itself.${bias}` }
  if (all.p95 <= TOL.inch) return { level: 'subgrade', words: `Good for subgrade and volumes (±1"), not for stone: 95% within ${inches(all.p95)}. Fly lower or add ground control.${bias}` }
  return { level: 'no', words: `Not accurate enough for grade work: 95% within ${inches(all.p95)}. Check the ground control, the flight height and whether shots fell under trees or equipment.${bias}` }
}

/** Map colour for a shot's difference after the bias: within ¼" teal, ½" green, 1" amber, beyond red. */
export function dzColor(dz: number | null, bias: number): string {
  if (dz === null) return '#64748b'
  const a = Math.abs(dz - bias)
  return a <= TOL.quarter ? '#2dd4bf' : a <= TOL.half ? '#22c55e' : a <= TOL.inch ? '#f59e0b' : '#ef4444'
}
