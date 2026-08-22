'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { X, Sparkles, ChevronRight, ChevronLeft, Radar, LayoutGrid, Check, Route } from 'lucide-react'
import type { AssetWithLocation, Geofence, AlertEvent } from '@/lib/types'
import { tracksFromHistory, type AssetTrack } from '@/lib/trails'
import { formatRelativeTime } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { signOutAction } from '@/lib/actions/auth'
import { TacticalHud } from './TacticalHud'
import { CommandRail } from './CommandRail'
import { TopBarWeather } from '@/components/map/TopBarWeather'
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

/** Every window on the wall display: open, minimized to its title, or gone.
 *  Arranged once, remembered per device — the TV comes back how you left it. */
export type PanelState = 'open' | 'min' | 'hidden'
export type PanelKey = 'activity' | 'sites' | 'status' | 'weather' | 'events' | 'fleet' | 'hud' | 'chips' | 'ticker' | 'zoom'

const LEFT_KEYS: PanelKey[] = ['activity', 'sites', 'status']
const RIGHT_KEYS: PanelKey[] = ['events', 'fleet']
const DEFAULT_PANELS: Record<PanelKey, PanelState> = {
  activity: 'open', sites: 'open', status: 'open', weather: 'open',
  events: 'open', fleet: 'open', hud: 'open', chips: 'open', ticker: 'open', zoom: 'open',
}
const PANELS_LS = 'ht_cc_panels_v2'
const TOUR_LS = 'ht_cc_tour'

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
  /** Gateway asset id → tools riding with it (badge + on-board list). */
  aboard?: Record<string, import('@/lib/tools-resolve').AboardTool[]>
  /** Tool-pairing episodes over the history window (replay-accurate badges). */
  pairingEpisodes?: import('@/lib/db/tools').PairingEpisode[]
  /** Company branding for the Create-PDF button. */
  brand?: { companyName: string; logoUrl: string | null; logoBg?: string | null } | null
  /** Real mode: shell+basemap paint instantly, the heavy cargo (trails,
   *  timeline history, pairing, cost-today) streams from /api/command-data
   *  behind a status chip ("keep the app snappy", Brian, Aug 22). */
  deferLoad?: boolean
  /** Signed-in user's name + saved nav order — the phone bottom bar rides
   *  /command too (Brian, Aug 22: nav lives at the bottom, same as /map). */
  userName?: string | null
  navOrder?: string[] | null
  role?: string | null
}

interface CommandData {
  historyRows: import('@/lib/db/assets').LocationHistoryRow[] | null
  earliestMs: number | null
  pairingEpisodes: import('@/lib/db/tools').PairingEpisode[]
  /** Null = the caller's role may not see dollars (server-gated). */
  costToday: string | null
}

const TRIGGER_LABEL: Record<string, string> = {
  after_hours_movement: 'AFTER-HOURS MOVEMENT',
  left_site: 'LEFT SITE',
  exit: 'exited zone',
  enter: 'entered zone',
  idle: 'idle too long',
}

/** The app sidebar, kiosk edition — the SAME left-side look as the map view
 *  (same nav, same circular collapse chevron in the same spot), except that
 *  collapsing here removes it entirely: a wall display wants nothing on it
 *  but the expand arrow (owner ask, Jul 21). Starts collapsed, remembered
 *  per device. */
