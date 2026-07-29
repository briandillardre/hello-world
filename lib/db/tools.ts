import type { ToolAssociation } from '../types'
import { MOCK_TOOL_ASSOCIATIONS } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getToolAssociations(companyId: string): Promise<ToolAssociation[]> {
  if (isMock) return MOCK_TOOL_ASSOCIATIONS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('tool_associations')
    .select('*')
    .eq('company_id', companyId)
  const rows: ToolAssociation[] = data ?? []

  // Backfill (one-time per row): associations written before migration 033
  // have no last_lat/lng snapshot, so a stale tag had nowhere truthful to
  // render. The gateway's OWN GPS fix at the sighting time is in history —
  // look it up, use it, and persist it so this never runs again for the row.
  for (const a of rows) {
    if (a.last_lat != null || !a.last_seen) continue
    try {
      const { data: fix } = await supabase
        .from('asset_locations')
        .select('lat, lng')
        .eq('asset_id', a.gateway_asset_id)
        .lte('timestamp', a.last_seen)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (fix) {
        a.last_lat = fix.lat
        a.last_lng = fix.lng
        await supabase.from('tool_associations')
          .update({ last_lat: fix.lat, last_lng: fix.lng })
          .eq('id', a.id)
      }
    } catch { /* pre-033 DB (column missing) — enrichment just skips */ }
  }
  return rows
}

export { findGatewayForTool, resolveToolLocations, toolsAboard } from '../tools-resolve'
export type { AboardTool } from '../tools-resolve'

export interface PairingLogRow {
  id: string
  kind: 'tool' | 'crew'
  member_asset_id: string
  carrier_asset_id: string
  started_at: string
  last_seen: string
  ended_at: string | null
}

/** Episode intervals for replay-accurate "what was aboard at that moment"
 *  badges: every tool-pairing episode that overlaps [sinceIso, now]. Times in
 *  epoch ms; endMs null = still ongoing. Empty in demo mode / pre-021.
 *
 *  Open episodes (ended_at null) are CLAMPED to last_seen: the log only
 *  closes an episode when another gateway takes over, so a tag that simply
 *  went silent (left in an untracked truck) stays "open" forever — and its
 *  synthesized path kept riding the old carrier, painting the tool in two
 *  places at once (Tool A aboard the Ram AND "left here", Jul 17). A pairing
 *  is only true through its last confirmed sighting. */
export interface PairingEpisode {
  member: string
  carrier: string
  startMs: number
  endMs: number | null
  /** True when ended_at was never written — endMs is the last SIGHTING, not a
   *  drop-off, so consumers may extend it by a freshness grace. */
  open: boolean
}
export async function getPairingEpisodes(companyId: string, sinceIso: string): Promise<PairingEpisode[]> {
  if (isMock) return []
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('pairing_log')
    .select('member_asset_id, carrier_asset_id, started_at, last_seen, ended_at')
    .eq('company_id', companyId)
    .eq('kind', 'tool')
    .or(`ended_at.is.null,ended_at.gte.${sinceIso}`)
    .limit(5000)
  return (data ?? []).map((p) => {
    const end = (p.ended_at ?? p.last_seen) as string | null
    return {
      member: p.member_asset_id as string,
      carrier: p.carrier_asset_id as string,
      startMs: new Date(p.started_at as string).getTime(),
      endMs: end ? new Date(end).getTime() : null,
      open: p.ended_at == null,
    }
  })
}

export interface ToolWindowRow { lat: number; lng: number; speed: number | null; timestamp: string; ignition?: boolean | null }

/** A tool's location rows over [fromIso, toIso): its CARRIERS' asset_locations
 *  rows during each pairing episode overlapping the window, clamped and
 *  stitched chronologically. This is what makes /api/stops and /api/asset-stats
 *  answer for a Bluetooth tag the same way they do for a truck — the tag's
 *  day IS the truck's day while it was aboard. RLS scopes everything. */
export async function getToolWindowRows(
  toolId: string,
  fromIso: string,
  toIso: string,
  cap = 20_000
): Promise<ToolWindowRow[]> {
  if (isMock) return []
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data: eps } = await supabase
    .from('pairing_log')
    .select('carrier_asset_id, started_at, last_seen, ended_at')
    .eq('kind', 'tool')
    .eq('member_asset_id', toolId)
    .lte('started_at', toIso)
    .or(`ended_at.is.null,ended_at.gte.${fromIso}`)
    // Chronological, and bounded newest-first if a tool somehow has >500
    // episodes in the window — unordered limit dropped an arbitrary subset
    // (code review, Jul 21).
    .order('started_at', { ascending: true })
    .limit(500)
  const out: ToolWindowRow[] = []
  for (const ep of eps ?? []) {
    const from = (ep.started_at as string) > fromIso ? (ep.started_at as string) : fromIso
    // Open episodes clamp to last_seen — a silent tag stopped riding then,
    // even though arbitration never wrote ended_at (see getPairingEpisodes).
    const epEnd = (ep.ended_at ?? ep.last_seen) as string | null
    const to = epEnd && epEnd < toIso ? epEnd : toIso
    if (from >= to) continue
    const PAGE = 1000
    let got = 0
    while (out.length < cap) {
      const { data } = await supabase
        .from('asset_locations')
        // ignition rides along so tool trails get the same honest idle/stop
        // math as the carrier itself (code review, Jul 21).
        .select('lat, lng, speed, timestamp, ignition')
        .eq('asset_id', ep.carrier_asset_id)
        .gte('timestamp', from)
        .lt('timestamp', to)
        .order('timestamp', { ascending: false })
        .range(got, got + PAGE - 1)
      if (!data?.length) break
      out.push(...data)
      got += data.length
      if (data.length < PAGE) break
    }
    if (out.length >= cap) break
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return out
}

/** Pairing episodes involving an asset (as the tool OR the carrier), newest
 *  first. Empty in demo mode or before migration 021 lands. */
export async function getPairingLog(companyId: string, assetId: string, limit = 25): Promise<PairingLogRow[]> {
  if (isMock) return []
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('pairing_log')
    .select('id, kind, member_asset_id, carrier_asset_id, started_at, last_seen, ended_at')
    .eq('company_id', companyId)
    .or(`member_asset_id.eq.${assetId},carrier_asset_id.eq.${assetId}`)
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data as PairingLogRow[] | null) ?? []
}

