/**
 * Measuring on a sheet — pure (migration 146).
 *
 * A mark lives on the PAPER as page fractions (u across, v down), so it reads
 * the same on the PDF and on its picture, and it measures at the sheet's own
 * scale: the engineer's drawing is the truth for quantities. One sheet's size
 * in ground feet turns fractions into feet; the scale comes from the scale
 * card (lib/plans/scale.ts) and stops measuring when its checks disagree,
 * unless somebody set the scale by hand.
 */

import { scaleVerdict, placementFeetPerInch, type ScaleCheck, type ScaleKey } from './scale'
import { metresPerUnit, type Corners4 } from './north'

export type Measure = 'length' | 'area' | 'perimeter' | 'count' | 'volume'
export type Unit = 'LF' | 'SF' | 'SY' | 'AC' | 'EA' | 'CY' | 'TON'
export type MarkKind = 'line' | 'area' | 'count'
type UV = [number, number]

export interface MarkGeom { pts: UV[]; holes?: UV[][] }
export interface SheetFeet { w: number; h: number }
export interface ItemLike { measure: Measure; unit: Unit; depth_in?: number | null; tons_per_cy?: number | null }

export const MEASURE_UNITS: Record<Measure, Unit[]> = {
  length: ['LF'],
  perimeter: ['LF'],
  area: ['SF', 'SY', 'AC'],
  count: ['EA'],
  volume: ['CY', 'TON'],
}

export const MEASURE_LABEL: Record<Measure, string> = {
  length: 'Length', area: 'Area', perimeter: 'Perimeter', count: 'Count', volume: 'Volume (area × depth)',
}

/** The shape a measure is drawn as. */
export function kindFor(m: Measure): MarkKind {
  return m === 'length' ? 'line' : m === 'count' ? 'count' : 'area'
}

/**
 * The scale to measure with, from the scale card's checks: a scale set by
 * hand wins; otherwise the checks must not disagree; then the middle of the
 * agreeing ones. `blocked` says why measuring stops.
 */
export function measureScale(checks: ScaleCheck[]): { feetPerInch: number | null; blocked: string | null } {
  const set = checks.find((c) => c.key === 'set')
  if (set && set.feetPerInch > 0) return { feetPerInch: set.feetPerInch, blocked: null }
  const cs = checks.filter((c) => c.feetPerInch > 0)
  if (!cs.length) return { feetPerInch: null, blocked: 'No scale on this sheet yet — set one on the scale card, or place the sheet on the map.' }
  const v = scaleVerdict(cs)
  if (v.tone === 'red') return { feetPerInch: null, blocked: `Scale checks disagree — ${v.words} Set the scale on the scale card to measure.` }
  const sorted = cs.map((c) => c.feetPerInch).sort((a, b) => a - b)
  return { feetPerInch: sorted[Math.floor((sorted.length - 1) / 2)], blocked: null }
}

/** The sheet in ground feet: paper size × scale when the paper is known,
 *  else the ground the placed picture covers. */
export function sheetFeet(pageW: number | null, pageH: number | null, feetPerInch: number | null,
  bounds?: [number, number][] | null): SheetFeet | null {
  if (pageW && pageH && feetPerInch) return { w: (pageW / 72) * feetPerInch, h: (pageH / 72) * feetPerInch }
  if (bounds && bounds.length === 4) {
    const [tl, tr, , bl] = bounds
    const lat = (tl[1] + bl[1]) / 2
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_574
    const d = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) / 0.3048
    return { w: d(tl, tr), h: d(tl, bl) }
  }
  return null
}

const ft = (p: UV, sf: SheetFeet): [number, number] => [p[0] * sf.w, p[1] * sf.h]

