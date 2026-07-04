'use client'

import { Sparkles } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'

/** Slim Command-Center-style banner above the Live Map: brand + company on the
 *  left, Ask on the right. Keeps the map surface clean (no floating Ask). */
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
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber text-[#1a1100] font-display font-bold text-sm px-3.5 py-1.5 shadow-glow-amber hover:brightness-110 transition"
      >
        <Sparkles className="h-4 w-4" /> Ask
      </button>
    </div>
  )
}
