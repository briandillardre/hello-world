'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, Settings, Hexagon, LogOut, Wrench, BarChart3, Calculator, MonitorPlay, ChevronLeft, ChevronRight, Users, Rocket, Clock, ClipboardList, Receipt, Ruler, Bluetooth, Scale, Activity, HelpCircle, Sparkles, Cpu, Satellite
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { featureForPath } from '@/lib/permissions'
import { useUnseenAlertCount } from './unseen-alerts'
import { Logo } from '@/components/brand/Logo'

// Grouped by the job being done, not by when features shipped: Watch (live
// awareness), Field (the crew's day), Office (money + people), Setup.
const navSections: { title: string | null; items: { href: string; label: string; icon: typeof Map }[] }[] = [
  { title: null, items: [
    { href: '/map', label: 'Live Map', icon: Map },
    { href: '/command', label: 'Command Center', icon: MonitorPlay },
    { href: '/alerts', label: 'Alerts', icon: Bell },
  ]},
  { title: 'Field', items: [
    { href: '/clock', label: 'Time clock', icon: Clock },
    { href: '/logs', label: 'Daily logs', icon: ClipboardList },
    { href: '/assets', label: 'Assets', icon: Package },
    { href: '/zones', label: 'Zones', icon: Hexagon },
    { href: '/measurements', label: 'Measurements', icon: Ruler },
    { href: '/tags', label: 'Tag scanner', icon: Bluetooth },
    { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  ]},
  { title: 'Office', items: [
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/accounting', label: 'Accounting', icon: Calculator },
    { href: '/receipts', label: 'Receipts', icon: Receipt },
    { href: '/finance', label: 'Financials', icon: Scale },
    { href: '/team', label: 'Team', icon: Users },
    { href: '/activity', label: 'Team activity', icon: Activity },
  ]},
  { title: 'Setup', items: [
    { href: '/trackers', label: 'Trackers', icon: Satellite },
    { href: '/assets/onboard', label: 'Hardware setup', icon: Cpu },
    { href: '/settings', label: 'Settings', icon: Settings },
    { href: '/welcome', label: 'Getting started', icon: Rocket },
    { href: '/help', label: 'Help', icon: HelpCircle },
  ]},
]

interface SidebarProps {
  companyName?: string
  userName?: string | null
  /** Client's own logo (Settings → Company) — shown above the company name. */
  logoUrl?: string | null
  /** Backing fill behind the logo (Settings → Company, 061); null = none. */
  logoBg?: string | null
  alertCount?: number
  latestAlertAt?: string | null
  onSignOut?: () => void
  collapsed?: boolean
  onToggle?: () => void
  /** Command Center kiosk mode: the sidebar OVERLAYS the wall display, and
   *  collapsing removes it entirely — nothing left but the expand arrow in
   *  the same spot as the map view's toggle (owner ask, Jul 21). */
  fullCollapse?: boolean
  /** The caller's view levels (094). null = show everything (demo / pre-094). */
  features?: string[] | null
}

export function Sidebar({ companyName = 'HammerTrack Demo', userName, logoUrl = null, logoBg = null, alertCount = 0, latestAlertAt = null, onSignOut, collapsed = false, onToggle, fullCollapse = false, features = null }: SidebarProps) {
  // Pages outside the caller's view levels don't exist for them — not
  // greyed, not there. (The page itself 404s too; this keeps the two honest.)
  const allowed = (href: string) => { const k = featureForPath(href); return !features || !k || features.includes(k) }
  const sections = navSections.map((sec) => ({ ...sec, items: sec.items.filter((i) => allowed(i.href)) })).filter((sec) => sec.items.length)
  const unseen = useUnseenAlertCount(alertCount, latestAlertAt)
  const pathname = usePathname()
  if (fullCollapse && collapsed) {
    return (
      // Same edge-tab language as the map's LAYERS handle (Brian, Sep 3: the
      // little circle read as nothing — "make it look like layers").
      <button
        onClick={onToggle}
        title="Menu"
        aria-label="Expand sidebar"
        className="fixed left-0 top-[64px] z-[48] flex flex-col items-center gap-1.5 rounded-r-lg bg-navy-950/80 backdrop-blur border border-navy-700 border-l-0 py-2.5 px-1 text-faint hover:text-ink transition-colors"
      >
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal" style={{ writingMode: 'vertical-rl' }}>Menu</span>
      </button>
    )
  }
  return (
    <aside
      className={cn(
        'flex-col bg-navy-950 text-ink h-screen fixed left-0 top-0 border-r border-navy-800 transition-[width] duration-200 print:hidden',
        fullCollapse ? 'flex z-[48]' : 'hidden md:flex z-40',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* brand */}
      <div className={cn('border-b border-navy-800 flex items-center min-h-[54px]', collapsed ? 'justify-center px-2 py-2' : 'px-4 py-3')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2.5">
            <Logo wordmark={false} size={26} href="/map" />
            <button
              data-tour="askai"
              onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
              title="Ask AI"
              aria-label="Ask HammerTrack AI"
              className="grid place-items-center w-9 h-9 rounded-lg bg-amber text-[#1a1100] shadow-glow-amber hover:brightness-110 transition"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="min-w-0 w-full">
            <Logo size={26} href="/map" />
            {/* Client's own logo (Settings → Company) rides above their name,
                rendered AS UPLOADED — no forced white backing; a transparent
                logo sits straight on the navy (owner ask, Aug 7). */}
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={companyName}
                className={'mt-1.5 h-8 max-w-[160px] object-contain object-left' + (logoBg ? ' rounded-md px-1.5 py-0.5' : '')}
                style={logoBg ? { backgroundColor: logoBg } : undefined} />
            )}
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint truncate max-w-[160px] mt-1.5">{companyName}</p>
            {userName && <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint/70 truncate max-w-[160px]">{userName}</p>}
            {/* Ask AI lives up here in the chrome now — the desktop floater
                kept covering page content (Brian, Aug 28). */}
            <button
              data-tour="askai"
              onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
              aria-label="Ask HammerTrack AI"
              className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] py-2 shadow-glow-amber hover:brightness-110 transition"
            >
              <Sparkles className="h-4 w-4" /> Ask AI
            </button>
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

      <nav className="flex-1 p-1.5 overflow-y-auto">
        {sections.map((section, si) => (
        <div key={si} className={si > 0 ? 'mt-1' : ''}>
        {section.title && !collapsed && (
          <p className="px-3 pt-1 pb-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint/70">{section.title}</p>
        )}
        {section.title && collapsed && <div className="mx-3 my-1.5 border-t border-navy-800" />}
        <div className="space-y-0.5">
        {section.items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const isAlerts = href === '/alerts'
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'relative flex items-center rounded-lg text-[13px] font-medium transition-colors',
                collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-[6px]',
                active
                  ? 'bg-amber/15 text-amber border border-amber/30'
                  : 'text-muted hover:text-ink hover:bg-navy-900'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
              {isAlerts && unseen > 0 && (
                collapsed ? (
                  <span className="absolute top-0.5 right-1.5 bg-alert text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
                    {unseen > 9 ? '9+' : unseen}
                  </span>
                ) : (
                  <span className="ml-auto bg-alert text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                    {unseen > 9 ? '9+' : unseen}
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
              collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-[6px]'
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
