/**
 * The design, out to the machines (Plans & Takeoff phase 5) — pure.
 *
 * From a dirt takeoff's own surfaces: LandXML 1.2 with two TIN surfaces —
 * FINISHED GRADE (the traced contours, spots and pads, tied into existing at
 * the grading limits — the exact triangles the volumes are integrated on) and
 * SUBGRADE (finished grade less the construction thickness under paving and
 * slabs, pads at their subgrade, with a near-vertical wall a few centimetres
 * wide along every section edge so a machine sees the step) — plus a DXF
 * (R12, the version every CAD and machine-control office reads) with the
 * linework on named layers and both surfaces as 3D faces.
 *
 * Coordinates: SC State Plane (NAD83, EPSG:2273, international feet) for a
 * site in South Carolina, else the site's NAD83 UTM zone in metres;
 * elevations in the same unit, as traced from the plans. The dealer (Linder)
 * builds the machine's own file (Topcon .tp3) from these.
 */
import { FT, lookups, type DirtDesign, type TakeoffContext } from '../dirt/takeoff'
import { fromFrame, toFrame } from '../dirt/tm'
import { BinIndex, centroid, polyArea, segmentCrosses, splitByLine, type Box } from '../dirt/geom'
import { buildTin, TinSurface, type TinPoint } from '../dirt/surface'
import { toStatePlane } from '../plans/stateplane'
import { defaultGrid, type Grid } from './grid'

export { defaultGrid, type Grid }

export class ExportError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ExportError' }
}

export interface Crs { epsg: number; name: string; unit: 'ft' | 'm' }

export interface Mesh {
  /** Output coordinates: easting, northing, elevation per point. */
  e: number[]
  n: number[]
  z: number[]
  /** Triangles as point indices (0-based), counter-clockwise. */
  faces: number[]
}

export interface DesignFiles {
  landxml: string
  dxf: string
  crs: Crs
  fg: Mesh
  sg: Mesh
  warnings: string[]
}

/** The wall along a section edge: this far either side of the line, metres. */
export const WALL_M = 0.02
const MAX_FACES = 600_000

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

/** The output grid: SC State Plane feet, or the site's UTM zone in metres. */
export function crsFor(ctx: TakeoffContext, grid?: Grid): { crs: Crs; proj: (x: number, y: number) => [number, number]; zOut: (zm: number) => number; fromLngLat: (lng: number, lat: number) => [number, number] } {
  const d = ctx.domain
  const cx = d ? (d.x0 + d.x1) / 2 : 0, cy = d ? (d.y0 + d.y1) / 2 : 0
  const [lng, lat] = fromFrame(ctx.frame, cx, cy)
  if ((grid ?? defaultGrid(lng, lat)) === 'sc') {
    return {
      crs: { epsg: 2273, name: 'NAD83 / South Carolina (ft)', unit: 'ft' },
      proj: (x, y) => { const [lo, la] = fromFrame(ctx.frame, x, y); return toStatePlane(lo, la) },
      zOut: (zm) => zm / FT,
      fromLngLat: (lo, la) => toStatePlane(lo, la),
    }
  }
  return {
    crs: { epsg: ctx.frame.epsg, name: `NAD83 / UTM zone ${ctx.frame.zone}N`, unit: 'm' },
    proj: (x, y) => [x + ctx.frame.e0, y + ctx.frame.n0],
    zOut: (zm) => zm,
    fromLngLat: (lo, la) => { const [x, y] = toFrame(ctx.frame, lo, la); return [x + ctx.frame.e0, y + ctx.frame.n0] },
  }
}

/** A TIN's triangles inside the grading limits (by centroid), re-indexed, in output coordinates. */
function clipMesh(tin: TinSurface, inside: (x: number, y: number) => boolean, proj: (x: number, y: number) => [number, number], zOut: (z: number) => number): Mesh {
  const m = tin.mesh()
  const map = new Map<number, number>()
  const out: Mesh = { e: [], n: [], z: [], faces: [] }
  for (let t = 0; t < m.faces.length; t += 3) {
    const a = m.faces[t], b = m.faces[t + 1], c = m.faces[t + 2]
    const gx = (m.xy[2 * a] + m.xy[2 * b] + m.xy[2 * c]) / 3, gy = (m.xy[2 * a + 1] + m.xy[2 * b + 1] + m.xy[2 * c + 1]) / 3
    if (!inside(gx, gy)) continue
    for (const v of [a, b, c]) {
      let k = map.get(v)
      if (k === undefined) {
        k = out.e.length
        map.set(v, k)
        const [E, N] = proj(m.xy[2 * v], m.xy[2 * v + 1])
        out.e.push(E); out.n.push(N); out.z.push(zOut(m.z[v]))
      }
      out.faces.push(k)
    }
  }
  if (out.faces.length / 3 > MAX_FACES) throw new ExportError('This design is too big to export in one file — split the grading limits.')
  return out
}

