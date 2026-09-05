'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Building2, Users, Radio, LogOut } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { TopBarWeather } from './TopBarWeather'
import { TopBarSearch } from './TopBarSearch'
import { signOutAction } from '@/lib/actions/auth'
import { featureForPath } from '@/lib/permissions'

/** Zoom to the whole fleet — the same action as the ⤢ map button. */
const fitFleet = () => document.querySelector<HTMLButtonElement>('.ht-fitall')?.click()

/** The company mark is the account door (Brian, Sep 4: "the company icon
 *  needs to do something"): one tap opens Company settings, Team, Trackers
 *  and Sign out — the avatar-slot menu every big app trains thumbs on. */
function CompanyMenu({ companyName, features, children }: { companyName: string; features?: string[] | null; children: React.ReactNode }) {
  // Roles v2 nav rule: a page outside your view levels is absent from every
  // nav (sec-check, Sep 5) — same gate Sidebar/BottomNav use.
  const canSee = (href: string) => { const f = featureForPath(href); return !f || !features || features.includes(f) }
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc) }
  }, [open])
  const item = 'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold text-ink hover:bg-navy-800 transition-colors'
  return (
    <div ref={ref} className="relative flex items-center">
      <button type="button" onClick={() => setOpen((v) => !v)} title={companyName} aria-label={`${companyName} — account menu`} aria-expanded={open} className="flex items-center rounded-md hover:bg-navy-800/60 transition-colors">
        {children}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-[60] w-[230px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-1.5 pointer-events-auto">
          <p className="px-3 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint truncate">{companyName}</p>
          {canSee('/settings') && <Link href="/settings" className={item} onClick={() => setOpen(false)}><Building2 className="h-4 w-4 text-teal" /> Company settings</Link>}
          {canSee('/team') && <Link href="/team" className={item} onClick={() => setOpen(false)}><Users className="h-4 w-4 text-teal" /> Team</Link>}
          {canSee('/trackers') && <Link href="/trackers" className={item} onClick={() => setOpen(false)}><Radio className="h-4 w-4 text-teal" /> Trackers</Link>}
          {(canSee('/settings') || canSee('/team') || canSee('/trackers')) && <div className="my-1 border-t border-navy-800" />}
          <button type="button" onClick={() => signOutAction()} className={item + ' w-full text-left text-faint hover:text-alert'}><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      )}
    </div>
  )
}

/** Slim banner above the Live Map: brand + company on the left, current
 *  conditions on the right (weather moved up out of the layers menu — owner
 *  ask, Jul 21). The AskAI button floats over the map beside the layers pill. */
export function MapTopBar({ companyName, logoUrl = null, logoBg = null, weatherPlace = null, weatherCoords = null, canSetWeatherDefault = false, features = null }: {
  companyName: string
  /** The viewer's view levels — the account menu hides pages outside them. */
  features?: string[] | null
  logoUrl?: string | null
  logoBg?: string | null
  weatherPlace?: string | null
  weatherCoords?: { lat: number; lng: number } | null
  canSetWeatherDefault?: boolean
}) {
  // Phones get a slimmer bar (h-8) — every vertical pixel is map space.
  // Order (Brian, Aug 22, best-in-class pass): PRODUCT brand anchors the
  // left edge, the COMPANY identity sits outermost right — the avatar slot
  // every big app trains thumbs on — with the tappable weather just inside
  // it. Every child pins to the flex centerline (the marks and wordmark
  // carry different baselines and drifted).
  // Phones: the map runs edge-to-edge under the status bar, Google-Maps
  // style, and this bar FLOATS over it as a translucent pill — out of the
  // flex flow, offset by the OS safe-area inset (the native shell overlays
  // the status bar; browsers report 0). Desktop keeps the in-flow bar
  // (Brian, Sep 4: "go full screen with the mobile app like Google Maps").
  return (
    <div className="ht-map-topbar absolute md:static inset-x-0 top-0 z-[45] md:z-auto pointer-events-none md:pointer-events-auto md:flex md:items-center md:gap-3 md:h-11 md:px-4 md:bg-navy-950 md:border-b md:border-navy-800 md:flex-none"
      style={{ paddingTop: 'var(--ht-map-inset, 0px)' }}>
      <div className="pointer-events-auto mx-2 mt-2 md:m-0 flex items-center gap-2.5 md:gap-3 h-10 md:h-auto px-3 md:px-0 rounded-2xl md:rounded-none bg-navy-950/85 md:bg-transparent backdrop-blur md:backdrop-blur-0 border md:border-0 border-navy-800/80 shadow-lg md:shadow-none md:flex-1">
      {/* Mobile: full branding (no sidebar there). Desktop: company name only —
          no page title (owner ask, Jul 21), but not an empty strip either. */}
      {/* Brand mark on the map = "show me my whole fleet" (Brian, Sep 4: the
          logo has to do something) — the same zoom-to-all as the ⤢ button. */}
      <button type="button" onClick={fitFleet} title="Zoom to your whole fleet" aria-label="Zoom to all assets" className="md:hidden flex items-center"><Logo size={20} href={null} /></button>
      <span className="hidden md:flex items-center">
        <CompanyMenu companyName={companyName} features={features}>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] leading-none text-faint hover:text-ink truncate px-1 py-1">{companyName}</span>
        </CompanyMenu>
      </span>
      {/* Desktop: a real search field center-bar (8c-a). Phones get the icon
          in the right cluster below. */}
      <span className="hidden md:flex flex-1 justify-center px-4"><TopBarSearch /></span>
      <span className="ml-auto md:ml-0 flex items-center gap-2.5 min-w-0">
        <span className="md:hidden flex items-center flex-none"><TopBarSearch /></span>
        <span className="flex items-center flex-none">
          <TopBarWeather place={weatherPlace} coords={weatherCoords} canSetDefault={canSetWeatherDefault} />
        </span>
        <span className="md:hidden flex items-center gap-2.5">
          <span className="h-4 w-px bg-navy-700 flex-none" />
          <CompanyMenu companyName={companyName} features={features}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName}
                className="h-5 w-auto max-w-[72px] rounded object-contain flex-none"
                style={logoBg ? { backgroundColor: logoBg } : undefined}
              />
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] leading-none text-faint truncate max-w-[110px]">{companyName}</span>
            )}
          </CompanyMenu>
        </span>
      </span>
      </div>
    </div>
  )
}
