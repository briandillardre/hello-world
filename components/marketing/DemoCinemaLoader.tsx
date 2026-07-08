'use client'

/**
 * Client-side loader for the cinematic demo. next/dynamic with ssr:false keeps
 * MapLibre (~200KB) out of the marketing page's first paint — visitors get the
 * copy instantly and the theater streams in a beat later.
 */

import dynamic from 'next/dynamic'

const DemoCinema = dynamic(() => import('./DemoCinema'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl overflow-hidden border border-navy-800 shadow-panel bg-[#001120]">
      <div className="aspect-[16/11] sm:aspect-[16/10] w-full skeleton-shimmer" />
      <div className="px-4 py-3 border-t border-navy-800">
        <div className="h-4 w-2/3 mx-auto rounded skeleton-shimmer" />
      </div>
    </div>
  ),
})

export function DemoCinemaLoader() {
  return <DemoCinema />
}
