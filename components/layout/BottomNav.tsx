'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Map, Package, Bell, MoreHorizontal, Sparkles, Wrench, BarChart3, Calculator, Settings, Hexagon, X, MonitorPlay, Users, LogOut, UserCircle, Rocket, Clock, ClipboardList, Receipt, Ruler, Bluetooth, Scale, Radio, HelpCircle, Pencil, Check, Cpu
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnseenAlertCount } from './unseen-alerts'

// ONE ordered list of every phone destination. The first 4 fill the bottom
// bar (AskAI keeps the center seat); everything shows in the More drawer,
// bar members highlighted. The owner reorders from the drawer's Edit mode
// (Brian, Aug 22) — saved to the profile so it follows the user to any
// phone, with localStorage as the demo/offline fallback. `short` is the
// bar label: the bar's 5-way split fits one word, and two-line labels
// knocked the icons out of line (Brian, 3:57 AM screenshot).
const allItems = [
  { href: '/map', label: 'Map', icon: Map },
  { href: '/assets', label: 'Assets', icon: Package },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/clock', label: 'Time clock', short: 'Clock', icon: Clock },
  { href: '/zones', label: 'Zones', icon: Hexagon },
  { href: '/measurements', label: 'Measurements', short: 'Measure', icon: Ruler },
  { href: '/tags', label: 'Tag scanner', short: 'Tags', icon: Bluetooth },
  { href: '/command', label: 'Command Center', short: 'Command', icon: MonitorPlay },
  { href: '/track', label: 'Share location', short: 'Live', icon: Radio },
  { href: '/logs', label: 'Daily logs', short: 'Logs', icon: ClipboardList },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/maintenance', label: 'Maintenance', short: 'Service', icon: Wrench },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/accounting', label: 'Accounting', short: 'Books', icon: Calculator },
  { href: '/receipts', label: 'Receipts', icon: Receipt },
  { href: '/finance', label: 'Financials', short: 'Finance', icon: Scale },
  { href: '/assets/onboard', label: 'Hardware setup', short: 'Hardware', icon: Cpu },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/welcome', label: 'Getting started', short: 'Start', icon: Rocket },
  { href: '/help', label: 'Help', icon: HelpCircle },
] as { href: string; label: string; short?: string; icon: typeof Map }[]
const DEFAULT_ORDER = allItems.map((i) => i.href)
const ORDER_KEY = 'ht_nav_order_v1'
const BAR_COUNT = 5
// Plain object, not a Map — the lucide `Map` icon import shadows the global.
const byHref: Record<string, (typeof allItems)[number]> = Object.fromEntries(allItems.map((i) => [i.href, i]))

// Role-DEFAULT bars (Grok-doc consensus, Brian: "yes i think so"): nobody
// curates five slots on day one — the role picks a sensible bar, and the
// Edit mode + profile save personalize from there.
const ROLE_BARS: Record<string, string[]> = {
  admin:   ['/map', '/command', '/alerts', '/clock', '/assets'],
  manager: ['/map', '/assets', '/alerts', '/clock', '/reports'],
  foreman: ['/map', '/clock', '/alerts', '/logs', '/track'],
  viewer:  ['/map', '/assets', '/alerts', '/zones', '/reports'],
}
const canonOrder = (role?: string | null): string[] => {
  const bar = ROLE_BARS[role ?? ''] ?? ROLE_BARS.admin
  return [...bar, ...DEFAULT_ORDER.filter((h) => !bar.includes(h))]
}

// The More drawer groups by JOB (same architecture as the desktop sidebar —
// the flat 19-tile grid threw that information away). Visual only: the
// user's saved order still decides the bar and the edit grid.
const DRAWER_GROUPS: { title: string; hrefs: string[] }[] = [
  { title: 'Watch',  hrefs: ['/map', '/command', '/alerts'] },
  { title: 'Field',  hrefs: ['/clock', '/logs', '/assets', '/zones', '/measurements', '/tags', '/maintenance', '/track'] },
  { title: 'Office', hrefs: ['/reports', '/accounting', '/receipts', '/finance', '/team'] },
  { title: 'Setup',  hrefs: ['/settings', '/welcome', '/help'] },
]

// Drop unknown hrefs, splice newly-shipped pages in at their canonical slot
// (never buried at the tail), or null if nothing usable survives.
function sanitizeOrder(saved: unknown, canon: string[]): string[] | null {
  if (!Array.isArray(saved)) return null
  const kept = (saved as string[]).filter((h) => h in byHref)
  if (!kept.length) return null
  const next = [...kept]
  for (const h of canon) {
    if (!next.includes(h)) next.splice(canon.indexOf(h), 0, h)
  }
  return next
}

