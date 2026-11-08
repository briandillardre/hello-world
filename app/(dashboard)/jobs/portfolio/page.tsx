import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getPortfolio } from '@/lib/db/portfolio'
import { arAging, cashByMonth, isTerms, lastSentByJob, wipSchedule } from '@/lib/jobs/portfolio'
import { PortfolioView } from '@/components/jobs/PortfolioView'

export const metadata = { title: 'Money across jobs — HammerTrack' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Money across jobs (board #233): what customers owe by how late it is, the
 * WIP schedule, cash by month — the Invoice Tracking workbook from the jobs
 * and their pay apps. Costs only.
 */
export default async function Page({ searchParams }: { searchParams: { terms?: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms) || !perms.canViewCosts) notFound()
  const companyId = await getCurrentCompanyId()
  const p = await getPortfolio(companyId)
  const asked = Number(searchParams?.terms ?? 30)
  const terms = isTerms(asked) ? asked : 30
  const today = new Date().toISOString().slice(0, 10)
  // Retainage still held across every job (the final application's release brings it to zero).
  const retHeld = Array.from(lastSentByJob(p.apps).values()).reduce((s, a) => s + Math.round(a.retTotal * 100), 0) / 100
  return (
    <PortfolioView
      jobs={p.jobs} ar={arAging(p.apps, today, terms)} wip={wipSchedule(p.wip)} cash={cashByMonth(p.apps, today, 6)}
      retHeld={retHeld} terms={terms} partial={p.partial} available={p.available} demo={isMock}
    />
  )
}