/**
 * The subgrade TIN, built from the finished grade's own triangles: each is cut
 * along every section and pad edge (the takeoff's own method), and each piece
 * takes its subgrade — finished grade less the section under it, or the pad's
 * subgrade — so inside a section the subgrade is EXACTLY finished grade minus
 * the thickness. Where a piece meets a section edge on the section side, its
 * corners step WALL_M in from the edge: the step becomes a wall a few
 * centimetres wide, and the triangulation keeps every piece's edges.
 */
function subgradeTin(ctx: TakeoffContext, fg: TinSurface, warnings: string[]): TinSurface | null {
  const look = lookups(ctx)
  const areas = [...ctx.platforms, ...ctx.reduce]
  const segs: number[] = []
  let sb: Box | null = null
  for (const a of areas) sb = sb ? { x0: Math.min(sb.x0, a.box.x0), y0: Math.min(sb.y0, a.box.y0), x1: Math.max(sb.x1, a.box.x1), y1: Math.max(sb.y1, a.box.y1) } : { ...a.box }
  if (!sb || !ctx.domain) return null
  const segIdx = new BinIndex(sb, Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0, 1) / 128)
  for (const a of areas) {
    const r = a.ring
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length
      const id = segs.length / 4
      segs.push(r[i], r[i + 1], r[j], r[j + 1])
      segIdx.insert(id, { x0: Math.min(r[i], r[j]) - 1e-4, y0: Math.min(r[i + 1], r[j + 1]) - 1e-4, x1: Math.max(r[i], r[j]) + 1e-4, y1: Math.max(r[i + 1], r[j + 1]) + 1e-4 })
    }
  }
  const hits: number[] = [], seen = new Set<number>()
  const near = (x: number, y: number, tol: number) => {
    hits.length = 0
    segIdx.query({ x0: x - tol, y0: y - tol, x1: x + tol, y1: y + tol }, hits, seen)
    return hits
  }
  const pts: TinPoint[] = []
  const key = new Map<string, number>()
  const edgeSet = new Set<string>()
  const edges: [number, number][] = []
  const addPoint = (x: number, y: number, z: number) => {
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`
    let i = key.get(k)
    if (i === undefined) { i = pts.length; key.set(k, i); pts.push({ x, y, z, src: 'subgrade' }) }
    return i
  }
  let pieces = 0
  fg.each(ctx.domain, (t) => {
    const tb: Box = { x0: Math.min(t.v[0], t.v[2], t.v[4]), y0: Math.min(t.v[1], t.v[3], t.v[5]), x1: Math.max(t.v[0], t.v[2], t.v[4]), y1: Math.max(t.v[1], t.v[3], t.v[5]) }
    let parts: number[][] = [t.v.slice()]
    for (const sId of near((tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2, Math.max(tb.x1 - tb.x0, tb.y1 - tb.y0))) {
      const o = 4 * sId
      const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3]
      const next: number[][] = []
      for (const q of parts) {
        if (segmentCrosses(q, ax, ay, bx, by)) next.push(...splitByLine(q, ax, ay, bx, by))
        else next.push(q)
      }
      parts = next
    }
    for (const q of parts) {
      if (q.length < 6 || polyArea(q) < 1e-10) continue
      pieces++
      const [cx, cy] = centroid(q)
      const pi = look.platforms.at(cx, cy), ri = pi >= 0 ? -1 : look.reduce.at(cx, cy)
      const inSection = pi >= 0 || ri >= 0
      const zAt = (x: number, y: number) => (pi >= 0 ? ctx.platforms[pi].z : t.p0 + t.p1 * x + t.p2 * y - (ri >= 0 ? ctx.reduce[ri].t : 0))
      const ids: number[] = []
      for (let v = 0; v < q.length; v += 2) {
        let x = q[v], y = q[v + 1]
        if (inSection) {
          // On a section edge: step in toward this piece (the sum of the normals at a corner).
          let mx = 0, my = 0
          for (const sId of near(x, y, 1e-5)) {
            const o = 4 * sId
            const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3]
            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
            if (l2 < 1e-12) continue
            const u = ((x - ax) * dx + (y - ay) * dy) / l2
            if (u < -1e-6 || u > 1 + 1e-6) continue
            const l = Math.sqrt(l2)
            if (Math.abs((x - ax) * dy - (y - ay) * dx) / l > 1e-5) continue
            const side = dx * (cy - ay) - dy * (cx - ax) > 0 ? 1 : -1
            mx += (-dy / l) * side; my += (dx / l) * side
          }
          const ml = Math.hypot(mx, my)
          if (ml > 1e-9) { x += (WALL_M * mx) / ml; y += (WALL_M * my) / ml }
        }
        const id = addPoint(x, y, zAt(x, y))
        if (ids[ids.length - 1] !== id) ids.push(id)
      }
      if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop()
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k], b = ids[(k + 1) % ids.length]
        if (a === b) continue
        const ek = a < b ? `${a},${b}` : `${b},${a}`
        if (!edgeSet.has(ek)) { edgeSet.add(ek); edges.push([a, b]) }
      }
    }
  })
  if (pieces > MAX_FACES) throw new ExportError('This design is too big to export in one file — split the grading limits.')
  if (pts.length < 3) return null
  const b = buildTin(pts, edges)
  if (b.droppedEdges) warnings.push(`${b.droppedEdges} subgrade edges couldn't be held exactly — check the steps at section edges that nearly touch.`)
  return b.tin
}

