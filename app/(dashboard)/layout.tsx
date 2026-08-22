import { redirect } from 'next/navigation'

// Every dashboard page is per-user (auth cookies). Without this, pages whose
// only cookie access happens inside try/catch data helpers get STATICALLY
// prerendered with the demo fallback baked in — a signed-in user then sees
// "Blue Ridge Sitework Co." served from the build cache.
export const dynamic = 'force-dynamic'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { BusyBar } from '@/components/layout/BusyBar'
import { TzCookie } from '@/components/TzCookie'
import { OfflineSync } from '@/components/field/OfflineSync'
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

  const { getMyPermissions } = await import('@/lib/permissions-server')
  const [company, perms] = await Promise.all([getCurrentCompany(), getMyPermissions()])
  const alerts = await getAlertEvents(company.id)
  // Bell badge = ATTENTION alerts only. Routine enter/exit crossings are the
  // activity log — counting them made the badge cry wolf all day.
  const isActivity = (a: (typeof alerts)[number]) =>
    !a.kind && (a.rule?.trigger === 'enter' || a.rule?.trigger === 'exit')
  const attention = alerts.filter(a => !isActivity(a))
  const unreadAlerts = attention.filter(a => !a.acknowledged_at).length
  const latestAlertAt = attention.reduce<string | null>(
    (m, a) => (m === null || a.triggered_at > m ? a.triggered_at : m), null)

  return (
    // h-[100dvh]: dynamic viewport height — plain 100vh over-measures on iPad/
    // mobile browsers (URL bar chrome), leaving a white band + scrollable page.
    <div className="flex h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden bg-navy-950">
      <TzCookie />
      <OfflineSync />
      <BusyBar />
      <DashboardShell alertCount={unreadAlerts} latestAlertAt={latestAlertAt} companyName={company.name} userName={company.userName} logoUrl={company.logoUrl} logoBg={company.logoBg} navOrder={company.navOrder} role={perms.role}>
        {children}
      </DashboardShell>
    </div>
  )
}
