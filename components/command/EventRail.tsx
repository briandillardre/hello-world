'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type { AssetWithLocation, AssetType, AlertEvent, Geofence } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { pointInPolygon } from '@/lib/alerts-engine'
import { POI_KIND_META, type PoiKind } from '@/lib/poi'
import type { PanelKey, PanelState } from './CommandCenter'

/**
 * Right instrument rail for the Command Center — the ops half of the frame:
 *   · event log: real alerts, loudest first (theft triggers blink red)
 *   · fleet board: per-asset strips — WHERE each unit is (zone) and for HOW
 *     LONG, the two facts a glance actually needs (battery lives elsewhere)
 * The two cards SHARE the rail: maximizing one can never bury the other —
 * each scrolls inside its half. Minimize to title rows or hide entirely;
 * state persists per device. Wide screens only.
 */

const BLIP: Record<AssetType, string> = {
  vehicle: '#ff9e16', equipment: '#60a5fa', personnel: '#34d399', tool: '#a78bfa',
}

const TRIGGER_LABEL: Record<string, string> = {
  after_hours_movement: 'AFTER-HOURS MOVEMENT',
  left_site: 'LEFT SITE',
  exit: 'exited zone',
  enter: 'entered zone',
  idle: 'idle too long',
}

const STALE_MS = 2 * 3_600_000

/** "185 Hawkins Rd. - Dillard House" → "185 Hawkins Rd." (fits a strip). */
function shortZone(name: string): string {
  const head = name.split(/[-–—,(]/)[0].trim() || name
  return head.length > 16 ? head.slice(0, 15).trimEnd() + '…' : head
}

function fmtSince(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}M`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}H ${mins % 60}M`
  return `${Math.floor(h / 24)}D ${h % 24}H`
}

