import { requireBetaTool } from '@/lib/beta/server'
import { companyAssets, companySites, companyToday, listRecords, siteTrips } from '@/lib/db/beta'
import { addDays, isDay } from '@/lib/beta/registers'
import { rankOf, RANK } from '@/lib/permissions'
import { HaulView } from '@/components/beta/HaulView'

export const metadata = { title: 'HammerTrack — Haul tickets' }
export const dynamic = 'force-dynamic'

export default async function HaulPage({ searchParams }: { searchParams: { site?: string; from?: string; to?: string } }) {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('haul')
  const [{ today, tz }, sites, assets] = await Promise.all([companyToday(companyId), companySites(companyId), companyAssets(companyId)])
  const siteId = sites.some((s) => s.id === searchParams.site) ? searchParams.site! : sites[0]?.id ?? null
  const to = isDay(searchParams.to) ? searchParams.to : today
  const from = isDay(searchParams.from) && searchParams.from <= to ? searchParams.from : addDays(to, -13)
  const recs = siteId ? await listRecords(companyId, ['haul_ticket'], { siteId, limit: 5000 }) : { available: false, rows: [] }
  const inWindow = recs.rows.filter((r) => { const d = String(r.data.day ?? ''); return d >= from && d <= to })
  const { zonedMidnightMs, addDaysKey } = await import('@/lib/dates')
  const haulers = Array.from(new Set(inWindow.map((r) => r.assetId).filter(Boolean) as string[]))
  const trips = siteId ? await siteTrips(companyId, siteId, haulers, new Date(zonedMidnightMs(from, tz)).toISOString(), new Date(zonedMidnightMs(addDaysKey(to, 1), tz)).toISOString(), tz) : []
  return <HaulView sites={sites.map(({ id, name }) => ({ id, name }))} siteId={siteId} from={from} to={to} today={today} rows={inWindow} trips={trips}
    assets={assets.filter((a) => a.type === 'vehicle').map(({ id, name }) => ({ id, name }))} demo={demo} canWrite={canWrite && perms.canEdit} canRemoveAny={rankOf(perms) >= RANK.manager} />
}