export function designMeshes(ctx: TakeoffContext, grid?: Grid): { crs: Crs; fg: Mesh; sg: Mesh; warnings: string[] } {
  if (!ctx.boundary.length) throw new ExportError('Trace the grading limits first.')
  if (!(ctx.fg instanceof TinSurface)) throw new ExportError('Trace the proposed grades (contours, spots or pads) first — there is no design surface to send.')
  const warnings: string[] = []
  const { crs, proj, zOut } = crsFor(ctx, grid)
  const look = lookups(ctx)
  const inside = (x: number, y: number) => look.boundary.at(x, y) >= 0
  const fg = clipMesh(ctx.fg, inside, proj, zOut)
  if (!fg.faces.length) throw new ExportError('The design surface doesn’t reach inside the grading limits.')
  const empty: Mesh = { e: [], n: [], z: [], faces: [] }
  if (!ctx.reduce.length && !ctx.platforms.length) {
    warnings.push('No paving, slab or pad is traced, so the subgrade is the finished grade — only Finished grade is in the file.')
    return { crs, fg, sg: empty, warnings }
  }
  const sgTin = subgradeTin(ctx, ctx.fg, warnings)
  return { crs, fg, sg: sgTin ? clipMesh(sgTin, inside, proj, zOut) : empty, warnings }
}

// ── LandXML ────────────────────────────────────────────────────────────────

function surfaceXml(name: string, desc: string, m: Mesh): string {
  const L: string[] = []
  L.push(`    <Surface name="${xmlEsc(name)}" desc="${xmlEsc(desc)}">`, '      <Definition surfType="TIN">', '        <Pnts>')
  // LandXML points are "northing easting elevation".
  for (let i = 0; i < m.e.length; i++) L.push(`          <P id="${i + 1}">${f3(m.n[i])} ${f3(m.e[i])} ${f3(m.z[i])}</P>`)
  L.push('        </Pnts>', '        <Faces>')
  for (let t = 0; t < m.faces.length; t += 3) L.push(`          <F>${m.faces[t] + 1} ${m.faces[t + 1] + 1} ${m.faces[t + 2] + 1}</F>`)
  L.push('        </Faces>', '      </Definition>', '    </Surface>')
  return L.join('\n')
}

/**
 * `navd88` only when the elevations are known to be NAVD88: the existing ground is the lidar
 * (NAVD88) with no datum offset. A plan on an assumed datum (an offset, or traced existing)
 * must not be labelled NAVD88 — the dealer builds the machine model from this.
 */
