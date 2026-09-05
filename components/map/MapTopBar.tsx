'use client'

import { Logo } from '@/components/brand/Logo'
import { TopBarWeather } from './TopBarWeather'
import { TopBarSearch } from './TopBarSearch'

/** Slim banner above the Live Map: brand + company on the left, current
 *  conditions on the right (weather moved up out of the layers menu — owner
 *  ask, Jul 21). The AskAI button floats over the map beside the layers pill. */
export function MapTopBar({ companyName, logoUrl = null, logoBg = null, weatherPlace = null, weatherCoords = null, canSetWeatherDefault = false }: {
  companyName: string
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
      <span className="md:hidden flex items-center"><Logo size={20} href="/map" /></span>
      <span className="hidden md:inline font-mono text-[11px] uppercase tracking-[0.12em] leading-none text-faint truncate">{companyName}</span>
      {/* Desktop: a real search field center-bar (8c-a). Phones get the icon
          in the right cluster below. */}
      <span className="hidden md:flex flex-1 justify-center px-4"><TopBarSearch /></span>
      <span className="ml-auto md:ml-0 flex items-center gap-2.5 min-w-0">
        <span className="md:hidden flex items-center flex-none"><TopBarSearch /></span>
        <span className="flex items-center flex-none">
          <TopBarWeather place={weatherPlace} coords={weatherCoords} canSetDefault={canSetWeatherDefault} />
        </span>
        {logoUrl ? (
          <>
            <span className="md:hidden h-4 w-px bg-navy-700 flex-none" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt={companyName}
              className="md:hidden h-5 w-auto max-w-[72px] rounded object-contain flex-none"
              style={logoBg ? { backgroundColor: logoBg } : undefined}
            />
          </>
        ) : (
          <span className="md:hidden font-mono text-[10px] uppercase tracking-[0.1em] leading-none text-faint truncate max-w-[110px]">{companyName}</span>
        )}
      </span>
      </div>
    </div>
  )
}
