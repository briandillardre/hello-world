'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Foreman's word on a who-ran-what pair: confirm makes it payroll-grade,
 * reject hides it. One decision per (day, person, machine); re-deciding
 * overwrites — people change their minds.
 */
export async function decidePairAction(
  day: string, // YYYY-MM-DD in company-local terms
  personAssetId: string,
  machineAssetId: string,
  status: 'confirmed' | 'rejected'
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Signed out' }
    const { error } = await supabase.from('pair_confirmations').upsert(
      {
        company_id: companyId,
        day,
        person_asset_id: personAssetId,
        machine_asset_id: machineAssetId,
        status,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,day,person_asset_id,machine_asset_id' }
    )
    if (error) {
      // 42P01 = table missing → migration 018 not applied yet.
      if (error.code === '42P01') return { ok: false, error: 'Run migration 018_pair_confirmations.sql first.' }
      return { ok: false, error: error.message }
    }
    revalidatePath('/logs')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}

export interface PairDecision {
  day: string
  person_asset_id: string
  machine_asset_id: string
  status: 'confirmed' | 'rejected'
}

/** Recent decisions for the logs feed (migration-tolerant: [] when 018 absent). */
export async function getPairDecisions(days = 7): Promise<PairDecision[]> {
  if (isMock) return []
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('pair_confirmations')
      .select('day, person_asset_id, machine_asset_id, status')
      .eq('company_id', companyId)
      .gte('day', since)
    if (error || !data) return []
    return data as PairDecision[]
  } catch {
    return []
  }
}