function KioskNav({ company, alerts }: { company: string; alerts: AlertEvent[] }) {
  const [collapsed, setCollapsed] = useState(true)
  useEffect(() => { setCollapsed(localStorage.getItem('ht-cc-nav') !== '0') }, [])
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem('ht-cc-nav', next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  return (
    <Sidebar
      companyName={company}
      alertCount={alerts.filter((a) => !a.acknowledged_at).length}
      latestAlertAt={alerts[0]?.triggered_at ?? null}
      collapsed={collapsed}
      onToggle={toggle}
      onSignOut={signOutAction}
      fullCollapse
    />
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

/** "Screen" menu — build the wall you want, then clear the rest. Every row is
 *  a window on the display; Clear screen leaves nothing but the map. */
function ScreenMenu({ panels, onPanel, tourOn, onTour, onClear, onShowAll }: {
  panels: Record<PanelKey, PanelState>
  onPanel: (k: PanelKey, s: PanelState) => void
  tourOn: boolean
  onTour: (v: boolean) => void
  onClear: () => void
  onShowAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [open])

  const ROWS: { k: PanelKey; label: string }[] = [
    { k: 'activity', label: 'Fleet activity' },
    { k: 'sites', label: 'Site presence' },
    { k: 'status', label: 'Fleet status' },
    { k: 'weather', label: 'On-site weather' },
    { k: 'events', label: 'Event log' },
    { k: 'fleet', label: 'Fleet board' },
    { k: 'hud', label: 'Radar dial' },
    { k: 'chips', label: 'Stats bar' },
    { k: 'ticker', label: 'Bottom ticker' },
    { k: 'zoom', label: 'Map zoom buttons' },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Screen setup — choose which windows show"
        className={'grid place-items-center w-8 h-8 rounded-lg border transition-colors ' + (open ? 'bg-navy-800 text-ink border-navy-600' : 'bg-navy-900 border-navy-700 text-faint hover:text-ink')}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      {open && (
        // Phone: full-width sheet under the header (the 240px flyout collided
        // with the weather pill). Desktop: classic anchored dropdown.
        <div className="fixed inset-x-3 top-[62px] max-h-[72vh] overflow-y-auto rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2 z-50 md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[240px] md:max-h-none md:overflow-visible">
          <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink">Screen setup</p>
          {ROWS.map(({ k, label }) => {
            const on = panels[k] !== 'hidden'
            return (
              <button
                key={k}
                onClick={() => onPanel(k, on ? 'hidden' : 'open')}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
              >
                <span className={'grid place-items-center w-4 h-4 rounded border flex-none ' + (on ? 'bg-teal/20 border-teal/50 text-teal' : 'border-navy-600 text-transparent')}>
                  <Check className="h-3 w-3" />
                </span>
                {label}
              </button>
            )
          })}
          <div className="my-1.5 border-t border-navy-800" />
          <button
            onClick={() => onTour(!tourOn)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
          >
            <span className={'grid place-items-center w-4 h-4 rounded border flex-none ' + (tourOn ? 'bg-amber/20 border-amber/50 text-amber' : 'border-navy-600 text-transparent')}>
              <Check className="h-3 w-3" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /> Auto-tour assets</span>
              <span className="block text-[10px] text-faint leading-tight mt-0.5">Camera glides asset to asset. Drag the map to stop it; off = stays where you leave it.</span>
            </span>
          </button>
          <div className="my-1.5 border-t border-navy-800" />
          <div className="flex gap-1.5 px-1 pb-0.5">
            <button onClick={onClear} className="flex-1 rounded-lg bg-navy-900 border border-navy-700 text-[11.5px] font-semibold text-muted hover:text-ink py-1.5 transition-colors">
              Clear screen
            </button>
            <button onClick={onShowAll} className="flex-1 rounded-lg bg-teal/15 border border-teal/40 text-[11.5px] font-semibold text-teal py-1.5 hover:bg-teal/25 transition-colors">
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function CommandCenter({ assets, geofences, tracks, historyRows = null, earliestMs = null, tz, kpis, company, alerts = [], aboard, pairingEpisodes, brand = null, deferLoad = false, userName = null, navOrder = null, role = null }: CommandCenterProps) {
  const [now, setNow] = useState<Date | null>(null)

  // Deferred heavy cargo — fetched once after the shell/basemap are up.
  // Trail/timeline rows come from /api/history, the SAME feed and window
  // /map's baseline uses (2 days; longer ranges fetch on demand inside
  // MapView) — one source of truth for both maps. /api/command-data adds
  // only earliest/pairing/cost. One quiet retry, then an honest error chip.
  const [dyn, setDyn] = useState<CommandData | null>(null)
  const [dynErr, setDynErr] = useState(false)
  useEffect(() => {
    if (!deferLoad) return
    let alive = true
    let timer: number | undefined
    const attempt = () => {
      Promise.all([
        fetch(`/api/history?from=${new Date(Date.now() - 2 * 86_400_000).toISOString()}&to=${new Date().toISOString()}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
        fetch('/api/command-data').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      ])
        .then(([h, c]) => {
          if (!alive) return
          setDyn({ ...(c as Omit<CommandData, 'historyRows'>), historyRows: Array.isArray(h?.rows) ? h.rows : null })
          setDynErr(false)
        })
        .catch(() => {
          // Keep trying — a wall display that boots before the shop Wi-Fi
          // associates must recover on its own, not wait for a hand refresh
          // (ship-check). The chip says so meanwhile.
          if (!alive) return
          setDynErr(true)
          timer = window.setTimeout(attempt, 20_000)
        })
    }
    attempt()
    return () => { alive = false; if (timer) window.clearTimeout(timer) }
  }, [deferLoad])
  const liveRows = dyn?.historyRows ?? historyRows
  const liveEarliest = dyn?.earliestMs ?? earliestMs
  const livePairing = dyn?.pairingEpisodes ?? pairingEpisodes
  const liveKpis = dyn ? { ...kpis, costToday: dyn.costToday ?? '—' } : kpis
  // Rail waveform + map trails in real mode derive from the fetched rows —
  // the server `tracks` prop is [] on live accounts (ship-check: passing it
  // straight through flatlined the fleet-activity rail). Last 24h to match
  // the rail's old window.
  const liveTracks = useMemo(() => {
    if (!dyn?.historyRows?.length) return tracks
    const since = Date.now() - 24 * 3_600_000
    return tracksFromHistory(assets, dyn.historyRows.filter((r) => Date.parse(r.timestamp) >= since))
  }, [dyn, assets, tracks])
  // Radar center follows the map camera (MapView broadcasts on moveend).
  const [camCenter, setCamCenter] = useState<{ lng: number; lat: number } | null>(null)

  // ── the wall's arrangement: every window's state + the auto-tour, persisted ──
  const [panels, setPanels] = useState<Record<PanelKey, PanelState>>(DEFAULT_PANELS)
  const [tourOn, setTourOn] = useState(true)
  const loaded = useRef(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PANELS_LS)
      if (raw) setPanels({ ...DEFAULT_PANELS, ...(JSON.parse(raw) as Partial<Record<PanelKey, PanelState>>) })
      const t = localStorage.getItem(TOUR_LS)
      if (t != null) setTourOn(t === '1')
    } catch { /* fresh device */ }
    loaded.current = true
  }, [])
  useEffect(() => {
    if (loaded.current) try { localStorage.setItem(PANELS_LS, JSON.stringify(panels)) } catch { /* full */ }
  }, [panels])
  useEffect(() => {
    if (loaded.current) try { localStorage.setItem(TOUR_LS, tourOn ? '1' : '0') } catch { /* full */ }
  }, [tourOn])

  const onPanel = (k: PanelKey, s: PanelState) => setPanels((p) => ({ ...p, [k]: s }))
  const setMany = (keys: PanelKey[], s: PanelState) =>
    setPanels((p) => keys.reduce((acc, k) => ({ ...acc, [k]: s }), { ...p }))
  const clearScreen = () => setMany(Object.keys(DEFAULT_PANELS) as PanelKey[], 'hidden')
  const showAll = () => setMany(Object.keys(DEFAULT_PANELS) as PanelKey[], 'open')

  const leftVisible = LEFT_KEYS.some((k) => panels[k] !== 'hidden')
  const rightVisible = RIGHT_KEYS.some((k) => panels[k] !== 'hidden')

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
  const timeShort = now?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ?? '—'
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
  const showTicker = panels.ticker !== 'hidden' && ticker.length > 0

  return (
    <div className="fixed inset-0 bg-navy-950 text-ink overflow-hidden">
      {/* live map — zoom buttons hide via CSS when that window is off */}
      <div className={'absolute inset-0' + (panels.zoom === 'hidden' ? ' ht-hide-zoom' : '')}>
        <MapView
          assets={assets}
          geofences={geofences}
          tracks={liveTracks}
          historyRows={liveRows}
          earliestMs={liveEarliest}
          tz={tz}
          aboard={aboard}
          pairingEpisodes={livePairing}
          kiosk
          alerts={alerts}
          tourOn={tourOn}
          onTourInterrupt={() => setTourOn(false)}
          brand={brand}
        />
      </div>

      {/* HUD overlays */}
      <div className="absolute inset-0 pointer-events-none brand-glow" />
      <div
        className="absolute inset-0 pointer-events-none z-30"
        style={{ background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.10) 3px)', mixBlendMode: 'multiply', opacity: 0.4 }}
      />
      {/* Deferred-cargo status — same language as the map's layer chips.
          Disappears the moment /api/command-data lands. */}
      {deferLoad && !dyn && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full bg-navy-950/85 backdrop-blur border border-teal/25 px-3.5 py-1.5 pointer-events-none">
          <span className={`h-2 w-2 rounded-full ${dynErr ? 'bg-alert' : 'bg-teal animate-blink'}`} />
          <span className={`font-mono text-[10.5px] uppercase tracking-[0.12em] ${dynErr ? 'text-alert' : 'text-teal'}`}>
            {dynErr ? 'History unavailable — retrying…' : 'Loading trails & history…'}
          </span>
        </div>
      )}

      {/* corner brackets */}
      <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-teal/50 z-30 pointer-events-none" />
      <div className="absolute bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-teal/50 z-30 pointer-events-none" />

      {/* Desktop/TV: the slide-over sidebar. Phones navigate with the same
          bottom bar as /map instead (Brian, Aug 22) — the overlay sidebar
          ate the whole screen there. */}
      <div className="hidden md:block">
        <KioskNav company={company} alerts={alerts} />
      </div>
      <BottomNav
        alertCount={alerts.filter((a) => !a.acknowledged_at).length}
        latestAlertAt={alerts[0]?.triggered_at ?? null}
        companyName={company}
        userName={userName}
        navOrder={navOrder}
        role={role}
        onSignOut={signOutAction}
      />

      {/* left instrument rail — below the layers pill; slim edge tab when hidden */}
      {leftVisible ? (
        // pointer-events-none on the WRAPPER: it spans to the bottom of the
        // screen and its empty lower half was swallowing clicks meant for the
        // map's zoom/locate buttons underneath ("none of those are working",
        // Jul 21). Only the rail itself accepts input.
        <div className="absolute left-4 top-[114px] bottom-14 z-40 hidden xl:flex items-start pointer-events-none">
          <div className="pointer-events-auto max-h-full">
            <CommandRail assets={assets} geofences={geofences} tracks={liveTracks} panels={panels} onPanel={onPanel} />
          </div>
        </div>
      ) : (
        <button
          onClick={() => setMany(LEFT_KEYS, 'open')}
          aria-label="Show instrument rail"
          className="absolute left-0 top-[120px] z-[46] hidden xl:grid place-items-center w-6 h-14 rounded-r-lg bg-navy-950/75 backdrop-blur border border-l-0 border-teal/20 text-teal/70 hover:text-teal transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* right instrument rail — event log + fleet board, above the HUD dial.
          Bottom edge clears the radar dial at ANY viewport width (dial is
          clamp(150px,26vw,320px) tall + pill + margins). Overflow scrolls
          inside the rail instead of over the dial. */}
      {rightVisible ? (
        // Same pointer-events split as the left rail — empty wrapper area
        // must never block the map.
        <div className="absolute right-[58px] top-[68px] bottom-[calc(clamp(150px,26vw,320px)+136px)] z-40 hidden xl:flex justify-end overflow-hidden pointer-events-none">
          <div className="pointer-events-auto max-h-full">
            <EventRail assets={assets} alerts={alerts} geofences={geofences} historyRows={liveRows} panels={panels} onPanel={onPanel} />
          </div>
        </div>
      ) : (
        <button
          onClick={() => setMany(RIGHT_KEYS, 'open')}
          aria-label="Show event rail"
          className="absolute right-0 top-[120px] z-[46] hidden xl:grid place-items-center w-6 h-14 rounded-l-lg bg-navy-950/75 backdrop-blur border border-r-0 border-teal/20 text-teal/70 hover:text-teal transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {/* tactical instrument — bottom-right, above the ticker; open ⇄ pill ⇄ gone */}
      {panels.hud !== 'hidden' && (
        <div className="absolute bottom-[calc(112px+env(safe-area-inset-bottom))] right-4 md:bottom-16 md:right-6 z-40 flex flex-col items-end gap-1.5">
          {panels.hud === 'open' && (
            <TacticalHud
              assets={assets}
              geofences={geofences}
              alertCount={alerts.filter((a) => !a.acknowledged_at).length}
              center={camCenter}
            />
          )}
          {/* same bare mono chip as the rails' hide buttons (owner ask, Jul 21) */}
          <button
            onClick={() => onPanel('hud', panels.hud === 'open' ? 'min' : 'open')}
            aria-label={panels.hud === 'open' ? 'Hide radar' : 'Show radar'}
            className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint hover:text-teal transition-colors px-1"
          >
            <Radar className="h-3 w-3" /> {panels.hud === 'open' ? 'hide' : 'radar'}
          </button>
        </div>
      )}

      {/* top HUD bar */}
      {/* z-[46]: above the kiosk layers pill (z 45) so the Screens sheet wins */}
      <div className="absolute top-0 left-0 right-0 z-[46] h-[56px] flex items-center justify-between px-3 md:px-5 bg-navy-950/85 backdrop-blur border-b border-navy-800">
        <div className="flex items-center gap-3 pointer-events-none min-w-0">
          {/* phone: mark only — the wordmark fought the Ask button for space */}
          <span className="md:hidden"><Logo size={26} href={null} wordmark={false} /></span>
          <span className="hidden md:block"><Logo size={26} href={null} /></span>
          <span className="hidden md:block w-px h-6 bg-navy-700" />
          <span className="hidden md:block font-mono text-[11px] text-faint tracking-wide">{company.toUpperCase()}</span>
        </div>

        {panels.chips !== 'hidden' && (
          <div className="hidden sm:flex items-center">
            <Chip label="Assets" value={`${kpis.assetsOnline}/${kpis.assetsTotal}`} />
            <Chip label="Moving" value={`${kpis.equipmentRunning}`} tone="amber" />
            <Chip label="Crew on site" value={`${kpis.crewOnSite}`} tone="teal" />
            <Chip label="Sites" value={`${kpis.sites}`} />
            <Chip label="Alerts" value={`${kpis.activeAlerts}`} tone={kpis.activeAlerts > 0 ? 'alert' : 'ink'} />
            <Chip label="Cost today" value={liveKpis.costToday} tone="amber" />
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-4 flex-none">
          {/* On-site weather moved up here from the left rail (owner ask,
              Aug 6) — same chip + dropdown as the main map's top bar. */}
          <span className="hidden xl:block"><TopBarWeather /></span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber text-[#1a1100] font-display font-bold text-[13px] px-2.5 md:px-3 py-1.5 hover:brightness-110 transition"
          >
            <Sparkles className="h-4 w-4" /> Ask
          </button>
          <ScreenMenu
            panels={panels}
            onPanel={onPanel}
            tourOn={tourOn}
            onTour={setTourOn}
            onClear={clearScreen}
            onShowAll={showAll}
          />
          <div className="text-right pointer-events-none">
            {/* phone: no seconds — the full clock ran off the screen edge */}
            <div className="md:hidden font-display font-black text-[15px] leading-none tabular-nums">{timeShort}</div>
            <div className="hidden md:block font-display font-black text-[18px] leading-none tabular-nums">{time}</div>
            <div className="font-mono text-[10px] text-faint whitespace-nowrap">{date}</div>
          </div>
          <span className="flex items-center gap-2 font-mono text-[11px] text-teal pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink" />
            <span className="hidden md:inline">LIVE</span>
          </span>
          <Link href="/map" className="grid place-items-center w-8 h-8 rounded-lg bg-navy-900 border border-navy-700 text-faint hover:text-ink transition-colors" title="Exit command center">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* live event ticker — the wall display's heartbeat (Screen menu turns it off) */}
      {showTicker && (
        <div className="absolute bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-40 h-9 bg-navy-950/85 backdrop-blur border-t border-navy-800 overflow-hidden pointer-events-none">
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
