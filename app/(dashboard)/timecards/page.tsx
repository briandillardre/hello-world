import { cookies } from 'next/headers'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getTimeCards, timecardScope, weekOf } from '@/lib/db/timecards'
import { safeTz } from '@/lib/dates'
import { TimeCardsView } from '@/components/timecards/TimeCardsView'

export const metadata = { title: 'HammerTrack — Time cards' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * GPS-verified time cards, one week at a time (migration 103). Same view
 * level as the Time clock: crew see their own card, Foreman and up see the
 * crew's; Team / Billing abilities edit and push to QuickBooks.
 */
export default async function Page({ searchParams }: { searchParams: { week?: string } }) {
  const perms = await requireFeature('clock')
  const [real, companyId] = await Promise.all([getRealPermissions(), getCurrentCompanyId()])
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const { monday, fromMs, toMs } = weekOf(searchParams.week, tz)
  const scope = timecardScope(perms, perms.viewingAs?.id ?? real.userId) // a view-as preview shows the TARGET's card
  let cards: Awaited<ReturnType<typeof getTimeCards>> = { cards: [], verified: false }
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    cards = await getTimeCards(createClient(), { companyId, fromMs, toMs, tz, userIds: scope.userIds })
  }
  return (
    <TimeCardsView
      cards={cards.cards}
      verified={cards.verified}
      week={monday}
      tz={tz}
      canEdit={scope.canEdit}
      canPushQbo={perms.canManageBilling}
      seesAll={scope.seesAll}
      myId={real.userId}
      demo={isMock}
    />
  )
}
