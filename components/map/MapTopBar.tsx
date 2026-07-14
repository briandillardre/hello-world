'use client'

import { Logo } from '@/components/brand/Logo'

/** Slim banner above the Live Map: brand + company. The AskAI button floats
 *  over the map beside the layers pill (owner layout, Jul 14). */
export function MapTopBar({ companyName }: { companyName: string }) {
  return (
    <div className="flex items-center gap-3 h-11 px-3 md:px-4 bg-navy-950 border-b border-navy-800 flex-none">
      {/* Mobile: full branding (no sidebar there). Desktop: the sidebar already
          shows logo + company, so just a section label — no double branding. */}
      <span className="md:hidden"><Logo size={22} href="/map" /></span>
      <span className="md:hidden h-4 w-px bg-navy-700" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint truncate">
        <span className="md:hidden">{companyName}</span>
        <span className="hidden md:inline">Live map</span>
      </span>
    </div>
  )
}
