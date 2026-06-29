import { DashboardShell } from '@/components/layout/DashboardShell'
import { getAlertEvents } from '@/lib/db/alerts'
import { getCurrentCompanyId } from '@/lib/db/company'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const alerts = await getAlertEvents(await getCurrentCompanyId())
  const unreadAlerts = alerts.filter(a => !a.acknowledged_at).length

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      <DashboardShell alertCount={unreadAlerts}>{children}</DashboardShell>
    </div>
  )
}
