import { AlertsView } from '@/components/alerts/AlertsView'
import { getAlertEvents, getAlertRules } from '@/lib/db/alerts'
import { getGeofences } from '@/lib/db/zones'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { requireFeature } from '@/lib/permissions-server'
import { scopeFleet, rankOf, RANK } from '@/lib/permissions'

export const metadata = { title: 'HammerTrack — Alerts' }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function AlertsPage() {
  const companyId = await getCurrentCompanyId()
  const perms = await requireFeature('alerts')
  const canEdit = perms.canEdit
  const [alertsAll, rules, geofences, assetsAll] = await Promise.all([
    getAlertEvents(companyId),
    getAlertRules(companyId),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])
  // The page payload carries the fleet: the viewer's slice only (111 for a
  // preview) and no $/day or rates without the costs level.
  const { assets, alerts } = scopeFleet(perms, assetsAll, [], alertsAll)

  return (
    <AlertsView alerts={alerts} rules={rules} geofences={geofences} assets={assets} editable={canEdit}
      // A theft alert's "Start recovery" (132) — Admins and the owner, outside a preview.
      canRecover={!isMock && rankOf(perms) >= RANK.admin && canEdit && !perms.viewingAs} />
  )
}
