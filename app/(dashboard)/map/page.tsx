import { getAssetsWithLocations, getLocationHistory } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { getCurrentCompany, getCompanyPrefs } from '@/lib/db/company'
import { generateTracks, tracksFromHistory } from '@/lib/trails'
import { buildCostCurve, zoneCostsFromHistory, type CostCurve, type ZoneCostCurve } from '@/lib/costs'
import { MapPageClient } from '@/components/map/MapPageClient'
import { MapTopBar } from '@/components/map/MapTopBar'
import { zonedDayWindow, DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
export default async function MapPage() {
  const company = await getCurrentCompany()
  const companyId = company.id
  const prefs = await getCompanyPrefs()
  const [rawAssets, geofences, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getToolAssociations(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  // Calendar-day windows in the VIEWER's timezone (ht_tz cookie from TzCookie;
  // server is UTC). Today/Yesterday run local midnight → midnight, per request.
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const todayW = zonedDayWindow(tz, 0)
  const yestW = zonedDayWindow(tz, 1)

  // Real mode: fetch since yesterday's local midnight; build a dataset per day
  // so switching Today/Yesterday swaps tracks + cost + zone curves together.
  const history = await getLocationHistory(companyId, new Date(yestW.from).toISOString())
  const dataset = (w: { from: number; to: number }) => {
    const rows = (history ?? []).filter((r) => {
      const ms = new Date(r.timestamp).getTime()
      return ms >= w.from && ms < w.to
    })
    return {
      tracks: tracksFromHistory(assets, rows, w.from, w.to),
      window: w,
      cost: buildCostCurve(assets, rows, w.from, w.to),
      zones: zoneCostsFromHistory(geofences, assets, rows, w.from, w.to),
    }
  }
  const rangeData = history ? { today: dataset(todayW), yesterday: dataset(yestW) } : null
  const tracks = rangeData ? rangeData.today.tracks : generateTracks(assets)
  const trackWindow = rangeData ? rangeData.today.window : null
  const realCost: CostCurve | null = rangeData ? rangeData.today.cost : null
  const zoneCosts: Record<string, ZoneCostCurve> | null = rangeData ? rangeData.today.zones : null

  // Map each tool to the gateway holding it, for the asset detail panel.
  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gateway = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-full flex flex-col pb-[70px] md:pb-0">
      <MapTopBar companyName={company.name} />
      <div className="flex-1 relative min-h-0">
        <MapPageClient assets={assets} geofences={geofences} tracks={tracks} realWindow={trackWindow} realCost={realCost} realZoneCosts={zoneCosts} rangeData={rangeData} toolGateways={toolGateways} defaultWeatherPlace={prefs.weatherPlace} canSetWeatherDefault={prefs.isAdmin} />
      </div>
    </div>
  )
}
