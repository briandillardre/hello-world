/**
 * Rover / total-station shots — pure. Reads what a data collector exports
 * (Point, Northing, Easting, Elevation, Code — in any column order, comma,
 * tab or space separated, with or without a header) into points on the map.
 *
 *  - Coordinates: SC State Plane (EPSG 2273, international feet — the grid
 *    every SC rover ships set to) or plain lat / lng. Northing and easting
 *    swapped in the export are put right (an SC easting is ~1.3–2.5 M ft, a
 *    northing ~0.2–1.2 M); a local site grid (0–100,000) is refused, because
 *    no math can place it on the ground.
 *  - Elevations in feet.
 *  - The code says what the shot is ON: LIP (gutter lip / edge of pavement),
 *    FL (flowline), BOC/TOC (back / top of curb), CP (control / ground
 *    control point), SPOT (anything else). The as-built re-fit uses the
 *    pavement-edge shots; the drone check reports every kind separately.
 */
import { fromStatePlane, plausibleSC } from '../plans/stateplane'

export type ShotKind = 'lip' | 'flowline' | 'curb_top' | 'control' | 'spot'
export const KIND_WORDS: Record<ShotKind, string> = {
  lip: 'Gutter lip / edge of pavement', flowline: 'Flowline', curb_top: 'Top / back of curb', control: 'Control point', spot: 'Spot',
}
export interface Shot { id: string; lng: number; lat: number; z: number; code: string; kind: ShotKind }
export interface ShotParse { shots: Shot[]; coords: 'sc_ft' | 'lnglat' | null; problems: string[]; skipped: number }

export const MAX_SHOTS = 5000

export function kindOf(code: string): ShotKind {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, ' ').trim()
  const has = (re: RegExp) => re.test(c)
  if (has(/\b(LIP|EOP|EP|GL|GUTTER\s*LIP|EDGE)\b/)) return 'lip'
  if (has(/\b(FL|FLOW\s*LINE|FLOWLINE|GUT|GUTTER)\b/)) return 'flowline'
  if (has(/\b(BOC|TOC|TBC|BC|TC|CURB|TOP\s*CURB|BACK\s*CURB)\b/)) return 'curb_top'
  if (has(/\b(CP|GCP|CTRL|CONTROL|BM|TBM|BENCH)\b/)) return 'control'
  return 'spot'
}

const HEAD: Record<string, RegExp> = {
  id: /^(p|pt|pnt|point|pointno|point\s*#|name|id|no|number)$/,
  n: /^(n|north|northing|y)$/,
  e: /^(e|east|easting|x)$/,
  z: /^(z|el|elev|elevation|height|h)$/,
  code: /^(code|desc|description|feature|d|note)$/,
  lat: /^(lat|latitude)$/,
  lng: /^(lng|lon|long|longitude)$/,
}

const num = (s: string | undefined) => {
  if (s === undefined) return NaN
  const t = s.replace(/[,$'"\s]/g, '')
  return t === '' ? NaN : Number(t)
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((x) => x.trim())
  if (line.includes(',')) {
    // quoted CSV
    const out: string[] = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  return line.trim().split(/\s+/)
}

/** Read pasted shots. Columns by header when there is one, else P,N,E,Z,CODE (the PNEZD default). */
export function parseShots(text: string): ShotParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const problems: string[] = []
  if (!lines.length) return { shots: [], coords: null, problems: ['Nothing pasted.'], skipped: 0 }
  const first = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z#\s]/g, '').trim())
  const col: Partial<Record<keyof typeof HEAD, number>> = {}
  first.forEach((h, i) => { for (const [k, re] of Object.entries(HEAD)) if (re.test(h) && col[k as keyof typeof HEAD] === undefined) col[k as keyof typeof HEAD] = i })
  const hasHeader = Object.keys(col).length >= 2 && first.every((h) => !/^-?\d/.test(h))
  const body = hasHeader ? lines.slice(1) : lines
  const byLatLng = hasHeader && col.lat !== undefined && col.lng !== undefined
  const C = hasHeader ? col : { id: 0, n: 1, e: 2, z: 3, code: 4 }
  if (hasHeader && !byLatLng && (C.n === undefined || C.e === undefined)) return { shots: [], coords: null, problems: ['No Northing / Easting (or Latitude / Longitude) column found.'], skipped: 0 }
  if (hasHeader && C.z === undefined) return { shots: [], coords: null, problems: ['No Elevation column found.'], skipped: 0 }
  const shots: Shot[] = []
  let skipped = 0, swapped = 0, local = 0
  const lines2 = body.slice(0, MAX_SHOTS + 1)
  for (let i = 0; i < lines2.length; i++) {
    const line = lines2[i]
    if (shots.length >= MAX_SHOTS) { problems.push(`Only the first ${MAX_SHOTS.toLocaleString('en-US')} shots are read.`); break }
    const c = splitLine(line)
    const z = num(c[C.z!])
    const code = (C.code !== undefined ? c[C.code] ?? '' : c.slice(4).join(' ')).trim().slice(0, 40)
    const id = (C.id !== undefined ? c[C.id] : String(i + 1))?.trim().slice(0, 24) || String(i + 1)
    let lng: number, lat: number
    if (byLatLng) {
      lat = num(c[C.lat!]); lng = num(c[C.lng!])
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) { skipped++; continue }
    } else {
      let n = num(c[C.n!]), e = num(c[C.e!])
      if (!Number.isFinite(n) || !Number.isFinite(e)) { skipped++; continue }
      if (!plausibleSC(e, n) && plausibleSC(n, e)) { const t = n; n = e; e = t; swapped++ }
      if (!plausibleSC(e, n)) { if (Math.abs(e) < 200_000 && Math.abs(n) < 200_000) local++; skipped++; continue }
      ;[lng, lat] = fromStatePlane(e, n)
    }
    if (!Number.isFinite(z) || z < -500 || z > 15_000) { skipped++; continue }
    shots.push({ id, lng: round(lng, 8), lat: round(lat, 8), z: round(z, 3), code, kind: kindOf(code) })
  }
  if (swapped) problems.push(`${swapped} shots had northing and easting swapped — put right.`)
  if (local) problems.push(`${local} shots look like a local site grid (small numbers), not SC State Plane — export them in State Plane feet or lat/lng.`)
  if (skipped && !local) problems.push(`${skipped} lines couldn’t be read and were skipped.`)
  return { shots, coords: byLatLng ? 'lnglat' : 'sc_ft', problems, skipped }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** Clean shots stored or posted as JSON (the server re-checks everything). */
export function cleanShots(raw: unknown): Shot[] {
  if (!Array.isArray(raw)) return []
  const out: Shot[] = []
  for (const r of raw.slice(0, MAX_SHOTS)) {
    if (!r || typeof r !== 'object') continue
    const s = r as Record<string, unknown>
    const lng = Number(s.lng), lat = Number(s.lat), z = Number(s.z)
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && Number.isFinite(z) && z > -500 && z < 15_000)) continue
    const code = typeof s.code === 'string' ? s.code.slice(0, 40) : ''
    out.push({ id: typeof s.id === 'string' ? s.id.slice(0, 24) : String(out.length + 1), lng, lat, z, code, kind: kindOf(code) })
  }
  return out
}

export function shotCounts(shots: Shot[]): Record<ShotKind, number> {
  const c: Record<ShotKind, number> = { lip: 0, flowline: 0, curb_top: 0, control: 0, spot: 0 }
  for (const s of shots) c[s.kind]++
  return c
}