export function landXml(o: { project: string; crs: Crs; fg: Mesh; sg: Mesh; now: Date; navd88?: boolean }): string {
  const day = o.now.toISOString().slice(0, 10), time = o.now.toISOString().slice(11, 19)
  const units = o.crs.unit === 'ft'
    ? '<Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicYard" temperatureUnit="fahrenheit" pressureUnit="inchHG" diameterUnit="inch" angularUnit="decimal degrees" directionUnit="decimal degrees"/>'
    : '<Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" diameterUnit="millimeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/>'
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd" version="1.2" date="${day}" time="${time}" readOnly="false" language="English">`,
    `  <Units>${units}</Units>`,
    `  <CoordinateSystem name="${xmlEsc(o.crs.name)}" epsgCode="${o.crs.epsg}" horizontalDatum="NAD83"${o.navd88 ? ' verticalDatum="NAVD88"' : ''} desc="EPSG:${o.crs.epsg}${o.crs.unit === 'ft' ? ', international feet' : ', metres'}; elevations as traced from the plans${o.navd88 ? '' : ' (vertical datum not checked against NAVD88)'}"/>`,
    `  <Project name="${xmlEsc(o.project)}"/>`,
    '  <Application name="HammerTrack" manufacturer="HAMMERTRACK LLC" version="1" manufacturerURL="https://hammertrack.ai"/>',
    '  <Surfaces>',
    surfaceXml('Finished grade', 'Proposed finished grade traced from the plans, tied into existing at the grading limits', o.fg),
    ...(o.sg.faces.length ? [surfaceXml('Subgrade', 'Finished grade less the construction thickness under paving and slabs; pads at subgrade', o.sg)] : []),
    '  </Surfaces>',
    '</LandXML>',
    '',
  ].join('\n')
}

// ── DXF (R12) ──────────────────────────────────────────────────────────────

export const DXF_LAYERS: { name: string; color: number }[] = [
  { name: 'HT-LIMITS', color: 1 },
  { name: 'HT-FG-CONTOUR', color: 3 },
  { name: 'HT-FG-SPOT', color: 3 },
  { name: 'HT-PAD', color: 6 },
  { name: 'HT-SECTION', color: 30 },
  { name: 'HT-EG-CONTOUR', color: 8 },
  { name: 'HT-FG-TIN', color: 92 },
  { name: 'HT-SUBGRADE-TIN', color: 40 },
]

const g = (code: number, v: string | number) => `${code}\r\n${typeof v === 'number' ? f3(v) : v}\r\n`
const gi = (code: number, v: number) => `${code}\r\n${Math.round(v)}\r\n`

function polyline(layer: string, pts: [number, number, number][], closed: boolean, threeD: boolean): string {
  let s = g(0, 'POLYLINE') + g(8, layer) + gi(66, 1) + g(10, 0) + g(20, 0) + g(30, threeD ? 0 : (pts[0]?.[2] ?? 0)) + gi(70, (closed ? 1 : 0) + (threeD ? 8 : 0))
  for (const [x, y, z] of pts) s += g(0, 'VERTEX') + g(8, layer) + g(10, x) + g(20, y) + g(30, threeD ? z : 0) + gi(70, threeD ? 32 : 0)
  return s + g(0, 'SEQEND') + g(8, layer)
}
const text = (layer: string, x: number, y: number, z: number, h: number, words: string) =>
  g(0, 'TEXT') + g(8, layer) + g(10, x) + g(20, y) + g(30, z) + g(40, h) + g(1, words.replace(/[\r\n]+/g, ' ').slice(0, 250))
const point = (layer: string, x: number, y: number, z: number) => g(0, 'POINT') + g(8, layer) + g(10, x) + g(20, y) + g(30, z)
function faces(layer: string, m: Mesh): string {
  const out: string[] = []
  for (let t = 0; t < m.faces.length; t += 3) {
    const [a, b, c] = [m.faces[t], m.faces[t + 1], m.faces[t + 2]]
    out.push(g(0, '3DFACE') + g(8, layer)
      + g(10, m.e[a]) + g(20, m.n[a]) + g(30, m.z[a])
      + g(11, m.e[b]) + g(21, m.n[b]) + g(31, m.z[b])
      + g(12, m.e[c]) + g(22, m.n[c]) + g(32, m.z[c])
      + g(13, m.e[c]) + g(23, m.n[c]) + g(33, m.z[c]))
  }
  return out.join('')
}

