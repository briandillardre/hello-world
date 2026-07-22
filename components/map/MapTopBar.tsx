'use client'

import { Logo } from '@/components/brand/Logo'
import { TopBarWeather } from './TopBarWeather'

/** Slim banner above the Live Map: brand + company on the left, current
 *  conditions on the right (weather moved up out of the layers menu — owner
 *  ask, Jul 21). The AskAI button floats over the map beside the layers pill. */
export function MapTopBar({ companyName, weatherPlace = null, weatherCoords = null }: {
  companyName: string
  weatherPlace?: string | null
  weatherCoords?: { lat: number; lng: number } | null
}) {
  // Phones get a slimmer bar (h-8) — every vertical pixel is map space.
  return (
    <div className="flex items-center gap-2.5 md:gap-3 h-8 md:h-11 px-3 md:px-4 bg-navy-950 border-b border-navy-800 flex-none">
      {/* Mobile: full branding (no sidebar there). Desktop: the sidebar already
          shows logo + company, so just a section label — no double branding. */}
      <span className="md:hidden"><Logo size={22} href="/map" /></span>
      <span className="md:hidden h-4 w-px bg-navy-700" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint truncate">
        <span className="md:hidden">{companyName}</span>
        <span className="hidden md:inline">Live map</span>
      </span>
      <span className="ml-auto flex-none">
        <TopBarWeather place={weatherPlace} coords={weatherCoords} />
      </span>
    </div>
  )
}
