import { NextResponse } from 'next/server'
import { getAssetsWithLocations, getEarliestLocationTime } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/zones'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getPlacedSiteOverlays } from '@/lib/db/imagery'
import { getCurrentCompanyId, getMyMapViews } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'

export const dynamic = 'force-dynamic'

/**
 * The map's whole data payload as one JSON hop — what /map used to assemble
 * server-side BEFORE first paint. The page now ships an instant shell (map
 * engine boots + tiles stream immediately) and pulls this in parallel; the
 * same endpoint is the 20-second live-refresh tick, replacing the old
 * router.refresh() full-page re-render.
 */
export async function GET() {
  try {
    const companyId = await getCurrentCompanyId()
    const [perms, savedMapViews, rawAssets, geofences, toolAssociations, earliestMs, alerts, siteOverlays] =
      await Promise.all([
        getMyPermissions(),
        getMyMapViews(),
        getAssetsWithLocations(companyId),
        getGeofences(companyId),
        getToolAssociations(companyId),
        getEarliestLocationTime(companyId),
        getAlertEvents(companyId),
        getPlacedSiteOverlays(companyId),
      ])
    const assets = resolveToolLocations(rawAssets, toolAssociations)
    const sinceMs = earliestMs ?? Date.now() - 30 * 86_400_000
    const pairingEpisodes = await getPairingEpisodes(companyId, new Date(sinceMs).toISOString())

    const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
    for (const assoc of toolAssociations) {
      const gateway = rawAssets.find((a) => a.id === assoc.gateway_asset_id)
      if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
    }
    const aboard = toolsAboard(rawAssets, toolAssociations)

    return NextResponse.json(
      {
        assets, geofences, toolGateways, aboard, pairingEpisodes,
        alerts, siteOverlays, earliestMs, savedMapViews,
        canViewCosts: perms.canViewCosts,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
