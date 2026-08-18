import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { FinancePanel } from '@/components/finance/FinancePanel'
import type { FinanceProfile } from '@/lib/valuation'

export const metadata = { title: 'HammerTrack — Financials' }

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Financials — the owner's money page: revenue, margins, revenue/employee vs
 * industry, and a 3-method valuation range (income · market · asset — same
 * trio as a real-estate appraisal). Growth Platform layer 1 (docs/GROWTH-PLATFORM.md).
 */
export default async function FinancePage() {
  const perms = await getMyPermissions()
  if (!perms.canViewCosts) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-6 text-center">
          Financials are visible to owners and managers with the cost permission (Team page).
        </p>
      </div>
    )
  }

  let profile: FinanceProfile = {}
  let teamCount = 0
  let autoFleetValue = 0
  let available = true
  if (!isMock) {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const [{ data: co, error }, { count }, { data: assets }] = await Promise.all([
      supabase.from('companies').select('finance_profile').eq('id', companyId).single(),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('assets').select('purchase_price').eq('company_id', companyId),
    ])
    if (error) available = false
    profile = ((co?.finance_profile as FinanceProfile | null) ?? {})
    teamCount = count ?? 0
    autoFleetValue = (assets ?? []).reduce((s, a) => s + (Number(a.purchase_price) || 0), 0)
  } else {
    profile = { industry: 'sitework', industryLabel: 'Grading & sitework contractor', description: 'Residential and light-commercial grading, pads, driveways, and utility trenching.', lastYearRevenue: 2_400_000, ytdRevenue: 1_460_000, lastYearProfit: 168_000, ownerComp: 110_000, employees: 9 }
    teamCount = 9
    autoFleetValue = 610_000
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Financials</h1>
        <p className="text-[12.5px] text-faint">
          Your numbers against your trade&apos;s benchmarks, and what the company is worth —
          three appraisal methods, one honest range. Owners only.
        </p>
      </div>
      <FinancePanel
        initial={profile}
        teamCount={teamCount}
        autoFleetValue={autoFleetValue}
        canEdit={perms.canManageBilling}
        available={available}
      />
    </div></div>
  )
}
