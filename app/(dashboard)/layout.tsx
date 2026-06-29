import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { getAlertEvents } from '@/lib/db/alerts'
import { getCurrentCompany } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // We gate auth here (no Edge middleware). In real mode, a logged-out visitor is
  // sent to /login instead of seeing an empty dashboard. Demo mode is public.
  if (!isMock) {
    try {
      const { createClient } = await import('@/lib/supabase-server')
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) redirect('/login')
    } catch (e) {
      // Re-throw Next's redirect signal; ignore transient auth-check failures.
      if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e
    }
  }

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
