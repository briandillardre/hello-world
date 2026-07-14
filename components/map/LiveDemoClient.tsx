'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowRight, X } from 'lucide-react'
import { MOCK_ASSETS, MOCK_GEOFENCES, MOCK_TOOL_ASSOCIATIONS } from '@/lib/mock-data'
import { generateTracks } from '@/lib/trails'
import { resolveToolLocations, toolsAboard } from '@/lib/tools-resolve'
import { Logo } from '@/components/brand/Logo'

const MapView = dynamic(
  () => import('@/components/map/MapView').then((m) => ({ default: m.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 h-full bg-navy-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-faint font-mono">Loading the live demo…</p>
        </div>
      </div>
    ),
  }
)

/**
 * The PUBLIC live demo — the full real map, seeded fleet, zero login.
 * The marketing pages promise "open the live map"; this is that promise kept
 * (it used to bounce visitors to /login). All data is the simulated Nashville
 * fleet — nothing here touches a real account.
 */
export function LiveDemoClient() {
  const assets = resolveToolLocations(MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS)
  const tracks = generateTracks(assets)

  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of MOCK_TOOL_ASSOCIATIONS) {
    const gw = MOCK_ASSETS.find((a) => a.id === assoc.gateway_asset_id)
    if (gw) toolGateways[assoc.tool_asset_id] = { name: gw.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-navy-950">
      {/* demo chrome: brand + honest label + escape hatches */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-navy-800 bg-navy-950/95 backdrop-blur z-20">
        <Logo size={24} href="/" />
        <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-teal">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-blink" /> Live demo · simulated fleet
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3.5 py-2 hover:bg-amber-600 transition-colors"
          >
            Start free pilot <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/demo" aria-label="Back to overview" className="grid place-items-center w-8 h-8 rounded-lg border border-navy-700 text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>
      <div className="flex-1 relative min-h-0">
        <MapView
          assets={assets}
          geofences={MOCK_GEOFENCES}
          tracks={tracks}
          toolGateways={toolGateways}
          aboard={toolsAboard(MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS)}
        />
        {/* mobile gets the honest label as a floating chip (header is tight) —
            parked under the layers pill so it never covers the type filters */}
        <span className="sm:hidden absolute top-[110px] left-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-navy-950/85 backdrop-blur border border-navy-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-teal">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-blink" /> demo · simulated fleet
        </span>
      </div>
    </div>
  )
}
