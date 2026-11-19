/**
 * A takeoff version's LEGEND and what changed between two versions — pure.
 * The legend is everything a reader needs to trust the numbers: the
 * earthwork itself and every assumption behind it — where the existing
 * ground came from and its datum shift, shrink, topsoil, the sections
 * (paving thicknesses), the building pads, the plan sheets and their
 * revisions. It is frozen with the version, so "Rev 3 of the takeoff said
 * 12,400 CY export with 15% shrink off Rev 2 of C-101" stays true forever.
 */
import type { DirtDesign, DirtResults } from './takeoff'

export interface LegendSheet { number: string; rev: string | null; issuedOn: string | null }
export interface Legend {
  earthwork: { cutCy: number; fillCy: number; fillAdjCy: number; onsiteCy: number; exportCy: number; importCy: number; topsoilCy: number; loads: number; maxCutFt: number; maxFillFt: number; acres: number }
  assumptions: {
    existing: string
    datumOffsetFt: number
    shrinkPct: number
    truckCy: number
    topsoil: string[]
    sections: { label: string; inches: number; sf: number }[]
    pads: { label: string; ffeFt: number; subgradeFt: number }[]
    demo: { label: string; inches: number; cy: number }[]
    sheets: LegendSheet[]
    counts: { contours: number; spots: number; areas: number }
  }
  warnings: string[]
}

const r0 = (v: unknown) => Math.round(Number(v) || 0)
const r1 = (v: unknown) => Math.round((Number(v) || 0) * 10) / 10

export function buildLegend(design: DirtDesign, results: DirtResults | null, sheets: LegendSheet[]): Legend {
  const f = design.features ?? []
  const topsoil = f.filter((x) => x.kind === 'topsoil').map((x) => `${x.label || 'Topsoil'}: ${r1(x.thicknessIn)}"`)
  return {
    earthwork: {
      cutCy: r0(results?.cutCy), fillCy: r0(results?.fillCy), fillAdjCy: r0(results?.fillAdjCy), onsiteCy: r0(results?.onsiteCy),
      exportCy: r0(results?.exportCy), importCy: r0(results?.importCy), topsoilCy: r0(results?.topsoil?.cy), loads: r0(results?.loads),
      maxCutFt: r1(results?.maxCutFt), maxFillFt: r1(results?.maxFillFt), acres: Math.round(((Number(results?.boundarySf) || 0) / 43_560) * 100) / 100,
    },
    assumptions: {
      existing: results?.existing?.detail || (design.existing?.source === 'traced' ? 'Traced from the plan' : 'USGS lidar'),
      datumOffsetFt: r1(design.existing?.offsetFt),
      shrinkPct: r1(design.settings?.shrinkPct),
      truckCy: r1(design.settings?.truckCy),
      topsoil,
      sections: (results?.reduce ?? f.filter((x) => x.kind === 'reduce').map((x) => ({ label: x.label || 'Paving', thicknessIn: Number(x.thicknessIn) || 0, sf: 0 })))
        .map((s) => ({ label: s.label, inches: r1(s.thicknessIn), sf: r0(s.sf) })),
      pads: (results?.platforms ?? []).map((p) => ({ label: p.label, ffeFt: r1(p.ffeFt), subgradeFt: r1(p.subgradeFt) })),
      demo: (results?.demo ?? []).map((d) => ({ label: d.label, inches: r1(d.thicknessIn), cy: r0(d.cy) })),
      sheets: sheets.slice(0, 60),
      counts: {
        contours: f.filter((x) => x.kind === 'eg_contour' || x.kind === 'fg_contour').length,
        spots: f.filter((x) => x.kind === 'eg_spot' || x.kind === 'fg_spot').length,
        areas: f.filter((x) => x.kind === 'platform' || x.kind === 'reduce' || x.kind === 'demo' || x.kind === 'topsoil').length,
      },
    },
    warnings: (results?.warnings ?? []).slice(0, 12),
  }
}

export interface LegendChange { what: string; from: string; to: string; delta?: string; big?: boolean }

const fmt = (v: number) => v.toLocaleString('en-US')
/** What changed from version A to version B, in words. Earthwork moves of 5%+ are "big". */
export function diffLegends(a: Legend, b: Legend): LegendChange[] {
  const out: LegendChange[] = []
  const ew: [keyof Legend['earthwork'], string, string][] = [
    ['cutCy', 'Cut', 'CY'], ['fillCy', 'Fill', 'CY'], ['exportCy', 'Export', 'CY'], ['importCy', 'Import', 'CY'],
    ['topsoilCy', 'Topsoil strip', 'CY'], ['loads', 'Truck loads', ''], ['acres', 'Grading limits', 'ac'],
  ]
  for (const [k, label, unit] of ew) {
    const x = a.earthwork[k], y = b.earthwork[k]
    if (x === y) continue
    const d = y - x
    const pct = x ? Math.abs(d / x) : 1
    out.push({ what: label, from: `${fmt(x)}${unit ? ` ${unit}` : ''}`, to: `${fmt(y)}${unit ? ` ${unit}` : ''}`, delta: `${d > 0 ? '+' : ''}${fmt(Math.round(d * 100) / 100)}${unit ? ` ${unit}` : ''}`, big: pct >= 0.05 })
  }
  const A = a.assumptions, B = b.assumptions
  if (A.existing !== B.existing) out.push({ what: 'Existing ground', from: A.existing, to: B.existing, big: true })
  if (A.datumOffsetFt !== B.datumOffsetFt) out.push({ what: 'Datum offset', from: `${A.datumOffsetFt} ft`, to: `${B.datumOffsetFt} ft`, big: true })
  if (A.shrinkPct !== B.shrinkPct) out.push({ what: 'Shrink', from: `${A.shrinkPct}%`, to: `${B.shrinkPct}%`, big: true })
  if (A.truckCy !== B.truckCy) out.push({ what: 'Truck size', from: `${A.truckCy} CY`, to: `${B.truckCy} CY` })
  const join = (l: string[]) => l.join(' · ') || 'none'
  if (join(A.topsoil) !== join(B.topsoil)) out.push({ what: 'Topsoil', from: join(A.topsoil), to: join(B.topsoil), big: true })
  const sec = (l: Legend['assumptions']['sections']) => join(l.map((s) => `${s.label} ${s.inches}"`))
  if (sec(A.sections) !== sec(B.sections)) out.push({ what: 'Sections', from: sec(A.sections), to: sec(B.sections), big: true })
  const pad = (l: Legend['assumptions']['pads']) => join(l.map((p) => `${p.label} FFE ${p.ffeFt}`))
  if (pad(A.pads) !== pad(B.pads)) out.push({ what: 'Building pads', from: pad(A.pads), to: pad(B.pads), big: true })
  const sh = (l: LegendSheet[]) => join(l.map((s) => `${s.number}${s.rev ? ` Rev ${s.rev}` : ''}`))
  if (sh(A.sheets) !== sh(B.sheets)) out.push({ what: 'Plan sheets', from: sh(A.sheets), to: sh(B.sheets), big: true })
  return out
}

/**
 * Which version the map shows on a day: the newest saved on or before it
 * (versions are immutable, so "what we believed then"). Before the first
 * version: none — the takeoff's live picture is today's, not history's.
 */
export function versionOn<T extends { createdAt: string }>(versions: T[], cutoffMs: number): T | null {
  let best: T | null = null
  for (const v of versions) {
    const t = Date.parse(v.createdAt)
    if (t <= cutoffMs && (!best || t > Date.parse(best.createdAt))) best = v
  }
  return best
}
