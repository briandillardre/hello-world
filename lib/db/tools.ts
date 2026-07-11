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

export { findGatewayForTool, resolveToolLocations } from '../tools-resolve'

