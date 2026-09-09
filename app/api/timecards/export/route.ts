import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getTimeCards, timecardScope, weekOf } from '@/lib/db/timecards'
import { safeTz } from '@/lib/dates'
import { timeCardsCsv } from '@/lib/timecards'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** One week of time cards as CSV — one row per entry, payroll-ready. Same
 *  visibility as the page: crew get their own rows, Foreman and up the crew's. */
export async function GET(req: NextRequest) {
  if (isMock) return new NextResponse('Demo mode', { status: 400 })
  const perms = await getMyPermissions()
  if (!perms.features.includes('clock')) return new NextResponse('Not found', { status: 404 })
  const [real, companyId] = await Promise.all([getRealPermissions(), getCurrentCompanyId()])
  if (!real.userId) return new NextResponse('Sign in', { status: 401 })
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const { monday, fromMs, toMs } = weekOf(new URL(req.url).searchParams.get('week'), tz)
  const scope = timecardScope(perms, real.userId)
  const { createClient } = await import('@/lib/supabase-server')
  const { cards } = await getTimeCards(createClient(), { companyId, fromMs, toMs, tz, userIds: scope.userIds })
  const csv = timeCardsCsv(cards, tz)
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="timecards-${monday}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
