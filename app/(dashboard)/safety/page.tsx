import { requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { getSafety } from '@/lib/db/safety'
import { SafetyView } from '@/components/safety/SafetyView'

export const metadata = { title: 'HammerTrack — Safety' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Toolbox talks the crew signs on the phone, and incident / near-miss / hazard reports (migration 159). */
export default async function SafetyPage() {
  const perms = await requireFeature('logs')
  const companyId = await getCurrentCompanyId()
  const [data, fences] = await Promise.all([getSafety(companyId), getGeofences(companyId).catch(() => [])])
  const sites = fences.filter((f) => !f.owner_id && ((f.kind ?? 'site') === 'site' || f.kind === 'yard')).map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name))
  const canWrite = !perms.viewingAs && !isMock
  return (
    <SafetyView data={data} sites={sites} canWrite={canWrite} canClose={canWrite && rankOf(perms) >= RANK.foreman}
      seesAll={rankOf(perms) >= RANK.foreman} canRemoveAny={rankOf(perms) >= RANK.manager} demo={isMock} />
  )
}
