import { requireBetaTool } from '@/lib/beta/server'
import { companySites, jobSiteChoices, jobsBySite } from '@/lib/db/beta'
import { getSurveySite, surveySites } from '@/lib/db/survey'
import { dirtAddonActive } from '@/lib/db/dirt'
import { rankOf, RANK } from '@/lib/permissions'
import { SurveyView } from '@/components/beta/SurveyView'

export const metadata = { title: 'HammerTrack — Site survey' }
export const dynamic = 'force-dynamic'

/** Site survey & as-built (163): takeoff versions, drone topo, drone vs rover, as-built surfaces out to the machines. */
export default async function SurveyPage({ searchParams }: { searchParams: { site?: string } }) {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('survey')
  const [all, withData, jobs, addon] = await Promise.all([companySites(companyId), surveySites(companyId), jobsBySite(companyId), dirtAddonActive(companyId)])
  const has = new Set(withData.map((s) => s.id))
  const sites = jobSiteChoices(all, jobs).sort((a, b) => Number(has.has(b.id)) - Number(has.has(a.id)))
  const site = sites.find((s) => s.id === searchParams.site) ?? sites[0] ?? null
  const data = site ? await getSurveySite(companyId, site.id) : null
  return (
    <SurveyView sites={sites.map((s) => ({ id: s.id, name: s.label, lat: s.lat, lng: s.lng, hasData: has.has(s.id) }))} siteId={site?.id ?? null}
      data={data} addon={addon} demo={demo} canWrite={canWrite && perms.canEdit} canManage={rankOf(perms) >= RANK.manager} />
  )
}
