'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, MoreHorizontal, Wrench, BarChart3, Calculator, Settings, Hexagon, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const primaryItems = [
  { href: '/map', label: 'Map', icon: Map },
  { href: '/assets', label: 'Assets', icon: Package },
  { href: '/alerts', label: 'Alerts', icon: Bell },
]

const moreItems = [
  { href: '/geofences', label: 'Geofences', icon: Hexagon },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/accounting', label: 'Accounting', icon: Calculator },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function BottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreItems.some(i => pathname.startsWith(i.href))

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-[60px] left-0 right-0 bg-navy-950 border-t border-navy-800 rounded-t-2xl p-4 safe-area-pb"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-muted">More</span>
              <button onClick={() => setMoreOpen(false)} className="p-1 text-faint">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {moreItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium',
                    pathname.startsWith(href) ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-navy-900'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-navy-950 border-t border-navy-800 md:hidden safe-area-pb">
        <div className="flex">
          {primaryItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            const isAlerts = href === '/alerts'
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors min-h-[60px]',
                  active ? 'text-amber' : 'text-faint hover:text-muted'
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {isAlerts && alertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-alert text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors min-h-[60px]',
              moreActive || moreOpen ? 'text-amber' : 'text-faint hover:text-muted'
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
