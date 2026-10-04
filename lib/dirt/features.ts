/**
 * Editor-side helpers for takeoff features: what each kind looks like, the
 * presets from DCG's takeoff process (Apr 2025), plain-words labels, and the
 * GeoJSON the editor map draws. Pure.
 */
import type { DirtDesign, DirtFeature, DirtKind } from './takeoff'

export type Shape = 'point' | 'line' | 'area'

export const KIND_META: Record<DirtKind, { label: string; shape: Shape; color: string; step: Step }> = {
  boundary: { label: 'Grading limits', shape: 'area', color: '#ffffff', step: 'proposed' },
  eg_contour: { label: 'Existing contour', shape: 'line', color: '#9fb6cc', step: 'existing' },
  eg_spot: { label: 'Existing spot grade', shape: 'point', color: '#9fb6cc', step: 'existing' },
  demo: { label: 'Demo area', shape: 'area', color: '#f59e0b', step: 'demo' },
  topsoil: { label: 'Topsoil strip', shape: 'area', color: '#4ade80', step: 'topsoil' },
  fg_contour: { label: 'Proposed contour', shape: 'line', color: '#ff9e16', step: 'proposed' },
  fg_spot: { label: 'Proposed spot grade', shape: 'point', color: '#ff9e16', step: 'proposed' },
  platform: { label: 'Building pad', shape: 'area', color: '#c084fc', step: 'proposed' },
  reduce: { label: 'Construction thickness', shape: 'area', color: '#38bdf8', step: 'thickness' },
}

export type Step = 'plans' | 'existing' | 'demo' | 'topsoil' | 'proposed' | 'thickness' | 'results'

export const STEPS: { key: Step; label: string; hint: string }[] = [
  { key: 'plans', label: 'Plans', hint: 'Sheets on the map' },
  { key: 'existing', label: 'Existing', hint: 'Lidar or traced' },
  { key: 'demo', label: 'Demo', hint: 'Lower by demo type' },
  { key: 'topsoil', label: 'Topsoil', hint: 'Strip depth' },
  { key: 'proposed', label: 'Proposed', hint: 'Limits, contours, pads' },
  { key: 'thickness', label: 'Thickness', hint: 'Paving & slabs' },
  { key: 'results', label: 'Results', hint: 'CY for the estimate' },
]

export interface Preset { label: string; thicknessIn: number; note?: string }

/** Demo: lower existing by the assumed thickness of each demo type. */
export const DEMO_PRESETS: Preset[] = [
  { label: 'Asphalt', thicknessIn: 4 },
  { label: 'Concrete', thicknessIn: 6 },
  { label: 'Building slab', thicknessIn: 8 },
  { label: 'Gravel', thicknessIn: 6 },
]

/** Construction thickness under finished grade (DCG process examples first). */
export const REDUCE_PRESETS: Preset[] = [
  { label: 'Light duty asphalt', thicknessIn: 8, note: '6" stone + 2" asphalt' },
  { label: 'Heavy duty asphalt', thicknessIn: 11, note: '8" stone + 1.5" binder + 1.5" surface' },
  { label: 'Concrete sidewalk', thicknessIn: 8, note: '4" concrete + 4" stone' },
  { label: 'Concrete pad', thicknessIn: 10, note: '6" concrete + 4" stone' },
]

export const TOPSOIL_HINT = 'Average the geotech borings. No report: 1–3" for graded sites or fields, 5" for woods.'

let seq = 0
export function newId(prefix = 'f'): string {
  seq = (seq + 1) % 1296
  return `${prefix}${Date.now().toString(36)}${seq.toString(36).padStart(2, '0')}`.slice(0, 32)
}

const fmtFt = (z: number | undefined) => (Number.isFinite(z) ? (Math.round(Number(z) * 100) / 100).toString() : '?')
const fmtIn = (t: number | undefined) => `${Number.isFinite(t) ? (Math.round(Number(t) * 100) / 100).toString() : '?'}"`

