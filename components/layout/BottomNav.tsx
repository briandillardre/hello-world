'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, MoreHorizontal, Wrench, BarChart3, Calculator, Settings, Hexagon, X, MonitorPlay, Users, LogOut, UserCircle, Rocket, Clock, ClipboardList, TrendingUp, Receipt, Ruler, Bluetooth, Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnseenAlertCount } from './unseen-alerts'

const primaryItems = [
  { href: '/map', label: 'Map', icon: Map },
  { href: '/assets', label: 'Assets', icon: Package },
  { href: '/alerts', label: 'Alerts', icon: Bell },
]

const moreItems = [
  { href: '/zones', label: 'Zones', icon: Hexagon },
  { href: '/measurements', label: 'Measurements', icon: Ruler },
  { href: '/tags', label: 'Tag scanner', icon: Bluetooth },
  { href: '/command', label: 'Command Center', icon: MonitorPlay },
  { href: '/clock', label: 'Time clock', icon: Clock },
  { href: '/logs', label: 'Daily logs', icon: ClipboardList },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/accounting', label: 'Accounting', icon: Calculator },
  { href: '/receipts', label: 'Receipts', icon: Receipt },
  { href: '/finance', label: 'Financials', icon: Scale },
  { href: '/model', label: 'Op model', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/welcome', label: 'Getting started', icon: Rocket },
]

export function BottomNav({ alertCount = 0, latestAlertAt = null, companyName, userName, onSignOut }: {
  alertCount?: number
  latestAlertAt?: string | null
  companyName?: string
  userName?: string | null
  onSignOut?: () => void
}) {
  const pathname = usePathname()
  const unseen = useUnseenAlertCount(alertCount, latestAlertAt)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreItems.some(i => pathname.startsWith(i.href))

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-navy-950 border-t border-navy-800 rounded-t-2xl p-4 max-h-[calc(100dvh-56px)] overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom))]"
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

            {/* Account — who's signed in + sign out */}
            <div className="mt-4 pt-3 border-t border-navy-800">
              <div className="flex items-center gap-2.5 px-1 mb-3">
                <UserCircle className="h-8 w-8 text-faint flex-none" />
                <div className="min-w-0">
                  {userName && <p className="text-sm font-semibold text-ink truncate">{userName}</p>}
                  {companyName && <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint truncate">{companyName}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/settings"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-muted bg-navy-900 hover:text-ink"
                >
                  <Settings className="h-4 w-4" /> Account
                </Link>
                {onSignOut && (
                  <button
                    onClick={() => { setMoreOpen(false); onSignOut() }}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-muted bg-navy-900 hover:text-alert"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <nav data-tour="nav" className="fixed bottom-0 left-0 right-0 z-40 bg-navy-950 border-t border-navy-800 md:hidden safe-area-pb">
        <div className="flex">
          {primaryItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            const isAlerts = href === '/alerts'
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-1 gap-0.5 text-[10.5px] font-medium transition-colors min-h-[46px]',
                  active ? 'text-amber' : 'text-faint hover:text-muted'
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {isAlerts && unseen > 0 && (
                    <span className="absolute -top-1 -right-1 bg-alert text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                      {unseen > 9 ? '9+' : unseen}
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
