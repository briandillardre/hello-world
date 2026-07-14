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
  return data ?? []
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

