import { DashboardShell } from '@/components/layout/DashboardShell'
import { getAlertEvents } from '@/lib/db/alerts'
import { getCurrentCompany } from '@/lib/db/company'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const company = await getCurrentCompany()
  const alerts = await getAlertEvents(company.id)
  const unreadAlerts = alerts.filter(a => !a.acknowledged_at).length

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      <DashboardShell alertCount={unreadAlerts} companyName={company.name} userName={company.userName}>
        {children}
      </DashboardShell>
    </div>
  )
}
