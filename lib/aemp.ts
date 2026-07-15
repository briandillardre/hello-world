/**
 * ISO 15143-3 (AEMP 2.0) — mixed-fleet construction-equipment telematics.
 *
 * Most major OEMs (Komatsu/KOMTRAX, Link-Belt/RemoteCARE, Cat/VisionLink,
 * CNH/FleetForce, Bomag/Telematic, Wirtgen/WITOS) expose engine hours, location,
 * fuel, idle and fault codes over this ONE standardized REST feed. We pull those
 * feeds and normalize them into the same reading shape the flespi pipeline uses
 * — so a Komatsu dozer and a Teltonika-tracked pickup land in the same map,
 * timeline and maintenance meter with zero per-brand plumbing downstream.
 *
 * The Fleet response is a page of `Equipment[]`, each a bag of optional
 * telemetry objects, plus a `Links[]` block for pagination. OEMs vary the
 * casing and occasionally the exact field names, so every reader here is
 * tolerant: case-insensitive key lookup + a list of accepted aliases. Verified
 * against a real Cat ISO 15143-3 sample (EquipmentHeader / Location /
 * CumulativeOperatingHours / Distance / FuelUsed / FuelRemaining / EngineStatus).
 */

/** One machine's normalized snapshot — OEM-agnostic. */
export interface AempReading {
  equipmentId: string | null
  oem: string | null
  model: string | null
  serial: string | null
  pin: string | null
  lat: number | null
  lng: number | null
  altitude: number | null
  /** Best available datetime across the machine's sub-records, ISO string. */
  timestamp: string
  engineHours: number | null
  idleHours: number | null
  odometerKm: number | null
  fuelPct: number | null
  fuelUsedL: number | null
  defPct: number | null
  engineRunning: boolean | null
  faults: AempFault[]
  /** Flattened dotted view of everything, kept verbatim for raw storage. */
  params: Record<string, unknown>
}

export interface AempFault {
  spn: number | null
  fmi: number | null
  mid: number | null
  /** Occurrence count (OC / OccurrenceCount). */
  oc: number | null
  severity: string | null
  description: string | null
  datetime: string | null
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Case-insensitive lookup of the first present alias on an object. */
function pick(o: Obj | null, ...keys: string[]): unknown {
  if (!o) return undefined
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]))
  for (const k of keys) {
    const hit = lower.get(k.toLowerCase())
    if (hit !== undefined && o[hit] !== undefined && o[hit] !== null) return o[hit]
  }
  return undefined
}

function pickObj(o: Obj | null, ...keys: string[]): Obj | null {
  const v = pick(o, ...keys)
  return isObj(v) ? v : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'on', 'running', '1', 'yes'].includes(s)) return true
    if (['false', 'off', 'stopped', '0', 'no'].includes(s)) return false
  }
  if (typeof v === 'number') return v !== 0
  return null
}

/** Kilometres, converting from the record's declared unit when it's miles. */
function toKm(value: number | null, unit: unknown): number | null {
  if (value == null) return null
  const u = String(unit ?? '').toLowerCase()
  if (u.startsWith('mile') || u === 'mi') return value * 1.60934
  return value
}

/** Litres, converting from gallons when the record says so. */
function toLitres(value: number | null, unit: unknown): number | null {
  if (value == null) return null
  const u = String(unit ?? '').toLowerCase()
  if (u.startsWith('gal')) return value * 3.78541
  return value
}

