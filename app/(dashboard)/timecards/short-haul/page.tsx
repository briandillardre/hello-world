import { cookies } from 'next/headers'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { outranks, rankOf } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { timecardScope } from '@/lib/db/timecards'
import { getShortHaul, shortHaulWindow, type ShortHaulResult } from '@/lib/db/short-haul'
import { addDaysKey, dayKey, isDayKey, safeTz, zonedMidnightMs } from '@/lib/dates'
import { AIR_MILE_M, buildShortHaul, type ShortHaulShift } from '@/lib/short-haul'
import { ShortHaulView } from '@/components/timecards/ShortHaulView'

export const metadata = { title: 'HammerTrack — DOT short-haul records' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * DOT short-haul time records (migration 126) — 30 days at a time. Same view
 * level and scope as the time cards: crew see their own record, Foreman and
 * up see every commercial driver's; the team ability marks who drives one.
 */
export default async function Page({ searchParams }: { searchParams: { to?: string } }) {
  const perms = await requireFeature('clock')
  const [real, companyId] = await Promise.all([getRealPermissions(), getCurrentCompanyId()])
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const todayKey = dayKey(Date.now(), tz)
  const toKey = isDayKey(searchParams.to) && searchParams.to < todayKey ? searchParams.to : todayKey
  const myId = perms.viewingAs?.id ?? real.userId // a view-as preview shows the TARGET's record
  const scope = timecardScope(perms, myId)
  let res: ShortHaulResult = isMock ? demoShortHaul(toKey, tz) : { records: [], team: [], ready: false, verified: false }
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    res = await getShortHaul(createClient(), { companyId, toKey, tz, userIds: scope.userIds, viewerRank: rankOf(perms) })
  }
  const canSetup = perms.canManageTeam && !perms.viewingAs
  const people = (scope.seesAll ? res.team : res.team.filter((t) => t.id === myId)).map((t) => ({
    id: t.id,
    name: t.name,
    driverClass: t.driverClass,
    canSet: canSetup && (t.id === real.userId || outranks(perms, { role: t.role, isMaster: t.isMaster })),
  }))
  return (
    <ShortHaulView
      records={res.records}
      people={people}
      toKey={toKey}
      todayKey={todayKey}
      tz={tz}
      verified={res.verified}
      ready={res.ready}
      seesAll={scope.seesAll}
      canSetup={canSetup}
      demo={isMock}
    />
  )
}

/** Demo mode: two drivers' last 30 days, built by the real rules — a CDL
 *  dump-truck driver with one long haul past the radius and one 15-hour day,
 *  and a crew lead without a CDL. */
function demoShortHaul(toKey: string, tz: string): ShortHaulResult {
  const yard = { lat: 36.1612, lng: -86.8105 }
  const shifts: ShortHaulShift[] = []
  const { fromKey } = shortHaulWindow(toKey)
  for (let k = addDaysKey(fromKey, -8), i = 0; k <= toKey; k = addDaysKey(k, 1), i++) {
    const dow = new Date(`${k}T12:00:00Z`).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const at = (h: number) => new Date(zonedMidnightMs(k, tz) + h * 3_600_000).toISOString()
    const haul = i % 11 === 4
    const long = i % 13 === 7
    shifts.push({
      id: `d1-${k}`, userId: 'demo-cdl', personName: 'Dump truck driver',
      inAt: at(6), outAt: k === toKey ? null : at(long ? 21.25 : 16), breakMinutes: 30,
      inLat: yard.lat, inLng: yard.lng, outLat: yard.lat, outLng: yard.lng,
      reachM: (haul ? 168 : 18 + (i % 5) * 9) * AIR_MILE_M, fixes: 400,
    })
    shifts.push({
      id: `d2-${k}`, userId: 'demo-cmv', personName: 'Crew lead',
      inAt: at(6.5), outAt: k === toKey ? null : at(15.5), breakMinutes: 30,
      inLat: yard.lat, inLng: yard.lng, outLat: yard.lat, outLng: yard.lng,
      reachM: (12 + (i % 4) * 6) * AIR_MILE_M, fixes: 300,
    })
  }
  const records = buildShortHaul(shifts, { 'demo-cdl': 'cdl', 'demo-cmv': 'cmv' }, { tz, fromKey, toKey })
  return {
    records,
    team: [
      { id: 'demo-cmv', name: 'Crew lead', role: 'foreman', isMaster: false, driverClass: 'cmv' },
      { id: 'demo-cdl', name: 'Dump truck driver', role: 'associate', isMaster: false, driverClass: 'cdl' },
      { id: 'demo-crew', name: 'Laborer', role: 'associate', isMaster: false, driverClass: null },
    ],
    ready: true,
    verified: true,
  }
}
