import { AssetList } from '@/components/assets/AssetList'
import { requireFeature } from '@/lib/permissions-server'
import { visibleAssets } from '@/lib/permissions'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, toolsAboard } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { getDivisions } from '@/lib/db/divisions'
import { pointInPolygon } from '@/lib/alerts-engine'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import { lookupCachedPlaces } from '@/lib/reverse-geocode'
import { placeKey, formatPlace } from '@/lib/place-label'

export const metadata = { title: 'HammerTrack — Assets' }

export default async function AssetsPage() {
  const perms = await requireFeature('assets')
  const companyId = await getCurrentCompanyId()
  const [rawAssetsAll, toolAssociations, geofences, schedules, readings, divisions] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
    getGeofences(companyId),
    getMaintenanceSchedules(companyId),
    getCurrentReadings(),
    getDivisions(companyId),
  ])
  // Per-asset visibility (111) — RLS for the real viewer, this for view-as.
  const rawAssets = visibleAssets(rawAssetsAll, perms)
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

  // Miles today + this week per road vehicle, off the hourly driving rows
  // (Nov 6: Craig's only questions were "how many miles did the truck
  // drive"). Under the caller's RLS; a failed read shows nothing.
  const miles: Record<string, { today: number; week: number }> = {}
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { safeTz } = await import('@/lib/dates')
    const sb = createClient()
    // The company's own day — driving_daily.day is built in it (a fixed
    // Eastern clock split Charleston-time evenings wrong for any other zone).
    const { data: co } = await sb.from('companies').select('digest_prefs').eq('id', companyId).maybeSingle()
    const tz = safeTz(((co?.digest_prefs ?? null) as { tz?: string } | null)?.tz)
    const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms))
    const today = dayKey(Date.now())
    const weekStart = dayKey(Date.now() - 6 * 86_400_000)
    const ids = assets.filter((a) => a.type === 'vehicle').map((a) => a.id)
    if (ids.length) {
      const { data } = await sb.from('driving_daily').select('asset_id, day, miles').in('asset_id', ids).gte('day', weekStart)
      for (const r of (data ?? []) as { asset_id: string; day: string; miles: number }[]) {
        const m = miles[r.asset_id] ?? { today: 0, week: 0 }
        m.week += Number(r.miles) || 0
        if (r.day === today) m.today += Number(r.miles) || 0
        miles[r.asset_id] = m
      }
    }
  } catch { /* pre-129 DB or a failed read: no miles line */ }

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[54px] md:pb-20">
      <AssetList assets={assets} toolCounts={toolCounts} carriers={carriers} zoneNames={zoneNames} placeNames={placeNames} divisions={divisions} miles={miles} />
    </div>
  )
}
