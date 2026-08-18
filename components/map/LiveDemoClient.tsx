'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ArrowRight, X, MonitorPlay, Map as MapIcon, Bell, Clock, ClipboardList,
  Package, Hexagon, Ruler, Bluetooth, Wrench, BarChart3, Calculator,
  Receipt, Banknote, TrendingUp, Lock,
} from 'lucide-react'
import { MOCK_ASSETS, MOCK_GEOFENCES, MOCK_TOOL_ASSOCIATIONS } from '@/lib/mock-data'
import { generateTracks } from '@/lib/trails'
import { resolveToolLocations, toolsAboard } from '@/lib/tools-resolve'
import { Logo } from '@/components/brand/Logo'

// The REAL product nav, mirrored — visitors see everything the app does as
// features land (Brian, Aug 5: "clients need to see functionality as we
// add/edit features"). Every item routes to the pilot signup.
const DEMO_NAV: { label: string; icon: typeof MapIcon; section?: string; active?: boolean }[] = [
  { label: 'Command Center', icon: MonitorPlay },
  { label: 'Live Map', icon: MapIcon, active: true },
  { label: 'Alerts', icon: Bell },
  { label: 'Time clock', icon: Clock, section: 'FIELD' },
  { label: 'Daily logs', icon: ClipboardList },
  { label: 'Assets', icon: Package },
  { label: 'Zones', icon: Hexagon },
  { label: 'Measurements', icon: Ruler },
  { label: 'Tag scanner', icon: Bluetooth },
  { label: 'Maintenance', icon: Wrench },
  { label: 'Reports', icon: BarChart3, section: 'OFFICE' },
  { label: 'Accounting', icon: Calculator },
  { label: 'Receipts', icon: Receipt },
  { label: 'Financials', icon: Banknote },
  { label: 'Op model', icon: TrendingUp },
]

// "Live Map" → "live-map" — the /register page maps these slugs back to
// display names for its "<Label> is included in your free pilot" line.
const slugify = (label: string) => label.toLowerCase().replace(/\s+/g, '-')

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
      <div className="flex-1 flex min-h-0">
        {/* The product sidebar, for real — locked items funnel to the pilot. */}
        <aside className="hidden md:flex w-52 flex-none flex-col border-r border-navy-800 bg-navy-950/90 overflow-y-auto">
          <nav className="flex-1 py-2">
            {DEMO_NAV.map(({ label, icon: Icon, section, active }) => (
              <div key={label}>
                {section && (
                  <p className="px-4 pt-3 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{section}</p>
                )}
                {active ? (
                  <span className="flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg bg-amber/15 text-amber font-semibold text-[13px]">
                    <Icon className="h-4 w-4" /> {label}
                  </span>
                ) : (
                  <Link
                    href={`/register?from=${slugify(label)}`}
                    title={`${label} — included in the free pilot`}
                    className="group/item flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-muted hover:bg-navy-800 hover:text-ink text-[13px]"
                  >
                    <Icon className="h-4 w-4" /> {label}
                    <Lock className="h-3 w-3 ml-auto text-faint opacity-0 group-hover/item:opacity-100" />
                  </Link>
                )}
              </div>
            ))}
          </nav>
          <div className="p-3 border-t border-navy-800">
            <p className="text-[10.5px] text-faint leading-snug">
              This is the real product nav — every page opens in the free pilot.
            </p>
          </div>
        </aside>
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
      {/* Phones never see the desktop sidebar (md:flex) — give them the same
          locked-pages funnel as a compact chip strip under the map. */}
      <div className="md:hidden flex-none border-t border-navy-800 bg-navy-950/95 px-3 pt-2 pb-2.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint mb-1.5">More in the free pilot</p>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
          {DEMO_NAV.filter((i) => !i.active).map(({ label, icon: Icon }) => (
            <Link
              key={label}
              href={`/register?from=${slugify(label)}`}
              className="flex-none inline-flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-900 px-3 py-1.5 text-[12px] text-muted hover:text-ink whitespace-nowrap"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
              <Lock className="h-3 w-3 text-faint" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
