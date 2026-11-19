import { requireBetaTool } from '@/lib/beta/server'
import { companyPeople, companySites, companyToday, jobsBySite, listRecords, siteDays, timeEntries } from '@/lib/db/beta'
import { addDays, isDay } from '@/lib/beta/registers'
import { buildPayroll, weekStart, type WageRate, type WorkerClass } from '@/lib/beta/payroll'
import { outranks, normalizeRole } from '@/lib/permissions'
import { PayrollView } from '@/components/beta/PayrollView'

export const metadata = { title: 'HammerTrack — Certified payroll' }
export const dynamic = 'force-dynamic'

export default async function PayrollPage({ searchParams }: { searchParams: { site?: string; week?: string } }) {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('payroll')
  const [{ today, tz }, sites, jobs, people, recs] = await Promise.all([
    companyToday(companyId), companySites(companyId), jobsBySite(companyId), companyPeople(companyId), listRecords(companyId, ['wage_rate', 'worker_class'], { limit: 5000 }),
  ])
  const wageBySite = new Map<string, number>()
  for (const r of recs.rows) if (r.kind === 'wage_rate' && r.siteId) wageBySite.set(r.siteId, (wageBySite.get(r.siteId) ?? 0) + 1)
  // jobs on the books first, then any site with a wage decision typed
  const choices = sites.filter((s) => jobs.has(s.id) || wageBySite.has(s.id))
  const list = choices.length ? choices : sites
  const siteId = list.some((s) => s.id === searchParams.site) ? searchParams.site! : list[0]?.id ?? null
  const ws = weekStart(isDay(searchParams.week) ? searchParams.week : addDays(today, -7))
  const { zonedMidnightMs, dayKey } = await import('@/lib/dates')
  const { shiftHours } = await import('@/lib/timecards')
  const entries = await timeEntries(companyId, new Date(zonedMidnightMs(ws, tz)).toISOString(), new Date(zonedMidnightMs(addDays(ws, 7), tz)).toISOString())
  const names = new Map(people.map((p) => [p.id, p.name]))
  for (const e of entries) if (!names.has(e.userId) && e.name) names.set(e.userId, e.name)
  const classes: WorkerClass[] = recs.rows.filter((r) => r.kind === 'worker_class' && r.personId).map((r) => ({
    userId: r.personId!, name: names.get(r.personId!) ?? 'Crew', classification: String(r.data.classification ?? ''), idLast4: r.data.idLast4 as string | undefined,
    base: Number(r.data.base) || 0, fringeCash: r.data.fringeCash as number | undefined, fringePlan: r.data.fringePlan as number | undefined, apprentice: r.data.apprentice === true,
  }))
  const wages = recs.rows.filter((r) => r.kind === 'wage_rate' && r.siteId === siteId)
  const rates: WageRate[] = wages.map((r) => ({ classification: String(r.data.classification ?? ''), base: Number(r.data.base) || 0, fringe: r.data.fringe as number | undefined, decision: r.data.decision as string | undefined }))
  const lines = siteId ? buildPayroll({
    zoneId: siteId, weekStart: ws, classes, rates, names, dayOf: (iso) => dayKey(Date.parse(iso), tz),
    entries: entries.map((e) => ({ userId: e.userId, zoneId: e.zoneId, inAt: e.inAt, outAt: e.outAt, paidHours: e.outAt ? shiftHours(e.inAt, e.outAt, e.breakMinutes, Date.now()).paid : 0 })),
  }) : []
  // payroll number: weeks since the first week anyone clocked onto the job
  const first = siteId ? (await siteDays(companyId, [siteId], tz)).get(siteId)?.first ?? null : null
  const payrollNo = first ? Math.max(1, Math.round((Date.parse(`${ws}T12:00:00Z`) - Date.parse(`${weekStart(first)}T12:00:00Z`)) / (7 * 86_400_000)) + 1) : 1
  const job = siteId ? jobs.get(siteId) ?? null : null
  const { data: co } = demo ? { data: null } : await (await import('@/lib/supabase-server')).createClient().from('companies').select('name').eq('id', companyId).maybeSingle()
  // pay classes: set for the people strictly below you (or anyone, for the owner)
  const payFor = people.filter((p) => perms.isMaster || outranks(perms, { role: normalizeRole(p.role, 'associate'), isMaster: p.id === companyId }))
  return (
    <PayrollView sites={list.map(({ id, name }) => ({ id, name }))} siteId={siteId} weekStart={ws} today={today} lines={lines} wages={wages}
      classes={recs.rows.filter((r) => r.kind === 'worker_class')} people={people.map(({ id, name }) => ({ id, name }))} payFor={payFor.map(({ id, name }) => ({ id, name }))}
      payrollNo={payrollNo} job={{ number: job?.number ?? null, contractNo: job?.contractNo ?? null }} companyName={String(co?.name ?? 'Our company')}
      demo={demo} canWrite={canWrite} />
  )
}