export function dxf(o: { design: DirtDesign; crs: Crs; fromLngLat: (lng: number, lat: number) => [number, number]; fg: Mesh; sg: Mesh }): string {
  const ft = o.crs.unit === 'ft'
  const zOf = (zFt: number) => (ft ? zFt : zFt * FT)
  const th = ft ? 2 : 0.6
  const at = (c: [number, number]) => o.fromLngLat(c[0], c[1])
  let ents = ''
  for (const f of o.design.features) {
    const pts = f.coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map(at)
    if (!pts.length) continue
    const z = Number.isFinite(f.z) ? zOf(Number(f.z)) : 0
    if (f.kind === 'boundary' && pts.length >= 3) ents += polyline('HT-LIMITS', pts.map(([x, y]) => [x, y, 0]), true, false)
    else if ((f.kind === 'fg_contour' || f.kind === 'eg_contour') && pts.length >= 2 && Number.isFinite(f.z)) ents += polyline(f.kind === 'fg_contour' ? 'HT-FG-CONTOUR' : 'HT-EG-CONTOUR', pts.map(([x, y]) => [x, y, z]), false, true)
    else if (f.kind === 'fg_spot' && Number.isFinite(f.z)) ents += point('HT-FG-SPOT', pts[0][0], pts[0][1], z) + text('HT-FG-SPOT', pts[0][0] + th / 2, pts[0][1] + th / 2, z, th, Number(f.z).toFixed(2))
    else if (f.kind === 'platform' && pts.length >= 3 && Number.isFinite(f.z)) {
      const off = Number.isFinite(f.offsetIn) ? Number(f.offsetIn) : -8
      const sgFt = Number(f.z) + off / 12
      ents += polyline('HT-PAD', pts.map(([x, y]) => [x, y, z]), true, true)
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      ents += text('HT-PAD', cx, cy, z, th, `${f.label || 'Pad'} FFE ${Number(f.z).toFixed(2)} SG ${sgFt.toFixed(2)}`)
    } else if (f.kind === 'reduce' && pts.length >= 3) {
      ents += polyline('HT-SECTION', pts.map(([x, y]) => [x, y, 0]), true, false)
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      ents += text('HT-SECTION', cx, cy, 0, th, `${f.label || 'Section'} ${Number(f.thicknessIn) || 0} in`)
    }
  }
  ents += faces('HT-FG-TIN', o.fg) + faces('HT-SUBGRADE-TIN', o.sg)
  const layers = DXF_LAYERS.map((l) => g(0, 'LAYER') + g(2, l.name) + gi(70, 0) + gi(62, l.color) + g(6, 'CONTINUOUS')).join('')
  return g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$INSUNITS') + gi(70, ft ? 2 : 6) + g(0, 'ENDSEC')
    + g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + gi(70, DXF_LAYERS.length) + layers + g(0, 'ENDTAB') + g(0, 'ENDSEC')
    + g(0, 'SECTION') + g(2, 'ENTITIES') + ents + g(0, 'ENDSEC') + g(0, 'EOF')
}

/** Both files for a takeoff's design. */
export function designFiles(ctx: TakeoffContext, design: DirtDesign, o: { project: string; now: Date; grid?: Grid }): DesignFiles {
  const m = designMeshes(ctx, o.grid)
  const { fromLngLat } = crsFor(ctx, o.grid)
  return {
    crs: m.crs, fg: m.fg, sg: m.sg, warnings: m.warnings,
    landxml: landXml({ project: o.project, crs: m.crs, fg: m.fg, sg: m.sg, now: o.now, navd88: design.existing.source === 'lidar' && design.existing.offsetFt === 0 }),
    dxf: dxf({ design, crs: m.crs, fromLngLat, fg: m.fg, sg: m.sg }),
  }
}

// ── As-built re-fit (163, Beta) ─────────────────────────────────────────────

export interface AsbuiltShot { lng: number; lat: number; zFt: number; kind: string }
export interface AsbuiltFiles {
  landxml: string
  crs: Crs
  warnings: string[]
  /** Per shot used: as-built minus design, feet. */
  residualsFt: number[]
  faces: { fg: number; stone: number; sg: number }
}

/** A LandXML with any number of surfaces (the as-built set: finished grade, top of stone, subgrade). */
export function landXmlSurfaces(o: { project: string; crs: Crs; surfaces: { name: string; desc: string; mesh: Mesh }[]; now: Date; navd88?: boolean }): string {
  const base = landXml({ project: o.project, crs: o.crs, fg: o.surfaces[0].mesh, sg: { e: [], n: [], z: [], faces: [] }, now: o.now, navd88: o.navd88 })
  const body = o.surfaces.filter((s) => s.mesh.faces.length).map((s) => surfaceXml(s.name, s.desc, s.mesh)).join('\n')
  return base.replace(/ {2}<Surfaces>[\s\S]*<\/Surfaces>/, `  <Surfaces>\n${body}\n  </Surfaces>`)
}

/** Densifying near the shots stops past this many triangles (the export cap is MAX_FACES). */
const REFIT_MAX_FACES = 400_000
const REFIT_ROUNDS = 12

const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - ax - u * dx, py - ay - u * dy)
}
const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

/**
 * The design surface re-fit so it PASSES THROUGH every shot. Applying the
 * correction only at the design's own vertices is not enough: traced contours
 * sit 40+ ft apart, so a shot between vertices was missed by nearly its whole
 * residual, and a shot with no vertex inside the blend radius got no
 * correction at all. So: (1) every triangle within the radius of a shot is
 * split at its edge midpoints until no edge there is longer than radius/4
 * (conforming — a split edge is split in both its triangles; a midpoint takes
 * the design's own linear height, so the design surface is unchanged by the
 * splitting); (2) each shot goes in as a vertex (into its triangle, or onto
 * the edge it sits on); (3) every vertex takes design + correction. The
 * correction is exactly the residual at a shot and 0 past the radius, so the
 * surface meets each shot and triangles beyond the radius are the design's.
 */
