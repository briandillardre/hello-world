'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'

/**
 * Client shell for the dashboard: owns the collapsible-sidebar state so the
 * main content margin tracks the sidebar width. Data (alert count) is fetched
 * in the server layout and passed in.
 */
export function DashboardShell({
  alertCount,
  companyName,
  userName,
  children,
}: {
  alertCount: number
  companyName?: string
  userName?: string | null
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
      <Sidebar alertCount={alertCount} companyName={companyName} userName={userName} collapsed={collapsed} onToggle={toggle} />
      <main className={(collapsed ? 'md:ml-16' : 'md:ml-56') + ' flex-1 overflow-hidden transition-[margin] duration-200'}>
        {children}
      </main>
      <BottomNav alertCount={alertCount} />
      <AssistantWidget />
    </>
  )
}
