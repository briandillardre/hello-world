import { AlertsView } from '@/components/alerts/AlertsView'
import { getAlertEvents, getAlertRules } from '@/lib/db/alerts'
import { getGeofences } from '@/lib/db/zones'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId, getMyRole } from '@/lib/db/company'

export default async function AlertsPage() {
  const companyId = await getCurrentCompanyId()
  const role = await getMyRole()
  const canEdit = role !== 'viewer'
  const [alerts, rules, geofences, assets] = await Promise.all([
    getAlertEvents(companyId),
    getAlertRules(companyId),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])

  return (
    <AlertsView alerts={alerts} rules={rules} geofences={geofences} assets={assets} editable={canEdit} />
  )
}