export function featureLabel(f: DirtFeature): string {
  switch (f.kind) {
    case 'boundary': return 'Grading limits'
    case 'eg_contour': case 'fg_contour': case 'eg_spot': case 'fg_spot': return fmtFt(f.z)
    case 'platform': return `${f.label || 'Pad'} · FFE ${fmtFt(f.z)} · ${fmtIn(f.offsetIn ?? -8)}`
    case 'demo': return `Demo ${f.label || ''} ${fmtIn(f.thicknessIn)}`.replace(/\s+/g, ' ')
    case 'topsoil': return `Topsoil ${fmtIn(f.thicknessIn)}`
    case 'reduce': return `${f.label || 'Paving'} ${fmtIn(f.thicknessIn)}`
  }
}

/** Plain words for the feature list. */
export function featureTitle(f: DirtFeature): string {
  const base = KIND_META[f.kind].label
  if (f.kind === 'eg_contour' || f.kind === 'fg_contour') return `${base} ${fmtFt(f.z)}`
  if (f.kind === 'eg_spot' || f.kind === 'fg_spot') return `${base} ${fmtFt(f.z)}`
  if (f.kind === 'boundary') return base
  return featureLabel(f)
}

function centroidLL(c: [number, number][]): [number, number] {
  let x = 0, y = 0
  for (const p of c) { x += p[0]; y += p[1] }
  return [x / c.length, y / c.length]
}

/** Everything the editor map draws, one FeatureCollection. */
export function designGeoJSON(design: DirtDesign, selectedId: string | null): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = []
  for (const f of design.features) {
    const meta = KIND_META[f.kind]
    if (!meta || !f.coords.length) continue
    const props = { id: f.id, kind: f.kind, color: meta.color, lbl: featureLabel(f), sel: f.id === selectedId ? 1 : 0 }
    if (meta.shape === 'point') {
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: f.coords[0] }, properties: { ...props, g: 'pt' } })
    } else if (meta.shape === 'line') {
      if (f.coords.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.coords }, properties: { ...props, g: 'ln' } })
    } else if (f.coords.length >= 3) {
      const ring = [...f.coords, f.coords[0]]
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { ...props, g: 'ar' } })
      if (f.kind !== 'boundary') out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: centroidLL(f.coords) }, properties: { ...props, g: 'al' } })
    }
  }
  return { type: 'FeatureCollection', features: out }
}

/** Every vertex of the design, for snapping. */
export function allVertices(design: DirtDesign): [number, number][] {
  const out: [number, number][] = []
  for (const f of design.features) for (const c of f.coords) out.push(c)
  return out
}

/** "Copy for estimate" — the lines DCG's estimate sheet takes. */
export function estimateText(r: {
  topsoil: { cy: number; sf: number }; cutCy: number; fillCy: number; onsiteCy: number; exportCy: number; importCy: number
  shrinkPct: number; loads: number; truckCy: number; demo: { label: string; thicknessIn: number; sf: number; cy: number }[]
}, name: string): string {
  const n = (v: number) => Math.round(v).toLocaleString()
  const lines = [
    `${name} — dirt takeoff (HammerTrack)`,
    `Topsoil: ${n(r.topsoil.cy)} CY (${n(r.topsoil.sf)} SF)`,
    `Cut: ${n(r.cutCy)} CY · Fill: ${n(r.fillCy)} CY${r.shrinkPct ? ` (+${r.shrinkPct}% shrink)` : ''}`,
    `Onsite: ${n(r.onsiteCy)} CY`,
    r.exportCy > 0 ? `Export: ${n(r.exportCy)} CY (${r.loads} loads @ ${r.truckCy} CY)` : `Import: ${n(r.importCy)} CY (${r.loads} loads @ ${r.truckCy} CY)`,
    ...r.demo.map(d => `Demo ${d.label} ${d.thicknessIn}": ${n(d.sf)} SF · ${n(d.cy)} CY`),
  ]
  return lines.join('\n')
}
