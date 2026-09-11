import type { Division } from '../types'

/**
 * Divisions — operating units inside one company (migration 106).
 *
 * Brian, Sep 11: "need to add a section of different divisions of a company —
 * this applies to all assets, geofences, etc. Need a way to filter and also
 * keep track of DCG Coastal vs Upstate for example."
 *
 * Read path only; writes live in lib/actions/divisions.ts so they go through
 * the edit gate. Everything degrades to "no divisions" when 106 hasn't been
 * applied yet — the pickers and filters simply don't render.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Demo stage: the two halves of the mock company, so the filter demos itself. */
export const MOCK_DIVISIONS: Division[] = [
  { id: 'div-upstate', name: 'Upstate', color: '#ff9e16', notes: 'Greenville · Spartanburg · Anderson', sort: 0 },
  { id: 'div-coastal', name: 'Coastal', color: '#2dd4bf', notes: 'Charleston and down', sort: 1 },
]

/** Live divisions for a company, newest sort order first, archived excluded. */
export async function getDivisions(companyId: string): Promise<Division[]> {
  if (isMock) return MOCK_DIVISIONS
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('divisions')
      .select('id, company_id, name, color, notes, sort, archived_at, created_at')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('sort')
      .order('name')
    if (error) return [] // 106 not applied yet — the feature is simply absent
    return (data ?? []) as Division[]
  } catch {
    return []
  }
}

/** Including archived — the settings card lists them so they can come back. */
export async function getAllDivisions(companyId: string): Promise<Division[]> {
  if (isMock) return MOCK_DIVISIONS
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('divisions')
      .select('id, company_id, name, color, notes, sort, archived_at, created_at')
      .eq('company_id', companyId)
      .order('sort')
      .order('name')
    if (error) return []
    return (data ?? []) as Division[]
  } catch {
    return []
  }
}

/** How many assets / zones wear each division — the settings card shows it so
 *  "archive Coastal" is an informed decision. Cheap: two id-only counts. */
export async function getDivisionCounts(companyId: string): Promise<Record<string, { assets: number; zones: number }>> {
  const out: Record<string, { assets: number; zones: number }> = {}
  if (isMock) {
    return { 'div-upstate': { assets: 6, zones: 3 }, 'div-coastal': { assets: 4, zones: 2 } }
  }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const [a, z] = await Promise.all([
      supabase.from('assets').select('division_id').eq('company_id', companyId).eq('active', true).not('division_id', 'is', null),
      supabase.from('geofences').select('division_id').eq('company_id', companyId).not('division_id', 'is', null),
    ])
    for (const r of (a.data ?? []) as { division_id: string }[]) {
      out[r.division_id] = out[r.division_id] ?? { assets: 0, zones: 0 }
      out[r.division_id].assets++
    }
    for (const r of (z.data ?? []) as { division_id: string }[]) {
      out[r.division_id] = out[r.division_id] ?? { assets: 0, zones: 0 }
      out[r.division_id].zones++
    }
    return out
  } catch {
    return out
  }
}

/** Re-exported so a server module can use the same rule without a second
 *  import path; clients import it from `lib/divisions` (this file is
 *  server-only — it reaches for supabase-server). */
export { inDivision } from '../divisions'
