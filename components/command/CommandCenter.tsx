'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { X } from 'lucide-react'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import { Logo } from '@/components/brand/Logo'

const MapView = dynamic(() => import('@/components/map/MapView').then((m) => ({ default: m.MapView })), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-navy-950 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

export interface CommandKpis {
  assetsOnline: number
  assetsTotal: number
  equipmentRunning: number
  crewOnSite: number
  activeAlerts: number
  costToday: string
  sites: number
}

interface CommandCenterProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  tracks: AssetTrack[]
  kpis: CommandKpis
  company: string
}

function Chip({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'amber' | 'teal' | 'alert' }) {
  const color = tone === 'amber' ? 'text-amber' : tone === 'teal' ? 'text-teal' : tone === 'alert' ? 'text-alert' : 'text-ink'
  return (
    <div className="px-3 border-l border-navy-800 first:border-l-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint leading-none">{label}</div>
      <div className={`font-display font-black text-[19px] leading-tight ${color}`}>{value}</div>
    </div>
  )
}

export function CommandCenter({ assets, geofences, tracks, kpis, company }: CommandCenterProps) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) ?? '—'
  const date = now?.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() ?? ''

  return (
    <div className="fixed inset-0 bg-navy-950 text-ink overflow-hidden">
      {/* live map */}
      <div className="absolute inset-0">
        <MapView assets={assets} geofences={geofences} tracks={tracks} kiosk />
      </div>

      {/* HUD overlays */}
      <div className="absolute inset-0 pointer-events-none brand-glow" />
      <div
        className="absolute inset-0 pointer-events-none z-30"
        style={{ background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.10) 3px)', mixBlendMode: 'multiply', opacity: 0.4 }}
      />
      {/* corner brackets */}
      <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-teal/50 z-30 pointer-events-none" />

      {/* top HUD bar */}
      <div className="absolute top-0 left-0 right-0 z-40 h-[56px] flex items-center justify-between px-5 bg-navy-950/85 backdrop-blur border-b border-navy-800">
        <div className="flex items-center gap-3 pointer-events-none">
          <Logo size={26} href={null} />
          <span className="hidden md:block w-px h-6 bg-navy-700" />
          <span className="hidden md:block font-mono text-[11px] text-faint tracking-wide">{company.toUpperCase()}</span>
        </div>

        <div className="hidden sm:flex items-center">
          <Chip label="Assets" value={`${kpis.assetsOnline}/${kpis.assetsTotal}`} />
          <Chip label="Equip running" value={`${kpis.equipmentRunning}`} tone="amber" />
          <Chip label="Crew on site" value={`${kpis.crewOnSite}`} tone="teal" />
          <Chip label="Sites" value={`${kpis.sites}`} />
          <Chip label="Alerts" value={`${kpis.activeAlerts}`} tone={kpis.activeAlerts > 0 ? 'alert' : 'ink'} />
          <Chip label="Cost today" value={kpis.costToday} tone="amber" />
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right pointer-events-none">
            <div className="font-display font-black text-[18px] leading-none tabular-nums">{time}</div>
            <div className="font-mono text-[10px] text-faint">{date}</div>
          </div>
          <span className="flex items-center gap-2 font-mono text-[11px] text-teal pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink" /> LIVE
          </span>
          <Link href="/map" className="grid place-items-center w-8 h-8 rounded-lg bg-navy-900 border border-navy-700 text-faint hover:text-ink transition-colors" title="Exit command center">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
