'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'
import { signOutAction } from '@/lib/actions/auth'
import { ViewAsBanner } from './ViewAsBanner'

/**
 * Client shell for the dashboard: owns the collapsible-sidebar state so the
 * main content margin tracks the sidebar width. Data (alert count) is fetched
 * in the server layout and passed in.
 */
export function DashboardShell({
  alertCount,
  latestAlertAt = null,
  companyName,
  userName,
  logoUrl = null,
  logoBg = null,
  navOrder = null,
  role = null,
  features = null,
  viewingAs = null,
  children,
}: {
  alertCount: number
  latestAlertAt?: string | null
  companyName?: string
  userName?: string | null
  logoUrl?: string | null
  logoBg?: string | null
  navOrder?: string[] | null
  role?: string | null
  /** The caller's view levels (094) — filters both navs. null = everything. */
  features?: string[] | null
  /** Set while an admin previews the app as a teammate (read-only). */
  viewingAs?: { name: string; roleLabel: string } | null
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    setCollapsed(localStorage.getItem('ht-sidebar') === '1')
  }, [])
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('ht-sidebar', next ? '1' : '0')
      return next
    })

  const askAi = !features || features.includes('ask_ai')
  // The map runs edge-to-edge under the (overlaid) status bar; every other
  // page pads for it so its header is not under the clock.
  const pathname = usePathname()
  const edge = pathname?.startsWith('/map')
  return (
    <>
      <Sidebar alertCount={alertCount} latestAlertAt={latestAlertAt} companyName={companyName} userName={userName} logoUrl={logoUrl} logoBg={logoBg} collapsed={collapsed} onToggle={toggle} onSignOut={signOutAction} features={features} askAi={askAi} />
      <main className={(collapsed ? 'md:ml-16' : 'md:ml-56') + ' flex-1 overflow-hidden transition-[margin] duration-200 flex flex-col' + (edge ? '' : ' ht-page-inset')}>
        {viewingAs && <ViewAsBanner name={viewingAs.name} roleLabel={viewingAs.roleLabel} />}
        <div className="flex-1 min-h-0 overflow-hidden ht-nav-inset">{children}</div>
      </main>
      <BottomNav alertCount={alertCount} latestAlertAt={latestAlertAt} companyName={companyName} userName={userName} navOrder={navOrder} role={role} features={features} askAi={askAi} onSignOut={signOutAction} />
      {askAi && <AssistantWidget />}
    </>
  )
}