function CardHeader({ k, title, state, onPanel }: {
  k: PanelKey
  title: string
  state: PanelState
  onPanel: (k: PanelKey, s: PanelState) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-none">
      <p className={'font-mono text-[9px] uppercase tracking-[0.16em] text-teal/80 ' + (state === 'open' ? 'mb-1.5' : '')}>{title}</p>
      <button
        onClick={() => onPanel(k, state === 'min' ? 'open' : 'min')}
        aria-label={state === 'min' ? `Expand ${title}` : `Minimize ${title}`}
        className={'grid place-items-center w-5 h-5 -mr-1 rounded text-faint hover:text-teal transition-colors flex-none ' + (state === 'open' ? '-mt-1' : '')}
      >
        {state === 'min' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
    </div>
  )
}

export function EventRail({ assets, alerts, geofences = [], historyRows = null, panels, onPanel }: {
  assets: AssetWithLocation[]
  alerts: AlertEvent[]
  geofences?: Geofence[]
  /** Thinned location history (same feed as the timeline) — used to walk back
   *  and find when each asset ENTERED its current zone. Null in demo mode. */
  historyRows?: { asset_id: string; lat: number; lng: number; timestamp: string }[] | null
  panels: Record<PanelKey, PanelState>
  onPanel: (k: PanelKey, s: PanelState) => void
}) {
  const events = alerts.slice(0, 8)

  // Movement story for the log — where each vehicle actually WENT today
  // ("Atlas · St Paul United Methodist · 50 min"), from the same classified
  // stops feed as the asset panel. Live accounts only; refreshes every 5 min.
  interface MoveEvent { asset: string; place: string; kind: PoiKind; fromMs: number; minutes: number }
  const [moves, setMoves] = useState<MoveEvent[]>([])
  useEffect(() => {
    if (panels.events !== 'open') return
    const targets = assets.filter((a) => (a.type === 'vehicle' || a.type === 'equipment') && a.location).slice(0, 6)
    if (!targets.length) return
    let cancelled = false
    const load = async () => {
      const all: MoveEvent[] = []
      for (const a of targets) {
        try {
          const r = await fetch(`/api/stops?asset=${a.id}&range=today`)
          if (!r.ok) continue
          const j = await r.json() as { stops?: { name: string; kind: PoiKind; fromMs: number; minutes: number }[] }
          for (const s of j.stops ?? []) {
            all.push({ asset: a.name, place: s.name, kind: s.kind, fromMs: s.fromMs, minutes: s.minutes })
          }
        } catch { /* one asset failing shouldn't blank the log */ }
      }
      if (!cancelled) setMoves(all.sort((x, y) => y.fromMs - x.fromMs).slice(0, 8))
    }
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels.events, assets.length])

  const strips = useMemo(() => {
    const now = Date.now()
    const zones = geofences
      .filter((g) => g.kind !== 'boundary')
      .map((g) => ({ name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
      .filter((z) => z.ring.length >= 3)

    // History per asset, newest first, for the walk-back to zone entry.
    const byAsset = new Map<string, { lat: number; lng: number; ms: number }[]>()
    if (historyRows) {
      for (const r of historyRows) {
        let list = byAsset.get(r.asset_id)
        if (!list) byAsset.set(r.asset_id, (list = []))
        list.push({ lat: r.lat, lng: r.lng, ms: new Date(r.timestamp).getTime() })
      }
      for (const list of Array.from(byAsset.values())) list.sort((a, b) => b.ms - a.ms)
    }

    return assets
      .map((a) => {
        const loc = a.location
        const ageMs = loc ? now - new Date(loc.timestamp).getTime() : Infinity
        const state: 'moving' | 'idle' | 'dark' =
          !loc || ageMs > STALE_MS ? 'dark' : (loc.speed ?? 0) > 2 ? 'moving' : 'idle'

        // Which zone is it in, and since when? Walk history backwards while
        // the pings stay inside — the first outside ping marks the arrival.
        let zone: string | null = null
        let sinceMs: number | null = null
        if (loc && state !== 'dark') {
          const z = zones.find((zz) => pointInPolygon([loc.lng, loc.lat], zz.ring))
          if (z) {
            zone = shortZone(z.name)
            const hist = byAsset.get(a.id)
            if (hist?.length) {
              let entry: number | null = null
              for (const p of hist) {
                if (pointInPolygon([p.lng, p.lat], z.ring)) entry = p.ms
                else break
              }
              if (entry != null) sinceMs = now - entry
            }
          }
        }
        return { a, state, speed: loc?.speed ?? 0, zone, sinceMs }
      })
      .sort((x, y) => {
        const rank = { moving: 0, idle: 1, dark: 2 }
        return rank[x.state] - rank[y.state] || x.a.name.localeCompare(y.a.name)
      })
  }, [assets, geofences, historyRows])

  return (
    <div className="w-56 h-full max-h-full flex flex-col gap-2.5 overflow-hidden">
      {panels.events !== 'hidden' && (
        <div className={'rounded-lg bg-navy-950/75 backdrop-blur border border-teal/15 px-3 py-2.5 flex flex-col ' + (panels.events === 'open' ? 'flex-1 min-h-0' : 'flex-none')}>
          <CardHeader k="events" title="Event log" state={panels.events} onPanel={onPanel} />
          {panels.events === 'open' && (events.length === 0 && moves.length === 0 ? (
            <p className="font-mono text-[10px] text-faint">no events · all quiet</p>
          ) : (
            <div className="space-y-1.5 overflow-y-auto no-scrollbar min-h-0">
              {[
                ...events.map((e) => ({ t: new Date(e.triggered_at).getTime(), e, mv: null as MoveEvent | null })),
                ...moves.map((mv) => ({ t: mv.fromMs, e: null as AlertEvent | null, mv })),
              ]
                .sort((a, b) => b.t - a.t)
                .slice(0, 14)
                .map((row, i) => {
                  if (row.e) {
                    const e = row.e
                    const loud = e.rule?.trigger === 'after_hours_movement' || e.rule?.trigger === 'left_site'
                    const acked = !!e.acknowledged_at
                    return (
                      <div key={e.id} className={'flex items-start gap-1.5 ' + (acked ? 'opacity-45' : '')}>
                        <span className={'mt-1 w-1.5 h-1.5 rounded-full flex-none ' + (loud && !acked ? 'bg-alert animate-blink' : 'bg-teal/60')} />
                        <div className="min-w-0">
                          <p className={'text-[10.5px] leading-tight truncate ' + (loud && !acked ? 'text-alert font-bold' : 'text-muted')}>
                            {e.asset?.name ?? 'Asset'} · {TRIGGER_LABEL[e.rule?.trigger ?? ''] ?? 'alert'}
                          </p>
                          <p className="font-mono text-[9px] text-faint leading-tight" suppressHydrationWarning>
                            {e.rule?.geofence ? `${e.rule.geofence.name} · ` : ''}{formatRelativeTime(e.triggered_at)}
                          </p>
                        </div>
                      </div>
                    )
                  }
                  const mv = row.mv!
                  return (
                    // Movement story: where it went and for how long — same
                    // classified stops the asset panel and AI read.
                    <div key={`mv-${i}-${mv.fromMs}`} className="flex items-start gap-1.5">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full flex-none bg-[#a78bfa]/70" />
                      <div className="min-w-0">
                        <p className="text-[10.5px] leading-tight truncate text-muted">
                          {mv.asset} · {mv.place}
                        </p>
                        <p className="font-mono text-[9px] text-faint leading-tight" suppressHydrationWarning>
                          {POI_KIND_META[mv.kind]?.label ?? 'stop'} · {new Date(mv.fromMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {mv.minutes}m
                        </p>
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
      )}

      {panels.fleet !== 'hidden' && (
        <div className={'rounded-lg bg-navy-950/75 backdrop-blur border border-teal/15 px-3 py-2.5 flex flex-col ' + (panels.fleet === 'open' ? 'flex-1 min-h-0' : 'flex-none')}>
          <CardHeader k="fleet" title="Fleet board" state={panels.fleet} onPanel={onPanel} />
          {panels.fleet === 'open' && (
            <div className="space-y-1.5 overflow-y-auto no-scrollbar min-h-0">
              {strips.map(({ a, state, speed, zone, sinceMs }) => (
                <div key={a.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={'w-2 h-2 rounded-full flex-none ' + (state === 'moving' ? 'animate-blink' : '')}
                      style={{ background: state === 'dark' ? '#3b566e' : BLIP[a.type], boxShadow: state === 'moving' ? `0 0 6px ${BLIP[a.type]}` : undefined }}
                    />
                    <span className="flex-1 min-w-0 truncate text-[10.5px] text-muted">{a.name}</span>
                    <span className={'font-mono text-[9px] tabular-nums flex-none ' + (state === 'moving' ? 'text-amber' : state === 'idle' ? 'text-teal/80' : 'text-faint')} suppressHydrationWarning>
                      {state === 'moving' ? `${Math.round(speed)} MPH`
                        : state === 'dark' ? 'DARK'
                        : sinceMs != null ? fmtSince(sinceMs)
                        : zone ? 'ON SITE' : 'OFF SITE'}
                    </span>
                  </div>
                  {zone && (
                    <p className="pl-4 font-mono text-[8.5px] text-faint leading-tight truncate" suppressHydrationWarning>
                      {zone}{state === 'moving' && sinceMs != null ? ` · ${fmtSince(sinceMs)}` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => { onPanel('events', 'hidden'); onPanel('fleet', 'hidden') }}
        aria-label="Hide event rail"
        className="self-end flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint hover:text-teal transition-colors px-1 flex-none"
      >
        hide <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}
