import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { timecardScope } from '@/lib/db/timecards'
import { getShortHaul, shortHaulWindow } from '@/lib/db/short-haul'
import { dayKey, isDayKey, safeTz } from '@/lib/dates'
import { shortHaulCsv } from '@/lib/short-haul'
import { rankOf } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** 30 days of DOT short-haul time records as CSV — one row per driver per
 *  day, the fields 49 CFR 395.1(e) asks a carrier to keep. Same visibility
 *  as the page: crew get their own rows, Foreman and up every driver's. */
export async function GET(req: NextRequest) {
  if (isMock) return new NextResponse('Demo mode', { status: 400 })
  const perms = await getMyPermissions()
  if (!perms.features.includes('clock')) return new NextResponse('Not found', { status: 404 })
  const [real, companyId] = await Promise.all([getRealPermissions(), getCurrentCompanyId()])
  if (!real.userId) return new NextResponse('Sign in', { status: 401 })
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const todayKey = dayKey(Date.now(), tz)
  const asked = new URL(req.url).searchParams.get('to')
  const toKey = isDayKey(asked) && asked < todayKey ? asked : todayKey
  const scope = timecardScope(perms, perms.viewingAs?.id ?? real.userId)
  const { createClient } = await import('@/lib/supabase-server')
  const { records } = await getShortHaul(createClient(), { companyId, toKey, tz, userIds: scope.userIds, viewerRank: rankOf(perms) })
  const { fromKey } = shortHaulWindow(toKey)
  return new NextResponse(shortHaulCsv(records, tz), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="short-haul-${fromKey}-to-${toKey}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
