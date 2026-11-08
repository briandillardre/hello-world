import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCostBook } from '@/lib/db/estimate'
import { CostBookView } from '@/components/estimate/CostBookView'

export const metadata = { title: 'Cost book — HammerTrack' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** The company's cost book (migration 147): materials, sources and their dated prices, haul and crews, margins. */
export default async function Page() {
  const perms = await requireFeature('plans')
  // Dollars only: a login that can't see costs never learns this page exists.
  if (!perms.canViewCosts) notFound()
  const admin = rankOf(perms) >= RANK.admin
  const book = await getCostBook(admin)
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <CostBookView book={book} canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} canMargins={canEdit && admin} showMargins={admin} demo={isMock} />
  )
}
