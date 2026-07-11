'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { X, Sparkles } from 'lucide-react'
import type { AssetWithLocation, Geofence, AlertEvent } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import { formatRelativeTime } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'
import { TacticalHud } from './TacticalHud'
import { CommandRail } from './CommandRail'
import { EventRail } from './EventRail'
import { AssistantWidget } from '@/components/assistant/AssistantWidget'

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
  /** Same capped/thinned history feed as /map — kiosk timeline parity. */
  historyRows?: import('@/lib/db/assets').LocationHistoryRow[] | null
  earliestMs?: number | null
  tz?: string
  kpis: CommandKpis
  company: string
  alerts?: AlertEvent[]
}

const TRIGGER_LABEL: Record<string, string> = {
  after_hours_movement: 'AFTER-HOURS MOVEMENT',
  left_site: 'LEFT SITE',
  exit: 'exited zone',
  enter: 'entered zone',
  idle: 'idle too long',
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

export function CommandCenter({ assets, geofences, tracks, historyRows = null, earliestMs = null, tz, kpis, company, alerts = [] }: CommandCenterProps) {
  const [now, setNow] = useState<Date | null>(null)
  // Radar center follows the map camera (MapView broadcasts on moveend).
  const [camCenter, setCamCenter] = useState<{ lng: number; lat: number } | null>(null)
  useEffect(() => {
    const onCam = (e: Event) => setCamCenter((e as CustomEvent<{ lng: number; lat: number }>).detail)
    window.addEventListener('ht:camera', onCam)
    return () => window.removeEventListener('ht:camera', onCam)
  }, [])
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) ?? '—'
  const date = now?.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() ?? ''

  // Live event ticker: real alerts first (loud), then fleet status lines.
  const ticker: { text: string; alert?: boolean }[] = [
    ...alerts.slice(0, 6).map((a) => ({
      alert: a.rule?.trigger === 'after_hours_movement' || a.rule?.trigger === 'left_site',
      text: `${a.asset?.name ?? 'Asset'} · ${TRIGGER_LABEL[a.rule?.trigger ?? ''] ?? 'alert'}${a.rule?.geofence ? ` · ${a.rule.geofence.name}` : ''} · ${formatRelativeTime(a.triggered_at)}`,
    })),
    ...assets
      .filter((a) => a.location)
      .slice(0, 10)
      .map((a) => ({
        text: `${a.name} · ${a.location!.speed && a.location!.speed > 2 ? `moving · ${Math.round(a.location!.speed!)} mph` : 'on site'} · ${formatRelativeTime(a.location!.timestamp)}`,
      })),
  ]

  return (
    <div className="fixed inset-0 bg-navy-950 text-ink overflow-hidden">
      {/* live map */}
      <div className="absolute inset-0">
        <MapView assets={assets} geofences={geofences} tracks={tracks} historyRows={historyRows} earliestMs={earliestMs} tz={tz} kiosk />
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

      {/* left instrument rail — the mission-control frame (wide screens) */}
      <div className="absolute left-4 top-[118px] bottom-14 z-40 hidden xl:flex items-start">
        <CommandRail assets={assets} geofences={geofences} tracks={tracks} />
      </div>

      {/* right instrument rail — event log + fleet board, above the HUD dial */}
      <div className="absolute right-4 top-[68px] bottom-[400px] z-40 hidden xl:flex justify-end min-h-[180px]">
        <EventRail assets={assets} alerts={alerts} />
      </div>

      {/* tactical instrument — bottom-right, above the ticker */}
      <div className="absolute bottom-14 right-4 md:bottom-16 md:right-6 z-40">
        <TacticalHud
          assets={assets}
          geofences={geofences}
          alertCount={alerts.filter((a) => !a.acknowledged_at).length}
          center={camCenter}
        />
      </div>

      {/* top HUD bar */}
      <div className="absolute top-0 left-0 right-0 z-40 h-[56px] flex items-center justify-between px-5 bg-navy-950/85 backdrop-blur border-b border-navy-800">
        <div className="flex items-center gap-3 pointer-events-none">
          <Logo size={26} href={null} />
          <span className="hidden md:block w-px h-6 bg-navy-700" />
          <span className="hidden md:block font-mono text-[11px] text-faint tracking-wide">{company.toUpperCase()}</span>
        </div>

        <div className="hidden sm:flex items-center">
          <Chip label="Assets" value={`${kpis.assetsOnline}/${kpis.assetsTotal}`} />
          <Chip label="Moving" value={`${kpis.equipmentRunning}`} tone="amber" />
          <Chip label="Crew on site" value={`${kpis.crewOnSite}`} tone="teal" />
          <Chip label="Sites" value={`${kpis.sites}`} />
          <Chip label="Alerts" value={`${kpis.activeAlerts}`} tone={kpis.activeAlerts > 0 ? 'alert' : 'ink'} />
          <Chip label="Cost today" value={kpis.costToday} tone="amber" />
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3 py-1.5 hover:brightness-110 transition"
          >
            <Sparkles className="h-4 w-4" /> Ask
          </button>
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

      {/* live event ticker — the wall display's heartbeat */}
      {ticker.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-40 h-9 bg-navy-950/85 backdrop-blur border-t border-navy-800 overflow-hidden pointer-events-none">
          <div className="ticker-track flex items-center h-full gap-10 whitespace-nowrap font-mono text-[12px]">
            {[...ticker, ...ticker].map((item, i) => (
              // suppressHydrationWarning: items carry relative times ("53m ago")
              // that drift between server render and client hydration.
              <span key={i} suppressHydrationWarning className={'flex items-center gap-2 ' + (item.alert ? 'text-alert font-bold' : 'text-faint')}>
                <span className={'w-1.5 h-1.5 rounded-full flex-none ' + (item.alert ? 'bg-alert animate-blink' : 'bg-teal/60')} />
                {item.text}
              </span>
            ))}
          </div>
        </div>
      )}

      <AssistantWidget />
    </div>
  )
}