function refitTin(fg0: TinSurface, res: { x: number; y: number; dz: number }[], R: number, corr: (x: number, y: number) => number, warnings: string[]): TinSurface {
  const m = fg0.mesh()
  const xy: number[] = Array.from(m.xy)
  const zd: number[] = m.z.slice()
  let faces: number[] = m.faces.slice()
  // Shots by bins of the radius: "is this triangle within R of any shot?"
  let sb: Box | null = null
  for (const r of res) sb = sb ? { x0: Math.min(sb.x0, r.x), y0: Math.min(sb.y0, r.y), x1: Math.max(sb.x1, r.x), y1: Math.max(sb.y1, r.y) } : { x0: r.x, y0: r.y, x1: r.x, y1: r.y }
  const shotIdx = new BinIndex(sb!, R)
  res.forEach((r, i) => shotIdx.insert(i, { x0: r.x, y0: r.y, x1: r.x, y1: r.y }))
  const hits: number[] = [], seen = new Set<number>()
  const nearShot = (a: number, b: number, c: number) => {
    const ax = xy[2 * a], ay = xy[2 * a + 1], bx = xy[2 * b], by = xy[2 * b + 1], cx = xy[2 * c], cy = xy[2 * c + 1]
    shotIdx.query({ x0: Math.min(ax, bx, cx) - R, y0: Math.min(ay, by, cy) - R, x1: Math.max(ax, bx, cx) + R, y1: Math.max(ay, by, cy) + R }, hits, seen)
    for (const i of hits) {
      const { x, y } = res[i]
      const d1 = orient(ax, ay, bx, by, x, y), d2 = orient(bx, by, cx, cy, x, y), d3 = orient(cx, cy, ax, ay, x, y)
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true
      if (Math.min(distToSeg(x, y, ax, ay, bx, by), distToSeg(x, y, bx, by, cx, cy), distToSeg(x, y, cx, cy, ax, ay)) <= R) return true
    }
    return false
  }
  // (1) Densify within the radius.
  const L = R / 4, L2 = L * L
  const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const len2 = (a: number, b: number) => (xy[2 * a] - xy[2 * b]) ** 2 + (xy[2 * a + 1] - xy[2 * b + 1]) ** 2
  let capped = false
  for (let round = 0; round < REFIT_ROUNDS; round++) {
    const marked = new Map<string, number>()
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t], b = faces[t + 1], c = faces[t + 2]
      if (len2(a, b) <= L2 && len2(b, c) <= L2 && len2(c, a) <= L2) continue
      if (!nearShot(a, b, c)) continue
      for (const [p, q] of [[a, b], [b, c], [c, a]]) if (len2(p, q) > L2) marked.set(ek(p, q), -1)
    }
    if (!marked.size) break
    if (faces.length / 3 + 3 * marked.size > REFIT_MAX_FACES) { capped = true; break }
    for (const k of Array.from(marked.keys())) {
      const [p, q] = k.split(',').map(Number)
      marked.set(k, xy.length / 2)
      xy.push((xy[2 * p] + xy[2 * q]) / 2, (xy[2 * p + 1] + xy[2 * q + 1]) / 2)
      zd.push((zd[p] + zd[q]) / 2)
    }
    const next: number[] = []
    for (let t = 0; t < faces.length; t += 3) {
      const v = [faces[t], faces[t + 1], faces[t + 2]]
      const mid = [marked.get(ek(v[0], v[1])), marked.get(ek(v[1], v[2])), marked.get(ek(v[2], v[0]))]
      const n = mid.filter((x) => x !== undefined).length
      if (n === 0) { next.push(v[0], v[1], v[2]); continue }
      if (n === 3) {
        const [m0, m1, m2] = mid as number[]
        next.push(v[0], m0, m2, m0, v[1], m1, m2, m1, v[2], m0, m1, m2)
        continue
      }
      // Rotate so edge 0 (v0→v1) is split; with two splits, edge 1 or edge 2 is the other.
      let r = mid.findIndex((x) => x !== undefined)
      if (n === 2 && mid[0] !== undefined && mid[2] !== undefined) r = 2
      const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3]
      const mab = mid[r]!, mbc = mid[(r + 1) % 3]
      if (n === 1) next.push(a, mab, c, mab, b, c)
      else next.push(mab, b, mbc!, a, mab, mbc!, a, mbc!, c)
    }
    faces = next
  }
  if (capped) warnings.push('The re-fit hit its triangle budget near the shots — the surface still meets every shot, but the blend between them is coarser. Use fewer shots or a smaller blend radius.')
  // (2) Shots in as vertices.
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (let i = 0; i < xy.length; i += 2) box = { x0: Math.min(box.x0, xy[i]), y0: Math.min(box.y0, xy[i + 1]), x1: Math.max(box.x1, xy[i]), y1: Math.max(box.y1, xy[i + 1]) }
  const faceIdx = new BinIndex(box, Math.max(L, 0.5))
  const live: boolean[] = []
  const tri: number[] = faces
  const addFace = (a: number, b: number, c: number) => {
    const id = tri.length / 3
    tri.push(a, b, c); live.push(true)
    faceIdx.insert(id, { x0: Math.min(xy[2 * a], xy[2 * b], xy[2 * c]), y0: Math.min(xy[2 * a + 1], xy[2 * b + 1], xy[2 * c + 1]), x1: Math.max(xy[2 * a], xy[2 * b], xy[2 * c]), y1: Math.max(xy[2 * a + 1], xy[2 * b + 1], xy[2 * c + 1]) })
  }
  {
    const init = tri.splice(0)
    for (let t = 0; t < init.length; t += 3) addFace(init[t], init[t + 1], init[t + 2])
  }
  const fh: number[] = [], fs = new Set<number>()
  const EDGE = 1e-4 // m: a shot this close to an edge goes ON the edge (no sliver)
  for (const r of res) {
    faceIdx.query({ x0: r.x, y0: r.y, x1: r.x, y1: r.y }, fh, fs)
    let done = false
    for (const t of fh) {
      if (!live[t] || done) continue
      const v = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]]
      const P = v.map((i) => [xy[2 * i], xy[2 * i + 1]])
      const area = orient(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1])
      if (Math.abs(area) < 1e-12) continue
      const s = Math.sign(area)
      // Signed distance of the shot inside each edge (edge k = v[k] → v[k+1]).
      const dIn = [0, 1, 2].map((k) => {
        const [ax, ay] = P[k], [bx, by] = P[(k + 1) % 3]
        return (s * orient(ax, ay, bx, by, r.x, r.y)) / Math.hypot(bx - ax, by - ay)
      })
      if (Math.min(...dIn) < -EDGE) continue
      done = true
      // Already a vertex (within a millimetre)?
      if (P.some(([x, y]) => Math.hypot(x - r.x, y - r.y) < 1e-3)) break
      const k = dIn.indexOf(Math.min(...dIn))
      if (dIn[k] <= EDGE) {
        // On edge k: split it in both triangles that share it, at the shot's foot on the edge.
        const a = v[k], b = v[(k + 1) % 3]
        const [ax, ay] = P[k], [bx, by] = P[(k + 1) % 3]
        const u = Math.max(0, Math.min(1, ((r.x - ax) * (bx - ax) + (r.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        const nv = xy.length / 2
        xy.push(ax + u * (bx - ax), ay + u * (by - ay)); zd.push(zd[a] + u * (zd[b] - zd[a]))
        const share: number[] = []
        faceIdx.query({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, share)
        for (const f of share) {
          if (!live[f]) continue
          const w = [tri[3 * f], tri[3 * f + 1], tri[3 * f + 2]]
          const j = [0, 1, 2].find((q) => (w[q] === a && w[(q + 1) % 3] === b) || (w[q] === b && w[(q + 1) % 3] === a))
          if (j === undefined) continue
          live[f] = false
          const p0 = w[j], p1 = w[(j + 1) % 3], p2 = w[(j + 2) % 3]
          addFace(p0, nv, p2); addFace(nv, p1, p2)
        }
      } else {
        const nv = xy.length / 2
        xy.push(r.x, r.y); zd.push(fg0.zAt(r.x, r.y))
        live[t] = false
        addFace(v[0], v[1], nv); addFace(v[1], v[2], nv); addFace(v[2], v[0], nv)
      }
    }
  }
  // (3) Design + correction at every vertex.
  const out: number[] = []
  for (let t = 0; t < live.length; t++) if (live[t]) out.push(tri[3 * t], tri[3 * t + 1], tri[3 * t + 2])
  const z2 = zd.map((z, i) => z + corr(xy[2 * i], xy[2 * i + 1]))
  return new TinSurface(Float64Array.from(xy), z2, Uint32Array.from(out))
}

/**
 * Re-fit the takeoff's finished grade to the curb as built (lib/survey/refit.ts),
 * then cut TOP OF STONE (finished grade less the asphalt under every paving
 * section) and SUBGRADE (less the whole section, pads at their subgrade) from
 * the re-fit surface by the takeoff's own exact method.
 */
export function asbuiltFiles(ctx: TakeoffContext, design: DirtDesign, shots: AsbuiltShot[], o: {
  project: string; now: Date; grid?: Grid; radiusFt: number; asphaltIn: number; kinds: string[]
  correctionField: (res: { x: number; y: number; dz: number }[], radiusM: number) => { at: (x: number, y: number) => number }
}): AsbuiltFiles {
  if (!ctx.boundary.length) throw new ExportError('Trace the grading limits first.')
  if (!(ctx.fg instanceof TinSurface)) throw new ExportError('Trace the proposed grades (contours, spots or pads) first — the re-fit starts from the design surface.')
  const warnings: string[] = []
  const fg0 = ctx.fg
  const res: { x: number; y: number; dz: number }[] = []
  const residualsFt: number[] = []
  let outside = 0
  for (const s of shots) {
    if (!o.kinds.includes(s.kind)) continue
    const [x, y] = toFrame(ctx.frame, s.lng, s.lat)
    const z = fg0.zAt(x, y)
    if (!Number.isFinite(z)) { outside++; continue }
    const dz = s.zFt * FT - z
    res.push({ x, y, dz })
    residualsFt.push(Math.round((dz / FT) * 1000) / 1000)
  }
  if (!res.length) throw new ExportError('None of the pavement-edge shots fall on the design surface — check the shots are on this site and coded LIP or FL.')
  if (outside) warnings.push(`${outside} shot${outside === 1 ? '' : 's'} fell outside the design surface and were left out.`)
  const mean = residualsFt.reduce((a, b) => a + b, 0) / residualsFt.length
  if (Math.abs(mean) > 0.5) warnings.push(`The shots sit ${Math.abs(mean).toFixed(2)} ft ${mean > 0 ? 'above' : 'below'} the design on average — check the rover and the plan are on the same vertical datum before sending this to a machine.`)
  const radiusM = Math.max(1, o.radiusFt) * FT
  const field = o.correctionField(res, radiusM)
  const refit = refitTin(fg0, res, radiusM, field.at, warnings)
  const { crs, proj, zOut } = crsFor(ctx, o.grid)
  const look = lookups(ctx)
  const inside = (x: number, y: number) => look.boundary.at(x, y) >= 0
  const fg = clipMesh(refit, inside, proj, zOut)
  const empty: Mesh = { e: [], n: [], z: [], faces: [] }
  let stone = empty, sg = empty
  if (!ctx.reduce.length) warnings.push('No paving sections are traced, so there is no stone to cut — trace the paving areas with their thickness on the takeoff.')
  else {
    const asphaltM = Math.max(0, o.asphaltIn) * 0.0254
    const thin = ctx.reduce.filter((r) => r.t < asphaltM - 1e-6)
    if (thin.length) warnings.push(`${thin.length} paving section${thin.length === 1 ? ' is' : 's are'} thinner than the asphalt typed — top of stone there is the section bottom.`)
    const stoneCtx: TakeoffContext = { ...ctx, platforms: [], reduce: ctx.reduce.map((r) => ({ ...r, t: Math.min(r.t, asphaltM) })) }
    const st = subgradeTin(stoneCtx, refit, warnings)
    if (st) stone = clipMesh(st, inside, proj, zOut)
    const sgt = subgradeTin(ctx, refit, warnings)
    if (sgt) sg = clipMesh(sgt, inside, proj, zOut)
  }
  const day = o.now.toISOString().slice(0, 10)
  const landxml = landXmlSurfaces({
    project: o.project, crs, now: o.now, navd88: design.existing.source === 'lidar' && design.existing.offsetFt === 0,
    surfaces: [
      { name: 'Finished grade (as-built fit)', desc: `Design finished grade re-fit to ${res.length} as-built pavement-edge shots, ${day}`, mesh: fg },
      { name: 'Top of stone', desc: `Finished grade less ${o.asphaltIn}" asphalt under the paving sections`, mesh: stone },
      { name: 'Subgrade', desc: 'Finished grade less the full section under paving; pads at subgrade', mesh: sg },
    ],
  })
  return { landxml, crs, warnings, residualsFt, faces: { fg: fg.faces.length / 3, stone: stone.faces.length / 3, sg: sg.faces.length / 3 } }
}
