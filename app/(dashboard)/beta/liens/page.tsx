import { requireBetaTool } from '@/lib/beta/server'
import { companySites, companyToday, jobsBySite, listRecords, siteDays } from '@/lib/db/beta'
import { lienClock, worstState, type LienSheet } from '@/lib/beta/lien'
import { LiensView, type LienRow } from '@/components/beta/LiensView'

export const metadata = { title: 'HammerTrack — Lien clock' }
export const dynamic = 'force-dynamic'

const WORKING = ['awarded', 'active', 'on_hold', 'substantial']
const ON_BOOKS = [...WORKING, 'closeout', 'closed']

export default async function LiensPage() {
  const { companyId, canWrite, demo } = await requireBetaTool('liens')
  const [{ today, tz }, sheets, sites, jobs] = await Promise.all([companyToday(companyId), listRecords(companyId, ['lien']), companySites(companyId), jobsBySite(companyId)])
  const sheetBy = new Map(sheets.rows.map((r) => [r.siteId, r]))
  // every job on the books, plus any site that already has a lien sheet
  const siteIds = sites.filter((s) => ON_BOOKS.includes(jobs.get(s.id)?.stage ?? '') || sheetBy.has(s.id)).map((s) => s.id)
  const days = await siteDays(companyId, siteIds, tz)
  const rows: LienRow[] = siteIds.map((id) => {
    const site = sites.find((s) => s.id === id)!
    const job = jobs.get(id) ?? null
    const sheet = sheetBy.get(id) ?? null
    const d = days.get(id) ?? { first: null, last: null, liveNow: false }
    const still = WORKING.includes(job?.stage ?? '') || d.liveNow
    const clock = lienClock((sheet?.data ?? {}) as LienSheet, d, today, still)
    return { siteId: id, siteName: site.name, jobNumber: job?.number ?? null, stage: job?.stage ?? null, customer: job?.customer ?? null, sheet, clock, worst: worstState(clock.deadlines), gpsFirst: d.first, gpsLast: d.last }
  })
  const order = ['overdue', 'urgent', 'soon', 'moving', 'ok', 'waiting', 'done', null]
  rows.sort((a, b) => order.indexOf(a.worst) - order.indexOf(b.worst) || a.siteName.localeCompare(b.siteName))
  return <LiensView rows={rows} today={today} demo={demo} canWrite={canWrite} />
}
