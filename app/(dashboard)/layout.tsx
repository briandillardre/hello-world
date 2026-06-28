import { DashboardShell } from '@/components/layout/DashboardShell'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { getAlertEvents } from '@/lib/db/alerts'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const alerts = await getAlertEvents(MOCK_COMPANY.id)
  const unreadAlerts = alerts.filter(a => !a.acknowledged_at).length

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      <DashboardShell alertCount={unreadAlerts}>{children}</DashboardShell>
    </div>
  )
}
