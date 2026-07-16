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
 *  epoch ms; endMs null = still ongoing. Empty in demo mode / pre-021. */
export interface PairingEpisode { member: string; carrier: string; startMs: number; endMs: number | null }
export async function getPairingEpisodes(companyId: string, sinceIso: string): Promise<PairingEpisode[]> {
  if (isMock) return []
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('pairing_log')
    .select('member_asset_id, carrier_asset_id, started_at, ended_at')
    .eq('company_id', companyId)
    .eq('kind', 'tool')
    .or(`ended_at.is.null,ended_at.gte.${sinceIso}`)
    .limit(5000)
  return (data ?? []).map((p) => ({
    member: p.member_asset_id as string,
    carrier: p.carrier_asset_id as string,
    startMs: new Date(p.started_at as string).getTime(),
    endMs: p.ended_at ? new Date(p.ended_at as string).getTime() : null,
  }))
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

