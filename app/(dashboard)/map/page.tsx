import { getAssetsWithLocations, getEarliestLocationTime } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/zones'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getPlacedSiteOverlays } from '@/lib/db/imagery'
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
export default async function MapPage({ searchParams }: { searchParams?: { m?: string } }) {
  // Speed: everything here used to await SERIALLY — six Supabase round-trips
  // in a row before the page could stream (Brian: "map site loads slow").
  // Only the company id truly gates the rest, so it's one hop, then one batch.
  const company = await getCurrentCompany()
  const companyId = company.id
  const { getMeasurement } = await import('@/lib/db/measurements')
  const [
    focusMeasurement, prefs, perms, savedMapViews,
    rawAssets, geofences, toolAssociations, earliestMs, alerts, siteOverlays,
  ] = await Promise.all([
    // ?m=<id> — deep link from /measurements: draw it and fly the camera to it.
    searchParams?.m ? getMeasurement(searchParams.m) : Promise.resolve(null),
    getCompanyPrefs(),
    getMyPermissions(),
    getMyMapViews(),
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getToolAssociations(companyId),
    getEarliestLocationTime(companyId),
    getAlertEvents(companyId),
    getPlacedSiteOverlays(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)

  // Real mode: history is NOT awaited here anymore — it was the bulk of the
  // "loading your fleet…" stall (the whole page blocked on a 12k-row sweep
  // before first paint, Aug 5). The map ships with live positions only;
  // MapPageClient pulls the recent-history baseline from /api/history right
  // after mount, and longer ranges already fetch on demand behind the
  // timeline's loading bar.
  const sinceMs = earliestMs ?? Date.now() - 30 * 86_400_000
  const isRealMode = !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co'
  const pairingEpisodes = await getPairingEpisodes(companyId, new Date(sinceMs).toISOString())

  // Demo mode keeps the synthetic cinematic trails.
  const demoTracks = isRealMode ? [] : generateTracks(assets)

  // Map each tool to the gateway holding it, for the asset detail panel.
  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gateway = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
  }
  // …and the reverse: what each truck/machine is carrying (badge + list).
  const aboard = toolsAboard(rawAssets, toolAssociations)
  return (
    <div className="h-full flex flex-col pb-[54px] md:pb-0">
      <MapTopBar companyName={company.name} weatherPlace={prefs.weatherPlace} weatherCoords={prefs.weatherCoords} canSetWeatherDefault={prefs.isAdmin} />
      <div className="flex-1 relative min-h-0">
        <MapPageClient
          assets={assets}
          geofences={geofences}
          tracks={demoTracks}
          historyRows={isRealMode ? [] : null}
          deferHistory={isRealMode}
          siteOverlays={siteOverlays}
          earliestMs={earliestMs}
          tz={tz}
          toolGateways={toolGateways}
          aboard={aboard}
          pairingEpisodes={pairingEpisodes}
          defaultWeatherPlace={prefs.weatherPlace}
          defaultWeatherCoords={prefs.weatherCoords}
          canViewCosts={perms.canViewCosts}
          savedMapViews={savedMapViews}
          alerts={alerts}
          focusMeasurement={focusMeasurement}
          brand={{ companyName: company.name, logoUrl: company.logoUrl }}
        />
      </div>
    </div>
  )
}
