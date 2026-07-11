import type { AssetUtilization, AssetWithLocation, Geofence } from '../types'
import { getLocationHistory } from './assets'
import { pointInPolygon } from '../alerts-engine'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const MAX_ACTIVE_GAP_MS = 10 * 60_000    // don't bill a sleep gap as active
const MAX_IDLE_GAP_MS = 2 * 3_600_000    // engine-off hourly check-ins count as idle
const MIN_ACTIVE_SPEED = 1
const MIN_MOVE_METERS = 25

/**
 * Real utilization over `sinceIso` from asset_locations: active (moving) hours,
 * idle hours, miles driven, and hours per job-site geofence — computed by
 * walking consecutive pings per asset. Returns null in demo mode so the page
 * falls back to the mock dataset.
 *
 * Note: "active hours" is GPS-movement time (a truthful proxy). True engine
 * hours need CAN/ignition, which we now capture in asset_locations.raw and can
 * fold in later.
 */
export async function getUtilization(
  companyId: string,
  sinceIso: string,
  assets: AssetWithLocation[],
  geofences: Geofence[]
): Promise<AssetUtilization[] | null> {
  if (isMock) return null
  const history = await getLocationHistory(companyId, sinceIso, 20000)
  if (!history) return null

  const rings = geofences
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ id: g.id, name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
    .filter((g) => g.ring.length >= 3)

  const byAsset = new Map<string, typeof history>()
  for (const r of history) {
    if (!byAsset.has(r.asset_id)) byAsset.set(r.asset_id, [])
    byAsset.get(r.asset_id)!.push(r)
  }

  const out: AssetUtilization[] = []
  for (const asset of assets) {
    const rows = (byAsset.get(asset.id) ?? []).slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    if (rows.length < 2) continue

    let activeMs = 0
    let idleMs = 0
    let meters = 0
    const siteMs: Record<string, number> = {}

    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]
      const b = rows[i]
      const dt = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      if (dt <= 0 || dt > MAX_IDLE_GAP_MS) continue
      const dist = haversineMeters(a.lat, a.lng, b.lat, b.lng)
      const moving = (b.speed ?? 0) > MIN_ACTIVE_SPEED || dist > MIN_MOVE_METERS
      if (moving && dt <= MAX_ACTIVE_GAP_MS) {
        activeMs += dt
        meters += dist
      } else if (!moving) {
        idleMs += dt
      }
      // Attribute present-time to whichever job site contains this fix.
      for (const g of rings) {
        if (pointInPolygon([b.lng, b.lat], g.ring)) {
          siteMs[g.id] = (siteMs[g.id] ?? 0) + dt
          break
        }
      }
    }

    const job_site_hours = rings
      .filter((g) => (siteMs[g.id] ?? 0) > 0)
      .map((g) => ({ geofence_id: g.id, geofence_name: g.name, hours: Math.round((siteMs[g.id] / 3_600_000) * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours)

    out.push({
      asset_id: asset.id,
      asset_name: asset.name,
      asset_type: asset.type,
      engine_hours: Math.round((activeMs / 3_600_000) * 10) / 10,
      idle_hours: Math.round((idleMs / 3_600_000) * 10) / 10,
      distance_miles: Math.round((meters / 1609.34) * 10) / 10,
      job_site_hours,
    })
  }

  // Busiest first.
  return out.sort((a, b) => b.engine_hours - a.engine_hours)
}
