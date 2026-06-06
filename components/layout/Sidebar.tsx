'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, Settings, Hexagon, LogOut, Wrench, BarChart3, Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'

const navItems = [
  { href: '/map', label: 'Live Map', icon: Map },
  { href: '/assets', label: 'Assets', icon: Package },
  { href: '/geofences', label: 'Geofences', icon: Hexagon },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/accounting', label: 'Accounting', icon: Calculator },
  { href: '/settings', label: 'Settings', icon: Settings },
]

interface SidebarProps {
  companyName?: string
  alertCount?: number
  onSignOut?: () => void
}

export function Sidebar({ companyName = 'HammerTrack Demo', alertCount = 0, onSignOut }: SidebarProps) {
  const pathname = usePathname()
  return (
    <aside className="hidden md:flex flex-col w-56 bg-navy-950 text-ink h-screen fixed left-0 top-0 z-40 border-r border-navy-800">
      <div className="p-4 border-b border-navy-800">
        <Logo size={28} />
        <p className="text-xs text-faint truncate max-w-[180px] mt-2">{companyName}</p>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const isAlerts = href === '/alerts'
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-amber/15 text-amber border border-amber/30'
                  : 'text-muted hover:text-ink hover:bg-navy-900'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span>{label}</span>
              {isAlerts && alertCount > 0 && (
                <span className="ml-auto bg-alert text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {onSignOut && (
        <div className="p-3 border-t border-navy-800">
          <button
            onClick={onSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-ink hover:bg-navy-900 w-full transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}
