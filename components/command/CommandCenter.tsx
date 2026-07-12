'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { X, Sparkles, ChevronRight, Radar, Map, Package, Hexagon, Bell, Wrench, BarChart3, Calculator, Users, Settings, MonitorPlay } from 'lucide-react'
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

const NAV_LINKS = [
  { href: '/command', label: 'Command Center', icon: MonitorPlay },
  { href: '/map', label: 'Live Map', icon: Map },
  { href: '/assets', label: 'Assets', icon: Package },
  { href: '/geofences', label: 'Zones', icon: Hexagon },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/accounting', label: 'Accounting', icon: Calculator },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
]

/** Hidden left-edge nav: nothing but a slim arrow tab until tapped, then a
 *  slide-out with the whole app one tap away — the wall display stays clean
 *  but you're never trapped on it. */
function NavFlyout() {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-0 top-1/2 -translate-y-1/2 z-50 grid place-items-center w-5 h-16 rounded-r-lg bg-navy-950/80 backdrop-blur border border-l-0 border-teal/25 text-teal/70 hover:text-teal hover:w-6 transition-all"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    )
  }
  return (
    <>
      <div className="fixed inset-0 z-50 bg-navy-950/40" onClick={() => setOpen(false)} />
      <nav className="fixed left-0 inset-y-0 z-50 w-60 bg-navy-950/95 backdrop-blur border-r border-navy-700 shadow-panel flex flex-col py-4">
        <div className="px-4 pb-3 mb-2 border-b border-navy-800 flex items-center justify-between">
          <Logo size={22} href={null} />
          <button onClick={() => setOpen(false)} aria-label="Close navigation" className="grid place-items-center w-7 h-7 rounded-lg text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={'flex items-center gap-3 px-4 py-2.5 text-[13.5px] font-medium transition-colors ' + (href === '/command' ? 'text-amber' : 'text-muted hover:text-ink hover:bg-navy-900')}
          >
            <Icon className="h-4 w-4 flex-none" /> {label}
          </Link>
        ))}
      </nav>
    </>
  )
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
  // Every instrument on the wall collapses; the dial included.
  const [hudOpen, setHudOpen] = useState(true)
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

      {/* hidden left-edge nav — a slim arrow until tapped */}
      <NavFlyout />

      {/* left instrument rail — aligned to the layers pill above it */}
      <div className="absolute left-4 top-[114px] bottom-14 z-40 hidden xl:flex items-start">
        <CommandRail assets={assets} geofences={geofences} tracks={tracks} />
      </div>

      {/* right instrument rail — event log + fleet board, above the HUD dial */}
      {/* Bottom edge clears the radar dial at ANY viewport width — the dial is
          clamp(150px,26vw,320px) tall plus its pill and margins, so a fixed
          400px offset overlapped on wide screens ("still have some overlap",
          Jul 12). Overflow scrolls inside the rail instead of over the dial. */}
      <div className="absolute right-4 top-[68px] bottom-[calc(clamp(150px,26vw,320px)+136px)] z-40 hidden xl:flex justify-end overflow-hidden">
        <EventRail assets={assets} alerts={alerts} />
      </div>

      {/* tactical instrument — bottom-right, above the ticker; collapsible */}
      <div className="absolute bottom-14 right-4 md:bottom-16 md:right-6 z-40 flex flex-col items-end gap-1.5">
        {hudOpen && (
          <TacticalHud
            assets={assets}
            geofences={geofences}
            alertCount={alerts.filter((a) => !a.acknowledged_at).length}
            center={camCenter}
          />
        )}
        <button
          onClick={() => setHudOpen((v) => !v)}
          aria-label={hudOpen ? 'Hide radar' : 'Show radar'}
          className="flex items-center gap-1.5 rounded-full bg-navy-950/80 backdrop-blur border border-teal/20 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint hover:text-teal transition-colors"
        >
          <Radar className="h-3 w-3" /> {hudOpen ? 'hide' : 'radar'}
        </button>
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
