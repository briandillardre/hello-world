/**
 * Borings pasted from a geotech report's summary table, a spreadsheet or a
 * CSV — pure. Headings are matched by alias (column order never matters); a
 * place is latitude/longitude, or SC State Plane northing/easting
 * (international feet, the grid SC civil plans print). Values read the way
 * logs write them: `6.5'`, `4"`, `@ 12 ft`, and "None" / "NE" / "Dry" / "—"
 * for a layer not encountered.
 */
import { parseDelimited } from '../bulk-import'
import { fromStatePlane, plausibleSC } from '../plans/stateplane'

export interface BoringFields {
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
  note: string | null
}

export interface PasteResult {
  rows: { line: number; boring: BoringFields }[]
  skipped: { line: number; why: string }[]
  /** The headings it understood, in words. */
  columns: string[]
  error?: string
}

export const MAX_PASTE_ROWS = 200

type Key = 'name' | 'kind' | 'lat' | 'lng' | 'northing' | 'easting' | 'groundFt' | 'depthFt' | 'topsoilIn' | 'fillFt' | 'pwrFt' | 'refusalFt' | 'waterFt' | 'water24hFt' | 'unsuitableFt' | 'note'

const ALIASES: Record<Key, string[]> = {
  name: ['name', 'boring', 'boringno', 'boringnumber', 'boringid', 'boringname', 'boringlocation', 'id', 'location', 'locationid', 'testlocation', 'pit', 'pitno', 'testpit', 'testpitno', 'tp', 'hole', 'holeid', 'point', 'no', 'number'],
  kind: ['kind', 'type', 'boringorpit'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  northing: ['northing', 'north', 'n', 'y', 'spn', 'stateplanen', 'stateplanenorthing'],
  easting: ['easting', 'east', 'e', 'x', 'spe', 'stateplanee', 'stateplaneeasting'],
  groundFt: ['ground', 'groundelev', 'groundelevation', 'groundsurface', 'groundsurfaceelev', 'groundsurfaceelevation', 'elev', 'elevation', 'surface', 'surfaceelev', 'surfaceelevation', 'gse', 'grade', 'existinggrade'],
  depthFt: ['depth', 'totaldepth', 'td', 'boringdepth', 'termination', 'terminationdepth', 'bottom', 'depthdrilled', 'maxdepth'],
  topsoilIn: ['topsoil', 'topsoilthickness', 'topsoildepth', 'organics'],
  fillFt: ['fill', 'existingfill', 'filldepth', 'fillto', 'existingfillto'],
  pwrFt: ['pwr', 'pwrat', 'pwrdepth', 'depthtopwr', 'partiallyweatheredrock', 'weatheredrock'],
  refusalFt: ['refusal', 'refusalat', 'augerrefusal', 'refusaldepth', 'depthtorefusal', 'rock', 'rockdepth', 'depthtorock'],
  waterFt: ['water', 'groundwater', 'gw', 'waterdepth', 'depthtowater', 'wateratdrilling', 'atdrilling', 'atcompletion', 'gwatdrilling', 'groundwateratdrilling', 'groundwateratcompletion', 'waterlevelatcompletion', 'waterlevelatdrilling', 'wl', 'waterlevel'],
  water24hFt: ['water24', 'water24h', 'water24hr', 'waterat24h', 'waterat24hr', 'waterat24hrs', 'waterat24hours', 'water24hrs', 'water24hour', 'water24hours', '24hr', '24hrs', '24h', '24hour', 'gw24', 'gw24hr', 'wl24hr', 'waterlevel24hr', 'after24hr', 'after24hours', 'groundwater24', 'groundwater24h', 'groundwater24hr', 'groundwater24hrs', 'groundwater24hour', 'groundwater24hours'],
  unsuitableFt: ['unsuitable', 'undercut', 'unsuitabledepth', 'unsuitablesoil', 'unsuitablesoildepth', 'unsuitableto', 'undercutdepth'],
  note: ['note', 'notes', 'remarks', 'remark', 'comment', 'comments', 'description'],
}

/** The words the panel echoes back — every one of them is also a heading it reads (harness-checked). */
export const WORDS: Record<Key, string> = {
  name: 'name', kind: 'boring or pit', lat: 'latitude', lng: 'longitude', northing: 'northing', easting: 'easting',
  groundFt: 'ground elevation', depthFt: 'depth', topsoilIn: 'topsoil (in)', fillFt: 'existing fill to', pwrFt: 'PWR at',
  refusalFt: 'refusal at', waterFt: 'water at drilling', water24hFt: 'water at 24 h', unsuitableFt: 'unsuitable to', note: 'note',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const UNIT = /(ft|feet|in|inch|inches)$/

function keyFor(heading: string): Key | null {
  const n = norm(heading)
  if (!n) return null
  const tries = [n]
  const stripped = n.replace(UNIT, '')
  if (stripped && stripped !== n) tries.push(stripped)
  for (const t of tries) for (const k of Object.keys(ALIASES) as Key[]) if (ALIASES[k].includes(t)) return k
  return null
}

/** "None", "NE", "Dry", "—", blank: not encountered. */
const NOT_FOUND = /^(none|ne|n\/?e|na|n\/a|nr|dry|not\s*encountered|no\s*\w*|nil|-+|—|–)$/i

/** A logged depth or elevation: `6.5'`, `4"`, `@ 12 ft`, `12.0 ft bgs`; null when not encountered. */
export function readNumber(raw: string): number | null | 'bad' {
  const s = raw.trim()
  if (!s || NOT_FOUND.test(s)) return null
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return 'bad'
  const v = Number(m[0])
  return Number.isFinite(v) ? v : 'bad'
}

/** What's wrong with a boring, in words, or null when it is fine. */
export function boringProblem(b: BoringFields): string | null {
  const who = b.name || 'This boring'
  if (!b.name || b.name.length > 40) return 'A boring needs a name of up to 40 characters (B-1, TP-3…).'
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return `${who}: its place isn't a latitude and longitude.`
  if (!Number.isFinite(b.depthFt) || b.depthFt <= 0 || b.depthFt > 500) return `${who}: how deep it went is needed (up to 500 ft).`
  if (b.groundFt !== null && (b.groundFt < -500 || b.groundFt > 20000)) return `${who}: a ground elevation of ${b.groundFt} ft can't be right.`
  const within = (v: number | null, what: string, cap: number) => {
    if (v === null) return null
    if (v < 0) return `${who}: ${what} can't be negative.`
    if (v > Math.min(cap, b.depthFt)) return `${who}: ${what} at ${v} ft is deeper than the boring went (${b.depthFt} ft).`
    return null
  }
  if (b.topsoilIn !== null && (b.topsoilIn < 0 || b.topsoilIn > 120)) return `${who}: topsoil is in inches, 0 to 120.`
  if (b.topsoilIn !== null && b.topsoilIn / 12 > b.depthFt) return `${who}: ${b.topsoilIn} in of topsoil is deeper than the boring went.`
  const why = within(b.fillFt, 'existing fill', 200) ?? within(b.unsuitableFt, 'unsuitable soil', 100)
    ?? within(b.pwrFt, 'PWR', 500) ?? within(b.refusalFt, 'refusal', 500) ?? within(b.waterFt, 'water', 500)
  if (why) return why
  if (b.water24hFt !== null && (b.water24hFt < 0 || b.water24hFt > 500)) return `${who}: the 24-hour water reading can't be right.`
  if (b.pwrFt !== null && b.refusalFt !== null && b.pwrFt > b.refusalFt) return `${who}: PWR at ${b.pwrFt} ft is below refusal at ${b.refusalFt} ft — refusal ends the boring.`
  return null
}

/** A pasted table → borings, each with its line number, or why it was skipped. */
export function parseBorings(text: string): PasteResult {
  const rows = parseDelimited(String(text ?? '').slice(0, 200_000))
  const out: PasteResult = { rows: [], skipped: [], columns: [] }
  if (!rows.length) return { ...out, error: 'Paste the borings table — a header row (Name, Lat, Lng, Depth…) and one row per boring.' }
  // The header is the first row that names a boring column and a depth or a place.
  let head = -1
  let cols: (Key | null)[] = []
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const ks = rows[i].map(keyFor)
    const has = (k: Key) => ks.includes(k)
    if (has('name') && (has('depthFt') || has('lat') || has('northing'))) { head = i; cols = ks; break }
  }
  if (head < 0) return { ...out, error: 'Add a header row first — Name, Lat, Lng (or Northing, Easting), Depth, and any of Ground, Topsoil, Fill, PWR, Refusal, Water, Unsuitable.' }
  const seen = new Set<Key>()
  cols = cols.map((k) => (k && !seen.has(k) ? (seen.add(k), k) : null)) // the first column of each kind wins
  out.columns = cols.filter((k): k is Key => !!k).map((k) => WORDS[k])
  if (!seen.has('depthFt')) return { ...out, error: 'The table needs a Depth column — how deep each boring went.' }
  if (!(seen.has('lat') && seen.has('lng')) && !(seen.has('northing') && seen.has('easting'))) return { ...out, error: 'The table needs where each boring is — Lat and Lng, or Northing and Easting (SC State Plane, feet).' }
  const body = rows.slice(head + 1)
  for (let r = 0; r < body.length; r++) {
    const line = head + r + 2
    const cells = body[r]
    if (cells.every((c) => !c.trim())) continue
    if (out.rows.length >= MAX_PASTE_ROWS) { out.skipped.push({ line, why: `Only ${MAX_PASTE_ROWS} borings at a time — paste the rest separately.` }); break }
    const get = (k: Key) => { const i = cols.indexOf(k); return i >= 0 ? (cells[i] ?? '').trim() : '' }
    const name = get('name').replace(/\s+/g, ' ').slice(0, 41)
    if (!name) { out.skipped.push({ line, why: 'No name.' }); continue }
    const nums: Partial<Record<Key, number | null>> = {}
    let bad: string | null = null
    for (const k of ['lat', 'lng', 'northing', 'easting', 'groundFt', 'depthFt', 'topsoilIn', 'fillFt', 'pwrFt', 'refusalFt', 'waterFt', 'water24hFt', 'unsuitableFt'] as Key[]) {
      const v = readNumber(get(k))
      if (v === 'bad') { bad = `${name}: "${get(k)}" isn't a number (${WORDS[k]}).`; break }
      nums[k] = v
    }
    if (bad) { out.skipped.push({ line, why: bad }); continue }
    let lat = nums.lat ?? null, lng = nums.lng ?? null
    if (lat === null || lng === null) {
      let e = nums.easting ?? null, n = nums.northing ?? null
      if (e === null || n === null) { out.skipped.push({ line, why: `${name}: no place — needs Lat and Lng, or Northing and Easting.` }); continue }
      if (!plausibleSC(e, n) && plausibleSC(n, e)) [e, n] = [n, e]
      if (!plausibleSC(e, n)) { out.skipped.push({ line, why: `${name}: N ${n} / E ${e} look like a local site grid, not SC State Plane — add latitude and longitude.` }); continue }
      ;[lng, lat] = fromStatePlane(e, n)
    }
    const kindRaw = get('kind')
    const kind: 'boring' | 'pit' = /pit|^tp$/i.test(kindRaw) || (!kindRaw && /^(tp|pit)\b|^tp-?\d/i.test(name)) ? 'pit' : 'boring'
    const boring: BoringFields = {
      name, kind, lat, lng,
      groundFt: nums.groundFt ?? null, depthFt: nums.depthFt ?? NaN,
      topsoilIn: nums.topsoilIn ?? null, fillFt: nums.fillFt ?? null, pwrFt: nums.pwrFt ?? null, refusalFt: nums.refusalFt ?? null,
      waterFt: nums.waterFt ?? null, water24hFt: nums.water24hFt ?? null, unsuitableFt: nums.unsuitableFt ?? null,
      note: get('note').slice(0, 500) || null,
    }
    // A boring that stopped at refusal with no depth given went to its refusal.
    if (!Number.isFinite(boring.depthFt) && boring.refusalFt !== null) boring.depthFt = boring.refusalFt
    const why = boringProblem(boring)
    if (why) { out.skipped.push({ line, why }); continue }
    out.rows.push({ line, boring })
  }
  return out
}
