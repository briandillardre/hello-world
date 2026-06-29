import { AlertsView } from '@/components/alerts/AlertsView'
import { getAlertEvents, getAlertRules } from '@/lib/db/alerts'
import { getGeofences } from '@/lib/db/geofences'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function AlertsPage() {
  const companyId = await getCurrentCompanyId()
  const [alerts, rules, geofences, assets] = await Promise.all([
    getAlertEvents(companyId),
    getAlertRules(companyId),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])

  return (
    <AlertsView alerts={alerts} rules={rules} geofences={geofences} assets={assets} editable={!isMock} />
  )
}
