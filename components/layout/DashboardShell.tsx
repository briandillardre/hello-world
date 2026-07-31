'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'
import { signOutAction } from '@/lib/actions/auth'

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
  children,
}: {
  alertCount: number
  latestAlertAt?: string | null
  companyName?: string
  userName?: string | null
  logoUrl?: string | null
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

  return (
    <>
      <Sidebar alertCount={alertCount} latestAlertAt={latestAlertAt} companyName={companyName} userName={userName} logoUrl={logoUrl} collapsed={collapsed} onToggle={toggle} onSignOut={signOutAction} />
      <main className={(collapsed ? 'md:ml-16' : 'md:ml-56') + ' flex-1 overflow-hidden transition-[margin] duration-200'}>
        {children}
      </main>
      <BottomNav alertCount={alertCount} latestAlertAt={latestAlertAt} companyName={companyName} userName={userName} onSignOut={signOutAction} />
      <AssistantWidget />
    </>
  )
}
