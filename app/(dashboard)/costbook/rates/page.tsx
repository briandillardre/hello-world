import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getRateLibrary } from '@/lib/db/bids'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { UnitRatesView } from '@/components/estimate/UnitRatesView'
import { PricingNav } from '@/components/estimate/PricingNav'

export const metadata = { title: 'Unit rates — HammerTrack' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Unit rates from your own bids (migration 165): where you win, where you lose, and a price at your margin. */
export default async function Page() {
  const perms = await requireFeature('plans')
  if (!perms.canViewCosts) notFound()
  const admin = rankOf(perms) >= RANK.admin
  const lib = await getRateLibrary(await getCurrentCompanyId(), admin)
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <Link href="/costbook" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Cost book</Link>
        <PricingNav at="rates" />
        <UnitRatesView rows={lib.rows} truncated={lib.truncated} canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} admin={admin} demo={isMock} />
      </div>
    </div>
  )
}
