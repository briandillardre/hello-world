import { Suspense } from 'react'
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
import { LocationPrimer } from '@/components/LocationPrimer'
import { getAlertEvents } from '@/lib/db/alerts'
import { isZoneLogEvent } from '@/lib/alerts-engine'
import { getCurrentCompany } from '@/lib/db/company'
import { AlertBadgeBridge } from '@/components/layout/AlertBadgeBridge'
import { ROLE_LABEL } from '@/lib/permissions'

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

  return (
    // h-[100dvh]: dynamic viewport height — plain 100vh over-measures on iPad/
    // mobile browsers (URL bar chrome), leaving a white band + scrollable page.
    <div className="flex h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden bg-navy-950">
      <TzCookie />
      <OfflineSync />
      {/* First-open GPS ask on phones — see the component for the Play-policy story. */}
      <LocationPrimer />
      <BusyBar />
      {/* The bell badge streams in AFTER the shell paints — every dashboard
          navigation used to block on the alerts query (owner ask, Aug 25:
          "almost always snappy"). Badge count pops in via the bridge. */}
      <Suspense fallback={null}>
        <AlertBadgeFeed companyId={company.id} />
      </Suspense>
      <DashboardShell alertCount={0} latestAlertAt={null} companyName={company.name} userName={company.userName} logoUrl={company.logoUrl} logoBg={company.logoBg} navOrder={company.navOrder} role={perms.role} features={perms.features} viewingAs={perms.viewingAs ? { name: perms.viewingAs.name, roleLabel: ROLE_LABEL[perms.viewingAs.role] } : null}>
        {children}
      </DashboardShell>
    </div>
  )
}

/** Async server component: fetches the alert list off the critical path and
 *  hands the badge numbers to the client bridge (Sidebar + BottomNav pick
 *  them up through useUnseenAlertCount). */
async function AlertBadgeFeed({ companyId }: { companyId: string }) {
  const alerts = await getAlertEvents(companyId)
  // Bell badge = ATTENTION alerts only. Routine enter/exit crossings are the
  // activity log — counting them made the badge cry wolf all day.
  const attention = alerts.filter(a => !isZoneLogEvent(a))
  const unreadAlerts = attention.filter(a => !a.acknowledged_at).length
  const latestAlertAt = attention.reduce<string | null>(
    (m, a) => (m === null || a.triggered_at > m ? a.triggered_at : m), null)
  return <AlertBadgeBridge count={unreadAlerts} latest={latestAlertAt} />
}
