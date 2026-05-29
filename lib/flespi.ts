/** A flespi message is a flat bag of telemetry params; field names vary by device. */
export interface FlespiMessage {
  ident?: string // device identifier (IMEI) — mapped to tracker_id
  'device.id'?: number
  'position.latitude'?: number
  'position.longitude'?: number
  'position.speed'?: number
  'position.direction'?: number
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
  battery: number | null
  timestamp: string
  beacons: { id: string; rssi: number | null }[]
}

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

  return {
    tracker_id,
    lat,
    lng,
    speed: typeof msg['position.speed'] === 'number' ? msg['position.speed'] : null,
    heading: typeof msg['position.direction'] === 'number' ? msg['position.direction'] : null,
    battery,
    timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
    beacons,
  }
}
