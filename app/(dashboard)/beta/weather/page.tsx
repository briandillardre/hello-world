import { requireBetaTool } from '@/lib/beta/server'
import { companySites, companyToday, jobSiteChoices, jobsBySite } from '@/lib/db/beta'
import { addDays } from '@/lib/beta/registers'
import { WeatherView } from '@/components/beta/WeatherView'

export const metadata = { title: 'HammerTrack — Weather-delay packet' }
export const dynamic = 'force-dynamic'

export default async function WeatherPage() {
  const { companyId, canWrite, demo } = await requireBetaTool('weather')
  const [{ today }, sites, jobs] = await Promise.all([companyToday(companyId), companySites(companyId), jobsBySite(companyId)])
  const list = jobSiteChoices(sites.filter((s) => s.lat !== null), jobs)
  return <WeatherView sites={list.map(({ id, label }) => ({ id, name: label }))} defaultFrom={addDays(today, -30)} defaultTo={addDays(today, -1)} demo={demo} canRun={canWrite} />
}
