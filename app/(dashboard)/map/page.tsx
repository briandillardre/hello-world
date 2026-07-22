import { getAssetsWithLocations, getLocationHistory, getEarliestLocationTime } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getCurrentCompany, getCompanyPrefs, getMyMapViews } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { generateTracks } from '@/lib/trails'
import { MapPageClient } from '@/components/map/MapPageClient'
import { MapTopBar } from '@/components/map/MapTopBar'
import { DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
export default async function MapPage() {
  const company = await getCurrentCompany()
  const companyId = company.id
  const prefs = await getCompanyPrefs()
  const perms = await getMyPermissions()
  const savedMapViews = await getMyMapViews()
  const [rawAssets, geofences, toolAssociations, earliestMs, alerts] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getToolAssociations(companyId),
    getEarliestLocationTime(companyId),
    getAlertEvents(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)

  // Real mode: fetch ALL history (from the first-ever fix, capped) once and
  // hand the raw rows to the client, which builds tracks + cost + zone curves
  // per selected range (Today … All time … Custom). MapView is client-only
  // (ssr:false) so this computation naturally lives there, keyed on the range.
  const sinceMs = earliestMs ?? Date.now() - 30 * 86_400_000
  const history = earliestMs !== null
    ? await getLocationHistory(companyId, new Date(sinceMs).toISOString(), 12000)
    : await getLocationHistory(companyId, new Date(Date.now() - 2 * 86_400_000).toISOString())

  // Thin the shipped payload: OBD units report every few seconds, so cap at a
  // few thousand evenly-strided rows. tracksFromHistory thins further per range.
  const MAX_SHIP = 20000
  const rows = history ?? []
  const { simplifyHistoryRows } = await import('@/lib/simplify')
  const historyRows = rows.length > MAX_SHIP ? simplifyHistoryRows(rows, 12, MAX_SHIP) : rows

  // Demo mode keeps the synthetic cinematic trails.
  const demoTracks = history ? [] : generateTracks(assets)

  // Map each tool to the gateway holding it, for the asset detail panel.
  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gateway = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
  }
  // …and the reverse: what each truck/machine is carrying (badge + list).
  const aboard = toolsAboard(rawAssets, toolAssociations)
  // Pairing episodes over the same window the timeline can replay, so
  // scrubbing shows what was aboard at THAT moment, not now.
  const pairingEpisodes = await getPairingEpisodes(companyId, new Date(sinceMs).toISOString())

  return (
    <div className="h-full flex flex-col pb-[54px] md:pb-0">
      <MapTopBar companyName={company.name} weatherPlace={prefs.weatherPlace} weatherCoords={prefs.weatherCoords} />
      <div className="flex-1 relative min-h-0">
        <MapPageClient
          assets={assets}
          geofences={geofences}
          tracks={demoTracks}
          historyRows={history ? historyRows : null}
          earliestMs={earliestMs}
          tz={tz}
          toolGateways={toolGateways}
          aboard={aboard}
          pairingEpisodes={pairingEpisodes}
          defaultWeatherPlace={prefs.weatherPlace}
          defaultWeatherCoords={prefs.weatherCoords}
          canSetWeatherDefault={prefs.isAdmin}
          canViewCosts={perms.canViewCosts}
          savedMapViews={savedMapViews}
          alerts={alerts}
        />
      </div>
    </div>
  )
}
