'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import { buildActivityCurve, areaPath } from '@/lib/activity'
import { pointInPolygon } from '@/lib/alerts-engine'
import { fetchConditions, weatherEmoji, type Conditions } from '@/lib/weather'

/**
 * Left instrument rail for the Command Center — the mission-control frame
 * around the map. Four compact live modules, every pixel real data:
 *   · fleet activity waveform (24h movement)
 *   · site presence (who's inside which zone right now)
 *   · fleet status counters + weakest batteries
 *   · on-site weather (fleet centroid)
 * Collapsible so the wall display can go full-map.
 */

const STALE_MS = 2 * 3_600_000

function Module({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-navy-950/75 backdrop-blur border border-teal/15 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal/80 mb-1.5">{title}</p>
      {children}
    </div>
  )
}

export function CommandRail({ assets, geofences, tracks }: {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  tracks: AssetTrack[]
}) {
  const [open, setOpen] = useState(true)

  // ── fleet activity waveform (24h of movement) ──
  const activity = useMemo(() => buildActivityCurve(tracks, 48), [tracks])
  const activityMax = Math.max(1, ...activity)
  const wavePath = useMemo(() => areaPath(activity, activityMax, 200, 40, 3), [activity, activityMax])

  // ── site presence ──
  const sites = useMemo(() => {
    const located = assets.filter((a) => a.location)
    return geofences
      .map((g) => {
        const ring = (g.geometry?.coordinates?.[0] ?? []) as [number, number][]
        const inside = ring.length >= 3
          ? located.filter((a) => pointInPolygon([a.location!.lng, a.location!.lat], ring)).length
          : 0
        return { id: g.id, name: g.name, color: g.color, inside }
      })
      .sort((a, b) => b.inside - a.inside)
      .slice(0, 5)
  }, [assets, geofences])
  const siteMax = Math.max(1, ...sites.map((s) => s.inside))

  // ── fleet status ──
  const status = useMemo(() => {
    const now = Date.now()
    let moving = 0, still = 0, dark = 0
    const batts: { name: string; pct: number }[] = []
    for (const a of assets) {
      const loc = a.location
      if (!loc || now - new Date(loc.timestamp).getTime() > STALE_MS) { dark++; continue }
      if ((loc.speed ?? 0) > 2) moving++
      else still++
      if (loc.battery != null) batts.push({ name: a.name, pct: loc.battery })
    }
    batts.sort((x, y) => x.pct - y.pct)
    return { moving, still, dark, weakest: batts.slice(0, 3) }
  }, [assets])

  // ── on-site weather at the fleet centroid, refreshed every 10 min ──
  const [wx, setWx] = useState<Conditions | null>(null)
  useEffect(() => {
    const located = assets.filter((a) => a.location)
    if (!located.length) return
    const lat = located.reduce((s, a) => s + a.location!.lat, 0) / located.length
    const lng = located.reduce((s, a) => s + a.location!.lng, 0) / located.length
    let cancelled = false
    const load = () => fetchConditions(lat, lng).then((c) => { if (!cancelled && c) setWx(c) })
    load()
    const id = setInterval(load, 600_000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Show instrument rail"
        className="grid place-items-center w-7 h-14 rounded-r-lg bg-navy-950/75 backdrop-blur border border-l-0 border-teal/20 text-teal/70 hover:text-teal transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="w-52 flex flex-col gap-2.5 overflow-y-auto no-scrollbar">
      <Module title="Fleet activity · 24h">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-[40px]">
          <defs>
            <linearGradient id="rail-wave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          {[10, 20, 30].map((y) => (
            <line key={y} x1="0" x2="200" y1={y} y2={y} stroke="#14364f" strokeWidth="0.5" />
          ))}
          {wavePath && (
            <>
              <path d={`${wavePath} L 200 40 L 0 40 Z`} fill="url(#rail-wave)" stroke="none" />
              <path d={wavePath} fill="none" stroke="#2dd4bf" strokeWidth="1.4" strokeLinejoin="round" />
            </>
          )}
        </svg>
        <p className="font-mono text-[9px] text-faint mt-1 tabular-nums">peak {activityMax} moving</p>
      </Module>

      <Module title="Site presence">
        {sites.length === 0 ? (
          <p className="font-mono text-[10px] text-faint">no zones drawn yet</p>
        ) : (
          <div className="space-y-1.5">
            {sites.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm flex-none" style={{ background: s.color }} />
                <span className="flex-1 min-w-0 truncate text-[11px] text-muted">{s.name}</span>
                <span className="relative w-12 h-1.5 rounded-full bg-navy-800 overflow-hidden flex-none">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-teal/70" style={{ width: `${(s.inside / siteMax) * 100}%` }} />
                </span>
                <span className="font-mono text-[11px] text-ink tabular-nums w-4 text-right flex-none">{s.inside}</span>
              </div>
            ))}
          </div>
        )}
      </Module>

      <Module title="Fleet status">
        <div className="grid grid-cols-3 text-center mb-1.5">
          <div>
            <p className="font-display font-black text-[17px] text-amber tabular-nums">{status.moving}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-wide text-faint">Moving</p>
          </div>
          <div>
            <p className="font-display font-black text-[17px] text-teal tabular-nums">{status.still}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-wide text-faint">On site</p>
          </div>
          <div>
            <p className="font-display font-black text-[17px] text-faint tabular-nums">{status.dark}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-wide text-faint">Dark</p>
          </div>
        </div>
        {status.weakest.length > 0 && (
          <div className="space-y-1 border-t border-navy-800 pt-1.5">
            {status.weakest.map((b) => (
              <div key={b.name} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-[10px] text-muted">{b.name}</span>
                <span className="relative w-10 h-1.5 rounded-full bg-navy-800 overflow-hidden flex-none">
                  <span
                    className={'absolute inset-y-0 left-0 rounded-full ' + (b.pct < 20 ? 'bg-alert' : b.pct < 50 ? 'bg-amber' : 'bg-[#34d399]')}
                    style={{ width: `${b.pct}%` }}
                  />
                </span>
                <span className="font-mono text-[10px] text-faint tabular-nums w-7 text-right flex-none">{b.pct}%</span>
              </div>
            ))}
          </div>
        )}
      </Module>

      {wx && (
        <Module title="On-site weather">
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none">{weatherEmoji(wx.code)}</span>
            <div className="flex-1">
              <p className="font-display font-black text-[17px] text-ink leading-none tabular-nums">{wx.tempF}°</p>
              <p className="font-mono text-[9px] text-faint mt-0.5 tabular-nums">wind {wx.windMph} mph{wx.precip > 0 ? ` · ${wx.precip}" rain` : ''}</p>
            </div>
            {wx.isThunder && (
              <span className="font-mono text-[9px] text-alert tracking-wide animate-blink">▲ STORM</span>
            )}
          </div>
        </Module>
      )}

      <button
        onClick={() => setOpen(false)}
        aria-label="Hide instrument rail"
        className="self-start flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint hover:text-teal transition-colors px-1"
      >
        <ChevronLeft className="h-3 w-3" /> hide
      </button>
    </div>
  )
}
