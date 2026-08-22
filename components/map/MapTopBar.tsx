'use client'

import { Logo } from '@/components/brand/Logo'
import { TopBarWeather } from './TopBarWeather'

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
  return (
    <div className="flex items-center gap-2.5 md:gap-3 h-8 md:h-11 px-3 md:px-4 bg-navy-950 border-b border-navy-800 flex-none">
      {/* Mobile: full branding (no sidebar there). Desktop: company name only —
          no page title (owner ask, Jul 21), but not an empty strip either. */}
      <span className="md:hidden"><Logo size={22} href="/map" /></span>
      <span className="md:hidden h-4 w-px bg-navy-700" />
      {/* Phone: the company LOGO instead of the spelled-out name (Brian,
          Aug 22 — the truncated "DILLARD CONSTRU…" earned nothing). Name
          stays on desktop; companies without a logo keep the text. */}
      {logoUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt={companyName}
            className="md:hidden h-5 w-5 rounded object-contain flex-none"
            style={logoBg ? { backgroundColor: logoBg } : undefined}
          />
          <span className="hidden md:inline font-mono text-[11px] uppercase tracking-[0.12em] text-faint truncate">{companyName}</span>
        </>
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint truncate">{companyName}</span>
      )}
      <span className="ml-auto flex-none">
        <TopBarWeather place={weatherPlace} coords={weatherCoords} canSetDefault={canSetWeatherDefault} />
      </span>
    </div>
  )
}