export function lengthFt(pts: UV[], sf: SheetFeet, closed = false): number {
  let t = 0
  for (let i = 1; i < pts.length; i++) {
    const a = ft(pts[i - 1], sf), b = ft(pts[i], sf)
    t += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  if (closed && pts.length > 2) {
    const a = ft(pts[pts.length - 1], sf), b = ft(pts[0], sf)
    t += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return t
}

function ringArea(pts: UV[], sf: SheetFeet): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = ft(pts[i], sf), b = ft(pts[(i + 1) % pts.length], sf)
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/** Square feet inside the outline, minus the cut-outs (islands in a lot). */
export function areaSf(g: MarkGeom, sf: SheetFeet): number {
  const outer = ringArea(g.pts, sf)
  const holes = (g.holes ?? []).reduce((t, h) => t + ringArea(h, sf), 0)
  return Math.max(0, outer - holes)
}

/** A mark's quantity in its item's unit. null when the item and the shape don't fit. */
export function markQty(item: ItemLike, kind: MarkKind, g: MarkGeom, sf: SheetFeet): number | null {
  if (kind !== kindFor(item.measure)) return null
  switch (item.measure) {
    case 'length': return round(lengthFt(g.pts, sf))
    case 'perimeter': return round(lengthFt(g.pts, sf, true))
    case 'count': return g.pts.length
    case 'area': {
      const sfA = areaSf(g, sf)
      return round(item.unit === 'SY' ? sfA / 9 : item.unit === 'AC' ? sfA / 43_560 : sfA, item.unit === 'AC' ? 3 : 1)
    }
    case 'volume': {
      if (!item.depth_in) return null
      const cy = (areaSf(g, sf) * item.depth_in) / 12 / 27
      if (item.unit === 'TON') return item.tons_per_cy ? round(cy * item.tons_per_cy) : null
      return round(cy)
    }
  }
  return null
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d

/** A drawn shape the database will take: page fractions (a little past the
 *  edge allowed), enough points for its kind, never more than 2,000. */
export function cleanGeom(x: unknown, kind: MarkKind): MarkGeom | null {
  if (!x || typeof x !== 'object') return null
  const okPt = (p: unknown): p is UV => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05)
  const r6 = (p: UV): UV => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]
  const { pts, holes } = x as { pts?: unknown; holes?: unknown }
  if (!Array.isArray(pts) || pts.length > 2000 || !pts.every(okPt)) return null
  const need = kind === 'line' ? 2 : kind === 'area' ? 3 : 1
  if (pts.length < need) return null
  const out: MarkGeom = { pts: pts.map(r6) }
  if (kind === 'area' && Array.isArray(holes) && holes.length) {
    if (holes.length > 50) return null
    const hs = holes.filter((h): h is UV[] => Array.isArray(h) && h.length >= 3 && h.length <= 1000 && h.every(okPt))
    if (hs.length) out.holes = hs.map((h) => h.map(r6))
  }
  return out
}

export interface RollupRow { itemId: string; qty: number; marks: number; check: number; suggested: number }

/** Totals per item over a set of marks (suggested marks are not counted until accepted). */
export function rollup(marks: { itemId: string | null; qty: number | null; status: string }[]): RollupRow[] {
  const by = new Map<string, RollupRow>()
  for (const m of marks) {
    if (!m.itemId) continue
    let r = by.get(m.itemId)
    if (!r) { r = { itemId: m.itemId, qty: 0, marks: 0, check: 0, suggested: 0 }; by.set(m.itemId, r) }
    if (m.status === 'suggested') { r.suggested++; continue }
    r.marks++
    if (m.status === 'check') r.check++
    r.qty += m.qty ?? 0
  }
  return Array.from(by.values()).map((r) => ({ ...r, qty: Math.round(r.qty * 1000) / 1000 }))
}

/** A starter library for a sitework company — edit it, it is yours. No prices. */
export const STARTER_ITEMS: { code: string; name: string; measure: Measure; unit: Unit; color: string; depth_in?: number; tons_per_cy?: number; section: string }[] = [
  { code: 'CLR', name: 'Clearing and grubbing', measure: 'area', unit: 'AC', color: '#84cc16', section: 'Site prep' },
  { code: 'SF-FENCE', name: 'Silt fence', measure: 'length', unit: 'LF', color: '#a16207', section: 'Erosion control' },
  { code: 'CE', name: 'Construction entrance', measure: 'count', unit: 'EA', color: '#78716c', section: 'Erosion control' },
  { code: 'TOPSOIL', name: 'Topsoil strip, 6"', measure: 'volume', unit: 'CY', color: '#65a30d', depth_in: 6, section: 'Earthwork' },
  { code: 'PAV-HD', name: 'Heavy duty asphalt (3" on 8" stone)', measure: 'area', unit: 'SY', color: '#475569', depth_in: 11, section: 'Paving' },
  { code: 'PAV-LD', name: 'Light duty asphalt (2" on 6" stone)', measure: 'area', unit: 'SY', color: '#94a3b8', depth_in: 8, section: 'Paving' },
  { code: 'STONE', name: 'Stone base (ABC), 8"', measure: 'volume', unit: 'TON', color: '#a8a29e', depth_in: 8, tons_per_cy: 1.9, section: 'Paving' },
  { code: 'CONC-SW', name: 'Concrete sidewalk, 4"', measure: 'area', unit: 'SF', color: '#e2e8f0', depth_in: 4, section: 'Concrete' },
  { code: 'CONC-HD', name: 'Heavy duty concrete, 8"', measure: 'area', unit: 'SY', color: '#cbd5e1', depth_in: 8, section: 'Concrete' },
  { code: 'CG-24', name: 'Curb and gutter, 24"', measure: 'length', unit: 'LF', color: '#f59e0b', section: 'Concrete' },
  { code: 'CURB', name: 'Standard curb', measure: 'length', unit: 'LF', color: '#fbbf24', section: 'Concrete' },
  { code: 'RCP-15', name: '15" RCP', measure: 'length', unit: 'LF', color: '#2563eb', section: 'Storm' },
  { code: 'RCP-24', name: '24" RCP', measure: 'length', unit: 'LF', color: '#1d4ed8', section: 'Storm' },
  { code: 'CB', name: 'Catch basin', measure: 'count', unit: 'EA', color: '#0ea5e9', section: 'Storm' },
  { code: 'MH', name: 'Manhole', measure: 'count', unit: 'EA', color: '#6366f1', section: 'Sanitary' },
  { code: 'STRIPE', name: 'Striping, 4"', measure: 'length', unit: 'LF', color: '#fde047', section: 'Paving' },
  { code: 'STALL', name: 'Parking stalls', measure: 'count', unit: 'EA', color: '#facc15', section: 'Paving' },
  { code: 'SOD', name: 'Sod', measure: 'area', unit: 'SY', color: '#22c55e', section: 'Landscape' },
  { code: 'SEED', name: 'Seed and mulch', measure: 'area', unit: 'AC', color: '#4ade80', section: 'Landscape' },
]

/**
 * Every scale check a version has: what its page said at upload (stated,
 * bar, labelled distances, grid), a scale set by hand, and — when it is
 * placed and its paper size is known — what the placement implies. The
 * viewer's scale card and the server's measuring read this one list.
 */
export function checksFor(
  v: { scaleChecks?: { key: string; feetPerInch: number; detail: string }[] | null; feetPerInch: number | null; scaleText: string | null; pageW: number | null; placement: { source?: string } | null; fileId?: string | null },
  bounds: Corners4 | null | undefined,
  placedWords = 'placed on the map',
): ScaleCheck[] {
  const keys: ScaleKey[] = ['stated', 'bar', 'dims', 'grid', 'placement', 'set']
  const out: ScaleCheck[] = (v.scaleChecks ?? [])
    .filter((c) => (keys as string[]).includes(c.key) && c.feetPerInch > 0)
    .map((c) => ({ ...c, key: c.key as ScaleKey }))
  if (!out.some((c) => c.key === 'stated') && v.feetPerInch) out.push({ key: 'stated', feetPerInch: v.feetPerInch, detail: `${v.scaleText ?? ''} in the title block`.trim() })
  // Placement against the page's own size — a PDF page's points; a picture
  // upload's width is pixels, which say nothing about inches.
  if (bounds && v.pageW && v.fileId && v.placement?.source !== 'grid') {
    out.push({ key: 'placement', feetPerInch: placementFeetPerInch(metresPerUnit(bounds, v.pageW)), detail: placedWords })
  }
  return out
}

/**
 * The sheet in ground feet for measuring — ONE rule for the device and the
 * server: a PDF page is its paper size × the agreed scale; a picture (no PDF:
 * its size is pixels, not inches) measures only from where it is placed.
 */
export function measuringFeet(
  v: { fileId?: string | null; pageW: number | null; pageH: number | null },
  checks: ScaleCheck[],
  bounds: Corners4 | null | undefined,
): { feet: SheetFeet | null; blocked: string | null } {
  if (!v.fileId) {
    const feet = bounds ? sheetFeet(null, null, null, bounds) : null
    return { feet, blocked: feet ? null : 'Place this sheet on the map to measure on it — a picture has no paper size to scale from.' }
  }
  const s = measureScale(checks)
  const feet = s.feetPerInch && v.pageW && v.pageH ? sheetFeet(v.pageW, v.pageH, s.feetPerInch) : null
  return { feet, blocked: feet ? null : (s.blocked ?? 'Place this sheet on the map, or set its scale, to measure on it.') }
}

export interface ReportRow { code: string; name: string; unit: string; then: number; now: number; delta: number; deltaUsd: number | null }

/**
 * The revision report: each item's quantity in a frozen snapshot against now,
 * by item CODE (the one thing that never changes), with Δ $ at today's unit
 * price when there is one. Rows that moved first, biggest change first.
 */
export function revisionReport(
  then: { code: string; name: string; unit: string; qty: number }[],
  now: { code: string; name: string; unit: string; qty: number; unitPrice: number | null }[],
): ReportRow[] {
  const a = new Map(then.map((i) => [i.code, i]))
  const b = new Map(now.map((i) => [i.code, i]))
  const codes = Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys())]))
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  return codes.map((code) => {
    const x = a.get(code), y = b.get(code)
    const t = Number(x?.qty ?? 0), n = Number(y?.qty ?? 0)
    const delta = r3(n - t)
    const price = y?.unitPrice ?? null
    return { code, name: y?.name ?? x?.name ?? '', unit: y?.unit ?? x?.unit ?? '', then: r3(t), now: r3(n), delta, deltaUsd: price === null ? null : Math.round(delta * price * 100) / 100 }
  }).sort((p, q) => (Math.abs(q.deltaUsd ?? 0) - Math.abs(p.deltaUsd ?? 0)) || (Number(q.delta !== 0) - Number(p.delta !== 0)) || p.code.localeCompare(q.code))
}