export function BottomNav({ alertCount = 0, latestAlertAt = null, companyName, userName, navOrder = null, role = null, onSignOut }: {
  alertCount?: number
  latestAlertAt?: string | null
  companyName?: string
  userName?: string | null
  /** Saved bar order from the user's profile (null = none saved / demo). */
  navOrder?: string[] | null
  /** Signed-in role — picks the DEFAULT bar when nothing is saved. */
  role?: string | null
  onSignOut?: () => void
}) {
  const pathname = usePathname()
  const unseen = useUnseenAlertCount(alertCount, latestAlertAt)
  const [moreOpen, setMoreOpen] = useState(false)
  // Profile order renders server-side (no flash, follows the user across
  // phones); localStorage only fills in for demo mode / pre-070 deploys.
  // With nothing saved anywhere, the ROLE picks the bar.
  const canon = canonOrder(role)
  const [order, setOrder] = useState<string[]>(() => sanitizeOrder(navOrder, canon) ?? canon)
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (navOrder?.length) return
    try {
      const saved = sanitizeOrder(JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'), canonOrder(role))
      if (saved) setOrder(saved)
    } catch { /* default order */ }
  }, [navOrder, role])

  // Write-through: localStorage for instant demo/offline recall, the profile
  // for "next open, any phone, same user". The server save is DEBOUNCED to
  // the latest arrangement only — rapid swaps must never commit out of order
  // and leave a stale profile beating the fresher local copy (ship-check).
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<string[] | null>(null)
  const persist = (next: string[]) => {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)) } catch {}
    pendingSave.current = next
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      pendingSave.current = null
      import('@/lib/actions/nav').then(({ saveNavOrderAction }) => saveNavOrderAction(next)).catch(() => {})
    }, 800)
  }
  // Flush a pending save on unmount — navigating to /command (its own nav
  // tree) inside the debounce window must not drop the profile write
  // (ship-check P2).
  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    const last = pendingSave.current
    if (last) import('@/lib/actions/nav').then(({ saveNavOrderAction }) => saveNavOrderAction(last)).catch(() => {})
  }, [])

  // FIVE list items ride the bar — 3 · AskAI · 2 + More, so AskAI sits dead
  // center of the 7 cells (Brian, Aug 22: "update this to five and center
  // the ask AI").
  const ordered = order.map((h) => byHref[h]).filter(Boolean)
  const barItems = ordered.slice(0, BAR_COUNT)
  const moreActive = ordered.slice(BAR_COUNT).some((i) => pathname.startsWith(i.href))

  const swap = (a: string, b: string) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    if (ia < 0 || ib < 0) return
    const next = [...order]
    ;[next[ia], next[ib]] = [next[ib], next[ia]]
    setOrder(next)
    persist(next)
  }
  const resetOrder = () => {
    setOrder(canon)
    setSel(null)
    try { localStorage.removeItem(ORDER_KEY) } catch {}
    persist(canon)
  }

  // Tell the rest of the UI (the Ask launcher) the drawer is up: a body
  // attribute for CSS, plus a ht:drawer event (same pattern as ht:dialog).
  useEffect(() => {
    if (moreOpen) document.body.setAttribute('data-ht-drawer-open', '')
    else document.body.removeAttribute('data-ht-drawer-open')
    window.dispatchEvent(new CustomEvent('ht:drawer', { detail: { open: moreOpen } }))
    return () => document.body.removeAttribute('data-ht-drawer-open')
  }, [moreOpen])

  const closeDrawer = () => { setMoreOpen(false); setEditing(false); setSel(null) }

  const alertBadge = (href: string) => href === '/alerts' && unseen > 0 && (
    <span className="absolute -top-1 -right-1 bg-alert text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
      {unseen > 9 ? '9+' : unseen}
    </span>
  )

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 md:hidden print:hidden" onClick={closeDrawer}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-navy-950 border-t border-navy-800 rounded-t-2xl p-4 max-h-[calc(100dvh-56px)] overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom))]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-muted">More</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditing(v => !v); setSel(null) }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                    editing ? 'bg-amber text-[#1a1100]' : 'text-faint hover:text-ink'
                  )}
                >
                  {editing ? <><Check className="h-3.5 w-3.5" /> Done</> : <><Pencil className="h-3.5 w-3.5" /> Edit</>}
                </button>
                <button onClick={closeDrawer} className="p-2.5 text-faint">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-faint mb-3">
              {editing
                ? 'Tap two tiles to swap them — the first 5 fill your bottom bar.'
                : 'Pinned tiles (amber) fill your bottom bar.'}
            </p>
            {(() => {
              const renderTile = (item: (typeof allItems)[number]) => {
                const { href, label, icon: Icon } = item
                const idx = ordered.indexOf(item)
                const inBar = idx < BAR_COUNT
                const active = pathname.startsWith(href)
                const tile = (
                  <>
                    <span className="relative">
                      <Icon className="h-5 w-5" />
                      {alertBadge(href)}
                    </span>
                    {label}
                    {inBar && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber" />}
                  </>
                )
                const base = cn(
                  'relative flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium',
                  active && !editing ? 'bg-amber/15 text-amber'
                    : inBar ? 'bg-amber/[0.07] border border-amber/25 text-muted'
                    : 'text-muted',
                  !editing && 'hover:bg-navy-900'
                )
                return editing ? (
                  <button
                    key={href}
                    onClick={() => {
                      if (sel === null) setSel(href)
                      else if (sel === href) setSel(null)
                      else { swap(sel, href); setSel(null) }
                    }}
                    className={cn(base, 'border border-dashed',
                      sel === href ? 'border-amber bg-amber/15 text-amber' : inBar ? 'border-amber/40' : 'border-navy-700')}
                  >
                    {tile}
                  </button>
                ) : (
                  <Link key={href} href={href} onClick={closeDrawer} className={base}>
                    {tile}
                  </Link>
                )
              }
              // Edit mode: the FLAT ordered grid (order is what you're
              // editing). Browsing: grouped by job, same architecture as the
              // desktop sidebar (Grok-doc consensus).
              return editing ? (
                <div className="grid grid-cols-3 gap-3">{ordered.map(renderTile)}</div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    // Catch-all: a page that ships without a DRAWER_GROUPS
                    // entry must still be reachable — it lands in "Other"
                    // instead of silently vanishing from browse mode.
                    const grouped = new Set(DRAWER_GROUPS.flatMap((g) => g.hrefs))
                    const groups = [...DRAWER_GROUPS, { title: 'Other', hrefs: ordered.map((i) => i.href).filter((h) => !grouped.has(h)) }]
                    return groups.map((g) => {
                      const items = ordered.filter((i) => g.hrefs.includes(i.href))
                      if (!items.length) return null
                      return (
                        <div key={g.title}>
                          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1.5">{g.title}</p>
                          <div className="grid grid-cols-3 gap-3">{items.map(renderTile)}</div>
                        </div>
                      )
                    })
                  })()}
                </div>
              )
            })()}
            {editing && (
              <button onClick={resetOrder} className="mt-3 text-xs text-faint underline underline-offset-2 hover:text-ink">
                Reset to default order
              </button>
            )}

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
                  onClick={closeDrawer}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-muted bg-navy-900 hover:text-ink"
                >
                  <Settings className="h-4 w-4" /> Account
                </Link>
                {onSignOut && (
                  <button
                    onClick={() => { closeDrawer(); onSignOut() }}
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

      <nav data-tour="nav" className="fixed bottom-0 left-0 right-0 z-40 bg-navy-950 border-t border-navy-800 md:hidden print:hidden safe-area-pb">
        <div className="flex">
          {/* AskAI rides the CENTER of the bar (Brian, Aug 22: "AskAI needs
              to be in the bottom bar, not on the map") — the classic raised
              middle action, one thumb-tap from anywhere. */}
          {barItems.slice(0, 3).map(({ href, label, short, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 text-[11px] font-medium transition-colors min-h-[56px]',
                  active ? 'text-amber' : 'text-faint hover:text-muted'
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {alertBadge(href)}
                </span>
                <span className="min-w-0 max-w-full truncate text-[10px]">{short ?? label}</span>
              </Link>
            )
          })}
          <button
            data-tour="askai"
            onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
            aria-label="Ask HammerTrack AI"
            className="flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 text-[11px] font-semibold min-h-[56px]"
          >
            <span className="grid place-items-center w-10 h-10 -mt-5 rounded-full bg-amber text-[#1a1100] shadow-glow-amber border-4 border-navy-950">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="-mt-0.5 text-amber">Ask AI</span>
          </button>
          {barItems.slice(3).map(({ href, label, short, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 text-[11px] font-medium transition-colors min-h-[56px]',
                  active ? 'text-amber' : 'text-faint hover:text-muted'
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {alertBadge(href)}
                </span>
                <span className="min-w-0 max-w-full truncate text-[10px]">{short ?? label}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-1.5 gap-0.5 text-[11px] font-medium transition-colors min-h-[56px]',
              moreActive || moreOpen ? 'text-amber' : 'text-faint hover:text-muted'
            )}
          >
            {/* If Alerts was swapped into the drawer, its unseen badge rides
                the More button — a theft alert must never be invisible. */}
            <span className="relative">
              <MoreHorizontal className="h-5 w-5" />
              {order.indexOf('/alerts') >= BAR_COUNT && alertBadge('/alerts')}
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
