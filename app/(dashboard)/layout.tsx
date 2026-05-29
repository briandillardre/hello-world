import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { MOCK_ALERTS } from '@/lib/mock-data'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const unreadAlerts = MOCK_ALERTS.filter(a => !a.acknowledged_at).length

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar alertCount={unreadAlerts} />
      <main className="flex-1 md:ml-56 overflow-hidden">
        {children}
      </main>
      <BottomNav alertCount={unreadAlerts} />
    </div>
  )
}
