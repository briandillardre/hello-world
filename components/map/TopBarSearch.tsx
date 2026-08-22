'use client'

import { Search } from 'lucide-react'

/**
 * The top bar's search entry (Brian, Aug 22, decision 8c-a: "search moves
 * into the top bar as a real field — finds assets, zones AND addresses").
 * Desktop shows a field; phones get an icon (bar space is spoken for).
 * Tapping either opens the MapSearch overlay, which drops in focused right
 * below this spot — the field "expands" into the real input.
 */
export function TopBarSearch() {
  const open = () => { try { window.dispatchEvent(new CustomEvent('ht:open-search')) } catch { /* SSR */ } }
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="hidden md:flex items-center gap-2 flex-1 max-w-[320px] rounded-lg bg-navy-900 border border-navy-800 hover:border-navy-700 px-3 py-1.5 text-left transition-colors"
      >
        <Search className="h-3.5 w-3.5 text-faint flex-none" />
        <span className="text-[12px] text-faint truncate">Search assets, zones, addresses…</span>
      </button>
      <button
        type="button"
        onClick={open}
        aria-label="Search assets, zones, and addresses"
        className="md:hidden grid place-items-center h-6 w-6 text-faint hover:text-ink transition-colors flex-none"
      >
        <Search className="h-4 w-4" />
      </button>
    </>
  )
}
