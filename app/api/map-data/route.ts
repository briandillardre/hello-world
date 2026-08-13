import { NextResponse } from 'next/server'
import { getAssetsWithLocations, getEarliestLocationTime } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/zones'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getPlacedSiteOverlays } from '@/lib/db/imagery'
import { getCurrentCompanyId, getMyMapViews } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Movement below this speed is GPS jitter, not work — same threshold the
// exact-hours ledger uses for "active" (migration 056: speed > 2).
const MIN_MOVE_SPEED = 2

interface AssetHealthMaps {
  maintOverdue: Map<string, number>
  openWorkOrders: Map<string, number>
  lastMoveMs: Map<string, number>
}

/**
 * Per-asset health badges for the map pins, in exactly 3 batched queries
 * (this route is the 20-second tick — never per-asset):
 *   1. maintenance_schedules → overdue count, via the SAME computeStatus +
 *      readings math as the maintenance page (no reimplemented drift)
 *   2. work_orders → open (not done/canceled) count
 *   3. per-asset newest MOVING fix (speed > 2) → idle days
 * Every read degrades to empty on error — a missing table (pre-050 WOs)
 * never breaks the map payload.
 */
async function getAssetHealth(companyId: string): Promise<AssetHealthMaps> {
  const maintOverdue = new Map<string, number>()
  const openWorkOrders = new Map<string, number>()
  const lastMoveMs = new Map<string, number>()

  try {
    const [schedules, readings] = await Promise.all([
      getMaintenanceSchedules(companyId),
      getCurrentReadings(),
    ])
    for (const s of schedules) {
      const st = computeStatus(s, readings[s.asset_id] ?? s.last_service_value)
      if (st.status === 'overdue') maintOverdue.set(s.asset_id, (maintOverdue.get(s.asset_id) ?? 0) + 1)
    }
  } catch { /* schedules unavailable — badge degrades to 0 */ }

  if (isMock) return { maintOverdue, openWorkOrders, lastMoveMs }

  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const [wo, moves] = await Promise.all([
      supabase.from('work_orders')
        .select('asset_id, status')
        .eq('company_id', companyId)
        .limit(2000),
      // Embedded newest-first + cap 1 (the getAssetsWithLocations pattern),
      // filtered to moving fixes — one round trip, top-1 per asset. Assets
      // with no moving fix come back with an empty embed → idleDays null.
      supabase.from('assets')
        .select('id, asset_locations(timestamp)')
        .eq('company_id', companyId)
        .eq('active', true)
        .gt('asset_locations.speed', MIN_MOVE_SPEED)
        .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
        .limit(1, { referencedTable: 'asset_locations' }),
    ])
    if (!wo.error) {
      for (const w of (wo.data ?? []) as { asset_id: string; status: string }[]) {
        if (w.status === 'done' || w.status === 'canceled') continue
        openWorkOrders.set(w.asset_id, (openWorkOrders.get(w.asset_id) ?? 0) + 1)
      }
    }
    if (!moves.error) {
      type MoveRow = { id: string; asset_locations: { timestamp: string }[] | { timestamp: string } | null }
      for (const row of (moves.data ?? []) as MoveRow[]) {
        const fix = Array.isArray(row.asset_locations) ? row.asset_locations[0] : row.asset_locations
        const ms = fix?.timestamp ? Date.parse(fix.timestamp) : NaN
        if (Number.isFinite(ms)) lastMoveMs.set(row.id, ms)
      }
    }
  } catch { /* pre-050 / query hiccup — badges degrade to 0/null */ }

  return { maintOverdue, openWorkOrders, lastMoveMs }
}

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
    const [perms, savedMapViews, rawAssets, geofences, toolAssociations, earliestMs, alerts, siteOverlays, health] =
      await Promise.all([
        getMyPermissions(),
        getMyMapViews(),
        getAssetsWithLocations(companyId),
        getGeofences(companyId),
        getToolAssociations(companyId),
        getEarliestLocationTime(companyId),
        getAlertEvents(companyId),
        getPlacedSiteOverlays(companyId),
        getAssetHealth(companyId),
      ])
    const now = Date.now()
    const assets = resolveToolLocations(rawAssets, toolAssociations).map((a) => {
      const lastMove = health.lastMoveMs.get(a.id)
      return {
        ...a,
        // Cost fields honor the same boundary as /finance — non-cost roles
        // must not read $/day off the wire even if no layer renders it
        // (sec-check P1, Aug 12: idle rings made the leak visible).
        ...(perms.canViewCosts ? {} : { daily_cost: null, hourly_rate: null, mileage_rate: null, purchase_price: null, purchase_value: null }),
        maintOverdue: health.maintOverdue.get(a.id) ?? 0,
        openWorkOrders: health.openWorkOrders.get(a.id) ?? 0,
        // Whole days since the last MOVING fix. Tool tags have no motion of
        // their own (they inherit a gateway's location) — always null.
        idleDays: a.type === 'tool' || lastMove === undefined
          ? null
          : Math.max(0, Math.floor((now - lastMove) / 86_400_000)),
      }
    })
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
