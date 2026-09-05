import { AssetList } from '@/components/assets/AssetList'
import { requireFeature } from '@/lib/permissions-server'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, toolsAboard } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { pointInPolygon } from '@/lib/alerts-engine'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import { lookupCachedPlaces } from '@/lib/reverse-geocode'
import { placeKey, formatPlace } from '@/lib/place-label'

export const metadata = { title: 'HammerTrack — Assets' }

export default async function AssetsPage() {
  await requireFeature('assets')
  const companyId = await getCurrentCompanyId()
  const [rawAssets, toolAssociations, geofences, schedules, readings] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
    getGeofences(companyId),
    getMaintenanceSchedules(companyId),
    getCurrentReadings(),
  ])
  const located = resolveToolLocations(rawAssets, toolAssociations)

  // Which zone each asset sits in right now — same containment test the zones
  // page runs. The list leads with "at Creekside" instead of the IMEI.
  const zoneNames: Record<string, string> = {}
  // Boundaries excluded (same convention as the AI's place naming): a
  // property boundary ringing every site would otherwise win first-match and
  // stamp every row "at Property Boundary" (ship-check P2).
  const namedZones = geofences.filter((g) => g.kind !== 'boundary')
  for (const a of located) {
    if (!a.location) continue
    for (const g of namedZones) {
      const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
      if (ring && pointInPolygon([a.location.lng, a.location.lat], ring)) {
        zoneNames[a.id] = g.name
        break
      }
    }
  }

  // Off-zone rows: what the geocode cache already knows, so the list renders
  // with its place names instead of popping them in. New spots fill in
  // client-side through /api/reverse-geocode (one table read here, no
  // network on the render path).
  const offZone = located.filter((a) => a.location && !zoneNames[a.id])
  const cached = await lookupCachedPlaces(offZone.map((a) => placeKey(a.location!.lat, a.location!.lng)))
  const placeNames: Record<string, string> = {}
  for (const a of offZone) {
    const label = formatPlace(cached[placeKey(a.location!.lat, a.location!.lng)])
    if (label) placeNames[a.id] = label
  }

  // Overdue service per asset (same computeStatus the detail page runs) —
  // drives the 🛠 chip and the "Needs attention" filter.
  const overdue: Record<string, number> = {}
  for (const s of schedules) {
    const st = computeStatus(s, readings[s.asset_id] ?? s.last_service_value)
    if (st.status === 'overdue') overdue[s.asset_id] = (overdue[s.asset_id] ?? 0) + 1
  }
  const assets = located.map((a) => ({ ...a, maintOverdue: overdue[a.id] ?? 0 }))

  // Chips both directions: trucks show "🔧 N aboard", tools show their ride.
  const aboard = toolsAboard(rawAssets, toolAssociations)
  const toolCounts = Object.fromEntries(Object.entries(aboard).map(([id, list]) => [id, list.length]))
  // Carry lastSeen so the list can tell "riding right now" from "left behind
  // hours ago" — a stale pairing must never claim the tool is WITH the truck
  // (Brian, Aug 4: tools left at the jobsite showed "with 2003 Chevy").
  const carriers: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gw = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gw) carriers[assoc.tool_asset_id] = { name: gw.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[54px] md:pb-20">
      <AssetList assets={assets} toolCounts={toolCounts} carriers={carriers} zoneNames={zoneNames} placeNames={placeNames} />
    </div>
  )
}
