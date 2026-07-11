'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AssetWithLocation, AssetType, AlertEvent } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'

/**
 * Right instrument rail for the Command Center — the ops half of the frame:
 *   · event log: real alerts, loudest first (theft triggers blink red)
 *   · per-asset strips: state + battery for every unit, moving first
 * Collapsible; wide screens only. Sits above the tactical instrument.
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

export function EventRail({ assets, alerts }: {
  assets: AssetWithLocation[]
  alerts: AlertEvent[]
}) {
  const [open, setOpen] = useState(true)

  const events = alerts.slice(0, 8)

  const strips = useMemo(() => {
    const now = Date.now()
    return assets
      .map((a) => {
        const loc = a.location
        const ageMs = loc ? now - new Date(loc.timestamp).getTime() : Infinity
        const state: 'moving' | 'idle' | 'dark' =
          !loc || ageMs > STALE_MS ? 'dark' : (loc.speed ?? 0) > 2 ? 'moving' : 'idle'
        return { a, state, speed: loc?.speed ?? 0, battery: loc?.battery ?? null }
      })
      .sort((x, y) => {
        const rank = { moving: 0, idle: 1, dark: 2 }
        return rank[x.state] - rank[y.state] || x.a.name.localeCompare(y.a.name)
      })
  }, [assets])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Show event rail"
        className="grid place-items-center w-7 h-14 rounded-l-lg bg-navy-950/75 backdrop-blur border border-r-0 border-teal/20 text-teal/70 hover:text-teal transition-colors ml-auto"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="w-56 h-full flex flex-col gap-2.5">
      <div className="rounded-lg bg-navy-950/75 backdrop-blur border border-teal/15 px-3 py-2.5 flex-none">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal/80 mb-1.5">Event log</p>
        {events.length === 0 ? (
          <p className="font-mono text-[10px] text-faint">no events · all quiet</p>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => {
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
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-navy-950/75 backdrop-blur border border-teal/15 px-3 py-2.5 flex-1 min-h-0 flex flex-col">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal/80 mb-1.5 flex-none">Fleet board</p>
        <div className="space-y-1.5 overflow-y-auto no-scrollbar min-h-0">
          {strips.map(({ a, state, speed, battery }) => (
            <div key={a.id} className="flex items-center gap-2">
              <span
                className={'w-2 h-2 rounded-full flex-none ' + (state === 'moving' ? 'animate-blink' : '')}
                style={{ background: state === 'dark' ? '#3b566e' : BLIP[a.type], boxShadow: state === 'moving' ? `0 0 6px ${BLIP[a.type]}` : undefined }}
              />
              <span className="flex-1 min-w-0 truncate text-[10.5px] text-muted">{a.name}</span>
              <span className={'font-mono text-[9px] tabular-nums flex-none ' + (state === 'moving' ? 'text-amber' : state === 'idle' ? 'text-teal/80' : 'text-faint')}>
                {state === 'moving' ? `${Math.round(speed)} MPH` : state === 'idle' ? 'ON SITE' : 'DARK'}
              </span>
              {battery != null && (
                <span className={'font-mono text-[9px] tabular-nums w-7 text-right flex-none ' + (battery < 20 ? 'text-alert' : 'text-faint')}>
                  {battery}%
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => setOpen(false)}
        aria-label="Hide event rail"
        className="self-end flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint hover:text-teal transition-colors px-1 flex-none"
      >
        hide <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}
