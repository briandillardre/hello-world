/** A flespi message is a flat bag of telemetry params; field names vary by device. */
export interface FlespiMessage {
  ident?: string // device identifier (IMEI) — mapped to tracker_id
  'device.id'?: number
  'position.latitude'?: number
  'position.longitude'?: number
  'position.speed'?: number
  'position.direction'?: number
  'position.altitude'?: number
  'battery.level'?: number
  'battery.voltage'?: number
  'engine.ignition.status'?: boolean
  'movement.status'?: boolean
  timestamp?: number // unix seconds
  // BLE beacons can arrive in several shapes depending on device/config:
  'ble.beacons'?: Array<{ id?: string; mac?: string; rssi?: number }>
  [key: string]: unknown
}

export interface NormalizedReading {
  tracker_id: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  /** Meters above sea level, straight from the GNSS fix. */
  altitude: number | null
  battery: number | null
  timestamp: string
  beacons: { id: string; rssi: number | null }[]
  /** Everything else the tracker reported (OBD PIDs, voltages, ignition,
   *  movement, odometer, DTCs…) — persisted so no telemetry is lost. */
  params: Record<string, unknown>
}

// Position fields are lifted into dedicated columns; skip them in the params
// bag. Everything else (can.*, obd.*, engine.*, battery.*, movement.*, …) is
// kept verbatim under the tracker's own field names.
const LIFTED = new Set([
  'ident', 'device.id', 'timestamp',
  'position.latitude', 'position.longitude', 'position.speed', 'position.direction', 'position.altitude',
])

function voltageToPercent(v: number): number {
  // Rough 3xAA Li (Oyster) / backup-cell mapping, clamped 0-100.
  const pct = ((v - 3.3) / (4.2 - 3.3)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/**
 * Normalize a single flespi message into our internal reading shape, handling
 * both Teltonika FMM130 and Digital Matter Oyster3 field conventions. Returns
 * null when the message lacks a usable identifier or valid coordinates.
 */
export function normalizeMessage(msg: FlespiMessage): NormalizedReading | null {
  const tracker_id = msg.ident ?? (msg['device.id'] != null ? String(msg['device.id']) : undefined)
  const lat = msg['position.latitude']
  const lng = msg['position.longitude']
  if (!tracker_id || typeof lat !== 'number' || typeof lng !== 'number') return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  let battery: number | null = null
  if (typeof msg['battery.level'] === 'number') battery = Math.round(msg['battery.level'])
  else if (typeof msg['battery.voltage'] === 'number') battery = voltageToPercent(msg['battery.voltage'])

  const beacons: NormalizedReading['beacons'] = []
  const rawBeacons = msg['ble.beacons']
  if (Array.isArray(rawBeacons)) {
    for (const b of rawBeacons) {
      const id = b.id ?? b.mac
      if (id) beacons.push({ id, rssi: typeof b.rssi === 'number' ? b.rssi : null })
    }
  }
  // Also support flattened "ble.sensor.<n>.id" style fields.
  for (const [k, v] of Object.entries(msg)) {
    const m = k.match(/^ble\.sensor\.(\d+)\.(id|mac)$/)
    if (m && typeof v === 'string') {
      const rssi = msg[`ble.sensor.${m[1]}.rssi`]
      beacons.push({ id: v, rssi: typeof rssi === 'number' ? rssi : null })
    }
  }

  // Preserve all remaining scalar telemetry (OBD, power, events, cellular…).
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(msg)) {
    if (LIFTED.has(k)) continue
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      params[k] = v
    }
  }
  // Keep the beacon list in raw too — the scalar filter above silently
  // dropped it, which made /diag read "ble: none" while beacons were in
  // fact arriving (cost an hour of hardware-side debugging on Jul 14).
  if (beacons.length) params['ble.beacons'] = beacons

  return {
    tracker_id,
    lat,
    lng,
    // flespi/Teltonika report position.speed in KM/H; the app standard is MPH
    // (phone tracking already converts). 97 km/h displayed as "97 mph" made a
    // VW Atlas look like a felony — convert at the door.
    speed: typeof msg['position.speed'] === 'number' ? Math.round(msg['position.speed'] * 0.621371) : null,
    heading: typeof msg['position.direction'] === 'number' ? msg['position.direction'] : null,
    altitude: typeof msg['position.altitude'] === 'number' ? Math.round(msg['position.altitude']) : null,
    battery,
    timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
    beacons,
    params,
  }
}
