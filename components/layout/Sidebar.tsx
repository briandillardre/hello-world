'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, Settings, Hexagon, LogOut, Wrench, BarChart3, Calculator, MonitorPlay, ChevronLeft, ChevronRight, Users, Rocket, Clock, ClipboardList, TrendingUp, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'

// Grouped by the job being done, not by when features shipped: Watch (live
// awareness), Field (the crew's day), Office (money + people), Setup.
const navSections: { title: string | null; items: { href: string; label: string; icon: typeof Map }[] }[] = [
  { title: null, items: [
    { href: '/command', label: 'Command Center', icon: MonitorPlay },
    { href: '/map', label: 'Live Map', icon: Map },
    { href: '/alerts', label: 'Alerts', icon: Bell },
  ]},
  { title: 'Field', items: [
    { href: '/clock', label: 'Time clock', icon: Clock },
    { href: '/logs', label: 'Daily logs', icon: ClipboardList },
    { href: '/assets', label: 'Assets', icon: Package },
    { href: '/geofences', label: 'Zones', icon: Hexagon },
    { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  ]},
  { title: 'Office', items: [
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/accounting', label: 'Accounting', icon: Calculator },
    { href: '/receipts', label: 'Receipts', icon: Receipt },
    { href: '/model', label: 'Op model', icon: TrendingUp },
    { href: '/team', label: 'Team', icon: Users },
  ]},
  { title: 'Setup', items: [
    { href: '/settings', label: 'Settings', icon: Settings },
    { href: '/welcome', label: 'Getting started', icon: Rocket },
  ]},
]

interface SidebarProps {
  companyName?: string
  userName?: string | null
  alertCount?: number
  onSignOut?: () => void
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ companyName = 'HammerTrack Demo', userName, alertCount = 0, onSignOut, collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname()
  return (
    <aside
      className={cn(
        'hidden md:flex flex-col bg-navy-950 text-ink h-screen fixed left-0 top-0 z-40 border-r border-navy-800 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* brand */}
      <div className={cn('border-b border-navy-800 flex items-center min-h-[68px]', collapsed ? 'justify-center px-2' : 'px-4')}>
        {collapsed ? (
          <Logo wordmark={false} size={26} href="/map" />
        ) : (
          <div className="min-w-0">
            <Logo size={26} href="/map" />
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint truncate max-w-[160px] mt-1.5">{companyName}</p>
            {userName && <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint/70 truncate max-w-[160px]">{userName}</p>}
          </div>
        )}
      </div>

      {/* collapse toggle — circular chevron on the top of the right seam (Wix-style) */}
      {onToggle && (
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-[22px] -right-3 z-50 grid place-items-center w-7 h-7 rounded-full bg-navy-900 border border-navy-700 text-faint shadow-md hover:text-ink hover:border-teal/60 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      )}

      <nav className="flex-1 p-2 overflow-y-auto">
        {navSections.map((section, si) => (
        <div key={si} className={si > 0 ? 'mt-2' : ''}>
        {section.title && !collapsed && (
          <p className="px-3 pt-1.5 pb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint/70">{section.title}</p>
        )}
        {section.title && collapsed && <div className="mx-3 my-2 border-t border-navy-800" />}
        <div className="space-y-1">
        {section.items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const isAlerts = href === '/alerts'
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'relative flex items-center rounded-lg text-sm font-medium transition-colors',
                collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2.5',
                active
                  ? 'bg-amber/15 text-amber border border-amber/30'
                  : 'text-muted hover:text-ink hover:bg-navy-900'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
              {isAlerts && alertCount > 0 && (
                collapsed ? (
                  <span className="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-alert" />
                ) : (
                  <span className="ml-auto bg-alert text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )
              )}
            </Link>
          )
        })}
        </div>
        </div>
        ))}
      </nav>

      {onSignOut && (
        <div className="p-2 border-t border-navy-800">
          <button
            onClick={onSignOut}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex items-center rounded-lg text-sm font-medium text-muted hover:text-ink hover:bg-navy-900 w-full transition-colors',
              collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2.5'
            )}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      )}
    </aside>
  )
}
