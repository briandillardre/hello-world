import { getAssetsWithLocations, getEarliestLocationTime } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/zones'
import { getPlaces } from '@/lib/db/places'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getPlacedSiteOverlays } from '@/lib/db/imagery'
import { getCurrentCompany, getCompanyPrefs, getMyMapViews } from '@/lib/db/company'
import { getMyPermissions, requireFeature } from '@/lib/permissions-server'
import { generateTracks } from '@/lib/trails'
import { MapPageClient } from '@/components/map/MapPageClient'
import { MapTopBar } from '@/components/map/MapTopBar'
import { safeTz } from '@/lib/dates'
import { cookies } from 'next/headers'
import type { Viewport } from 'next'

export const metadata = { title: 'HammerTrack — Live map' }

// Map surface: page zoom off so pinch gestures belong to the map engine
// (the root layout allows pinch-zoom everywhere else).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover' }

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
const isRealMode = !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co'

export default async function MapPage({ searchParams }: { searchParams?: { m?: string } }) {
  const mapPerms = await requireFeature('map')
  // ── Real mode: SHELL FIRST. The app icon opens straight into the map —
  // this render awaits only the top-bar basics (company + weather prefs),
  // so the document streams in well under a second and the map engine +
  // tiles boot immediately. The whole fleet payload arrives via ONE
  // /api/map-data fetch in parallel (with a localStorage snapshot painting
  // last-known pins instantly on reopens). "Open quickly, then load" —
  // Brian, Aug 9. Demo mode keeps the original all-server render below.
  if (isRealMode) {
    const { getMeasurement, getMeasurements } = await import('@/lib/db/measurements')
    const [company, prefs, focusMeasurement] = await Promise.all([
      getCurrentCompany(),
      getCompanyPrefs(),
      searchParams?.m ? getMeasurement(searchParams.m) : Promise.resolve(null),
    ])
    const measurements = await getMeasurements(company.id)
    const tz = safeTz(cookies().get('ht_tz')?.value)
    return (
      <div className="h-full flex flex-col pb-[54px] md:pb-0 relative ht-map-edge">
        <MapTopBar companyName={company.name} logoUrl={company.logoUrl} logoBg={company.logoBg} weatherPlace={prefs.weatherPlace} weatherCoords={prefs.weatherCoords} canSetWeatherDefault={prefs.isAdmin} features={mapPerms.features} />
        <div className="flex-1 relative min-h-0">
          <MapPageClient
            bootstrap
            assets={[]}
            geofences={[]}
            tracks={[]}
            historyRows={[]}
            deferHistory
            siteOverlays={[]}
            earliestMs={null}
            tz={tz}
            toolGateways={{}}
            aboard={{}}
            pairingEpisodes={[]}
            defaultWeatherPlace={prefs.weatherPlace}
            defaultWeatherCoords={prefs.weatherCoords}
            canViewCosts={false}
            savedMapViews={null}
            alerts={[]}
            focusMeasurement={focusMeasurement}
            measurements={measurements}
            brand={{ companyName: company.name, logoUrl: company.logoUrl, logoBg: company.logoBg }}
          />
        </div>
      </div>
    )
  }

  // ── Demo mode: mock data is free — keep the fully-server render.
  const company = await getCurrentCompany()
  const companyId = company.id
  const { getMeasurement, getMeasurements } = await import('@/lib/db/measurements')
  const [
    focusMeasurement, measurements, prefs, perms, savedMapViews,
    rawAssets, geofences, places, toolAssociations, earliestMs, alerts, siteOverlays,
  ] = await Promise.all([
    // ?m=<id> — deep link from /measurements: draw it and fly the camera to it.
    searchParams?.m ? getMeasurement(searchParams.m) : Promise.resolve(null),
    getMeasurements(companyId),
    getCompanyPrefs(),
    getMyPermissions(),
    getMyMapViews(),
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getPlaces(companyId),
        getToolAssociations(companyId),
    getEarliestLocationTime(companyId),
    getAlertEvents(companyId),
    getPlacedSiteOverlays(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  const tz = safeTz(cookies().get('ht_tz')?.value)

  // Real mode: history is NOT awaited here anymore — it was the bulk of the
  // "loading your fleet…" stall (the whole page blocked on a 12k-row sweep
  // before first paint, Aug 5). The map ships with live positions only;
  // MapPageClient pulls the recent-history baseline from /api/history right
  // after mount, and longer ranges already fetch on demand behind the
  // timeline's loading bar.
  const sinceMs = earliestMs ?? Date.now() - 30 * 86_400_000
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
    <div className="h-full flex flex-col pb-[54px] md:pb-0 relative ht-map-edge">
      <MapTopBar companyName={company.name} logoUrl={company.logoUrl} logoBg={company.logoBg} weatherPlace={prefs.weatherPlace} weatherCoords={prefs.weatherCoords} canSetWeatherDefault={prefs.isAdmin} features={mapPerms.features} />
      <div className="flex-1 relative min-h-0">
        <MapPageClient
          assets={assets}
          geofences={geofences}
          places={places}
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
          measurements={measurements}
          brand={{ companyName: company.name, logoUrl: company.logoUrl, logoBg: company.logoBg }}
        />
      </div>
    </div>
  )
}