/** Flatten nested objects into dotted keys so nothing is lost in raw storage. */
function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (isObj(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else if (Array.isArray(o)) {
    out[prefix] = o // keep arrays (fault lists) intact
  } else {
    out[prefix] = o
  }
  return out
}

function parseFaults(raw: unknown): AempFault[] {
  if (!Array.isArray(raw)) return []
  const faults: AempFault[] = []
  for (const f of raw) {
    if (!isObj(f)) continue
    faults.push({
      spn: num(pick(f, 'SPN', 'Spn')),
      fmi: num(pick(f, 'FMI', 'Fmi')),
      mid: num(pick(f, 'MID', 'Mid')),
      oc: num(pick(f, 'OC', 'OccurrenceCount', 'Occurrence')),
      severity: str(pick(f, 'SeverityLevel', 'Severity')),
      description: str(pick(f, 'FaultDescription', 'Description', 'FaultCode')),
      datetime: str(pick(f, 'Datetime', 'DateTime', 'dateTime')),
    })
  }
  return faults
}

/** Normalize a single ISO 15143-3 Equipment object into an AempReading. */
export function normalizeEquipment(eq: Obj): AempReading {
  const header = pickObj(eq, 'EquipmentHeader', 'Header')
  const loc = pickObj(eq, 'Location', 'LastKnownLocation')
  const hours = pickObj(eq, 'CumulativeOperatingHours', 'OperatingHours', 'EngineHours')
  const idle = pickObj(eq, 'CumulativeIdleHours', 'IdleHours')
  const dist = pickObj(eq, 'Distance', 'CumulativeDistance', 'Odometer')
  const fuelUsed = pickObj(eq, 'FuelUsed', 'CumulativeFuelUsed')
  const fuelRem = pickObj(eq, 'FuelRemaining', 'FuelLevel')
  const defRem = pickObj(eq, 'DEFRemaining', 'DefRemaining')
  const engine = pickObj(eq, 'EngineStatus', 'EngineCondition')

  const lat = num(pick(loc, 'Latitude', 'Lat'))
  const lng = num(pick(loc, 'Longitude', 'Lon', 'Lng'))

  // Best timestamp: prefer the position fix, else engine, else any sub-record.
  const timestamp =
    str(pick(loc, 'Datetime', 'DateTime')) ??
    str(pick(engine, 'Datetime', 'DateTime')) ??
    str(pick(hours, 'Datetime', 'DateTime')) ??
    str(pick(eq, 'Datetime', 'DateTime')) ??
    new Date().toISOString()

  return {
    equipmentId: str(pick(header, 'EquipmentID', 'EquipmentId', 'UnitInstanceID', 'AssetID')),
    oem: str(pick(header, 'OEMName', 'OEM', 'Make', 'Manufacturer')),
    model: str(pick(header, 'Model')),
    serial: str(pick(header, 'SerialNumber', 'Serial')),
    pin: str(pick(header, 'PIN', 'Pin', 'VIN')),
    lat,
    lng,
    altitude: num(pick(loc, 'Altitude', 'Alt')),
    timestamp: normalizeIso(timestamp),
    engineHours: num(pick(hours, 'Hour', 'Hours', 'Value')),
    idleHours: num(pick(idle, 'Hour', 'Hours', 'Value')),
    odometerKm: toKm(num(pick(dist, 'Odometer', 'Distance', 'Value')), pick(dist, 'OdometerUnits', 'Units', 'Unit')),
    fuelPct: num(pick(fuelRem, 'Percent', 'Percentage', 'Ratio', 'Value')),
    fuelUsedL: toLitres(num(pick(fuelUsed, 'FuelConsumed', 'Consumed', 'Value')), pick(fuelUsed, 'FuelUnits', 'Units', 'Unit')),
    defPct: num(pick(defRem, 'Percent', 'Percentage', 'Ratio', 'Value')),
    engineRunning: bool(pick(engine, 'Running', 'Status', 'State')),
    faults: parseFaults(pick(eq, 'FaultCodes', 'Faults', 'FaultCode')),
    params: flatten(eq),
  }
}

/** Coerce whatever the OEM sent into an ISO string; fall back to now on junk. */
function normalizeIso(s: string): string {
  const t = Date.parse(s)
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString()
}

/** Parse a full Fleet page. Accepts the object form or a bare Equipment array. */
export function parseAempFleet(json: unknown): AempReading[] {
  const list = Array.isArray(json)
    ? json
    : isObj(json)
    ? (pick(json, 'Equipment', 'Fleet', 'Assets') as unknown)
    : null
  if (!Array.isArray(list)) return []
  return list.filter(isObj).map(normalizeEquipment)
}

/**
 * Next-page URL from the `Links[]` block. Returns null when there's no distinct
 * Next link (last page), guarding against a Next that points back at Current so
 * a mis-behaving feed can't loop us forever.
 */
export function nextLink(json: unknown, currentUrl: string): string | null {
  if (!isObj(json)) return null
  const links = pick(json, 'Links', 'links')
  if (!Array.isArray(links)) return null
  let current = currentUrl
  let next: string | null = null
  for (const l of links) {
    if (!isObj(l)) continue
    const rel = String(pick(l, 'Rel', 'rel') ?? '').toLowerCase()
    const href = str(pick(l, 'Href', 'href'))
    if (!href) continue
    if (rel === 'next') next = href
    if (rel === 'current' || rel === 'self') current = href
  }
  if (!next || next === current || next === currentUrl) return null
  return next
}
