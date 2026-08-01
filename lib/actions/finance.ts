'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import type { FinanceProfile } from '@/lib/valuation'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Save the admin-entered financial profile (Financials page). */
export async function saveFinanceProfileAction(p: FinanceProfile): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : undefined
  }
  const clean: FinanceProfile = {
    industry: typeof p.industry === 'string' ? p.industry.slice(0, 30) : undefined,
    lastYearRevenue: num(p.lastYearRevenue),
    ytdRevenue: num(p.ytdRevenue),
    lastYearProfit: num(p.lastYearProfit),
    ownerComp: num(p.ownerComp),
    employees: num(p.employees),
    fleetValueOverride: num(p.fleetValueOverride),
    otherAssets: num(p.otherAssets),
    liabilities: num(p.liabilities),
  }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { error } = await createClient().from('companies')
    .update({ finance_profile: clean }).eq('id', companyId)
  if (error) return { ok: false, error: 'Save failed — run migration 048 in the Supabase SQL Editor first.' }
  revalidatePath('/finance')
  return { ok: true }
}
