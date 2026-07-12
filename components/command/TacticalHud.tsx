'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { pointInPolygon } from '@/lib/alerts-engine'
import { trailColor } from '@/lib/trails'

/**
 * Tactical HUD — a round aviation/Garmin-style instrument for the Command
 * Center. Not decoration: every element reads real fleet state.
 *
 *   · compass ring with cardinal letters + degree ticks
 *   · sweeping radar beam (pure CSS conic gradient — GPU-cheap)
 *   · one blip per asset, positioned by TRUE bearing/distance from the
 *     fleet centroid; moving assets pulse
 *   · readouts: local clock, moving count, on-site %, avg speed, alerts
 *
 * Scales from phone (compact — ring + clock + moving) to wall TV (full).
 */

interface Blip { id: string; name: string; x: number; y: number; color: string; moving: boolean; big: boolean }

function useClock(): string {
  const [now, setNow] = useState('--:--:--')
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString([], { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function TacticalHud({ assets, geofences, alertCount = 0, center = null }: {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  alertCount?: number
  /** Radar origin — the map camera's crosshair. Null = fleet centroid. */
  center?: { lng: number; lat: number } | null
}) {
  const clock = useClock()

  const { blips, moving, onSitePct, avgSpeed, topSpeed, topName, lowBatt, newestMs, typeLine, rangeMi } = useMemo(() => {
    const located = assets.filter((a) => a.location)
    if (located.length === 0) return { blips: [] as Blip[], moving: 0, onSitePct: 0, avgSpeed: 0, topSpeed: 0, topName: '', lowBatt: 0, newestMs: 0, typeLine: '', rangeMi: 0 }

    // Origin: the map's crosshair when provided (pan the wall display and the
    // scope re-aims), else the fleet centroid.
    const cx = center?.lng ?? located.reduce((s, a) => s + a.location!.lng, 0) / located.length
    const cy = center?.lat ?? located.reduce((s, a) => s + a.location!.lat, 0) / located.length
    // Compensate longitude shrink so bearings stay true-ish at this latitude.
    const lngScale = Math.cos((cy * Math.PI) / 180)
    let maxR = 0
    const rel = located.map((a) => {
      const dx = (a.location!.lng - cx) * lngScale
      const dy = a.location!.lat - cy
      const r = Math.hypot(dx, dy)
      if (r > maxR) maxR = r
      return { a, dx, dy, r }
    })
    const rings = geofences.filter((g) => g.kind !== 'boundary').map((g) => (g.geometry?.coordinates?.[0] ?? []) as [number, number][])
    let movingN = 0
    let onSite = 0
    let spdSum = 0
    let spdN = 0
    const blips: Blip[] = rel.map(({ a, dx, dy, r }) => {
      const isMoving = (a.location!.speed ?? 0) > 2
      if (isMoving) { movingN++; spdSum += a.location!.speed ?? 0; spdN++ }
      if (rings.some((ring) => ring.length >= 3 && pointInPolygon([a.location!.lng, a.location!.lat], ring))) onSite++
      const f = maxR > 0 ? (r / maxR) * 0.82 : 0 // keep inside the ring
      return {
        id: a.id,
        name: a.name,
        x: 50 + (maxR > 0 ? (dx / maxR) * 0.82 * 50 : 0),
        y: 50 - (maxR > 0 ? (dy / maxR) * 0.82 * 50 : 0),
        // The asset's chosen color, else the same deterministic trail color.
        color: (a.metadata?.color as string | undefined) || trailColor(a.id),
        moving: isMoving,
        big: a.type !== 'tool' && f >= 0,
      }
    })
    // Extra readouts: fastest asset right now, weak batteries, data
    // freshness, and the fleet mix — every line is real state.
    let topSpeed = 0
    let topName = ''
    let lowBatt = 0
    let newestMs = 0
    const typeCounts: Partial<Record<AssetType, number>> = {}
    for (const a of located) {
      const spd = a.location!.speed ?? 0
      if (spd > topSpeed) { topSpeed = spd; topName = a.name }
      if (a.location!.battery != null && a.location!.battery < 20) lowBatt++
      const ms = new Date(a.location!.timestamp).getTime()
      if (ms > newestMs) newestMs = ms
      typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1
    }
    const typeLine = (['vehicle', 'equipment', 'personnel', 'tool'] as AssetType[])
      .filter((t) => typeCounts[t])
      .map((t) => `${t[0].toUpperCase()}${typeCounts[t]}`)
      .join(' ')

    return {
      blips,
      moving: movingN,
      onSitePct: Math.round((onSite / located.length) * 100),
      avgSpeed: spdN ? spdSum / spdN : 0,
      topSpeed, topName, lowBatt, newestMs, typeLine,
      // Outer ring radius in miles (≈69 mi per degree after lng correction).
      rangeMi: maxR * 69,
    }
  }, [assets, geofences, center])

  const ticks = useMemo(() => Array.from({ length: 36 }, (_, i) => i * 10), [])

  return (
    <div className="pointer-events-none select-none w-[clamp(150px,26vw,320px)] aspect-square relative font-mono">
      {/* glass bezel */}
      <div className="absolute inset-0 rounded-full bg-navy-950/70 backdrop-blur border border-teal/30 shadow-[0_0_28px_rgba(45,212,191,0.18),inset_0_0_40px_rgba(0,21,35,0.9)]" />

      {/* degree ticks + cardinals + range rings */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        {ticks.map((deg) => {
          const major = deg % 30 === 0
          const rad = (deg * Math.PI) / 180
          const r1 = major ? 44.5 : 46.2
          // toFixed: Node and Chromium disagree on sin/cos in the 16th digit,
          // which serialized as different SVG attrs and tripped hydration
          // (React 418/423 on the wall display). Two decimals is sub-pixel.
          const x1 = (50 + r1 * Math.sin(rad)).toFixed(2)
          const y1 = (50 - r1 * Math.cos(rad)).toFixed(2)
          const x2 = (50 + 48 * Math.sin(rad)).toFixed(2)
          const y2 = (50 - 48 * Math.cos(rad)).toFixed(2)
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? '#2dd4bf' : '#14506f'} strokeWidth={major ? 0.7 : 0.4} opacity={major ? 0.9 : 0.7} />
        })}
        {[14, 26, 38].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#14506f" strokeWidth="0.35" opacity="0.8" />
        ))}
        <line x1="50" y1="10" x2="50" y2="90" stroke="#14506f" strokeWidth="0.3" opacity="0.55" />
        <line x1="10" y1="50" x2="90" y2="50" stroke="#14506f" strokeWidth="0.3" opacity="0.55" />
        {(['N', 'E', 'S', 'W'] as const).map((c, i) => {
          const rad = (i * 90 * Math.PI) / 180
          const x = (50 + 41 * Math.sin(rad)).toFixed(2)
          const y = (50 - 41 * Math.cos(rad)).toFixed(2)
          return (
            <text key={c} x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontSize="4.6" fontFamily="var(--font-mono, monospace)" fontWeight="700"
              fill={c === 'N' ? '#ff9e16' : '#9fb6cc'}>{c}</text>
          )
        })}
      </svg>

      {/* radar sweep — conic gradient wedge, pure CSS rotation */}
      <div className="absolute inset-[6%] rounded-full overflow-hidden">
        <div
          className="absolute inset-0 rounded-full animate-[spin_5s_linear_infinite]"
          style={{ background: 'conic-gradient(from 0deg, rgba(45,212,191,0.28), rgba(45,212,191,0.05) 55deg, transparent 75deg)' }}
        />
      </div>

      {/* asset blips at true bearings — tap one and the map flies to it */}
      <div className="absolute inset-0">
        {blips.map((b) => (
          <button
            key={b.id}
            title={b.name}
            aria-label={`Go to ${b.name}`}
            onClick={() => window.dispatchEvent(new CustomEvent('ht:focus-asset', { detail: { id: b.id } }))}
            className="absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-4 h-4 pointer-events-auto cursor-pointer"
            style={{ left: `${b.x.toFixed(2)}%`, top: `${b.y.toFixed(2)}%` }}
          >
            <span
              className={'rounded-full ' + (b.moving ? 'animate-blink' : '')}
              style={{
                width: b.big ? 6 : 4, height: b.big ? 6 : 4,
                background: b.color,
                boxShadow: `0 0 ${b.moving ? 9 : 4}px ${b.color}`,
              }}
            />
          </button>
        ))}
      </div>

      {/* center dot */}
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-teal shadow-[0_0_8px_#2dd4bf]" />

      {/* readouts */}
      <div className="absolute inset-x-0 top-[13%] text-center leading-none">
        <span className="text-teal text-[clamp(9px,1.2vw,13px)] tracking-[0.18em] tabular-nums">{clock}</span>
      </div>
      {/* scope range: distance from center to the outer ring */}
      {rangeMi > 0 && (
        <div className="hidden sm:block absolute inset-x-0 top-[36%] text-center leading-none">
          <span className="text-faint/80 text-[clamp(7px,0.85vw,10px)] tracking-[0.14em] tabular-nums">
            RNG {rangeMi >= 10 ? Math.round(rangeMi) : rangeMi.toFixed(1)} MI
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-[24%] text-center leading-tight">
        <p className="text-ink font-bold text-[clamp(12px,1.7vw,20px)] tabular-nums">
          {moving}<span className="text-faint text-[0.62em]">/{assets.filter(a => a.location).length} MOVING</span>
        </p>
      </div>
      <div className="hidden sm:block absolute inset-x-0 bottom-[15%] text-center leading-none">
        <span className="text-faint text-[clamp(8px,1vw,11px)] tracking-[0.14em] tabular-nums">
          ON-SITE {onSitePct}% · {avgSpeed.toFixed(0)} MPH
        </span>
      </div>
      {/* fleet mix · sync age · weak batteries — the wall display's vitals line */}
      <div className="hidden sm:block absolute inset-x-0 bottom-[9%] text-center leading-none">
        {/* suppressHydrationWarning: SYNC age is Date.now()-based, so server
            and client render a second or two apart — same as the ticker. */}
        <span suppressHydrationWarning className="text-faint/80 text-[clamp(7px,0.85vw,10px)] tracking-[0.14em] tabular-nums">
          {typeLine}
          {newestMs > 0 && ` · SYNC ${Math.max(0, Math.round((Date.now() - newestMs) / 1000))}S`}
          {lowBatt > 0 && <span className="text-amber"> · ▲ {lowBatt} LOW BATT</span>}
        </span>
      </div>
      {/* fastest mover right now — the eye-catcher stat */}
      {topSpeed > 2 && (
        <div className="hidden sm:block absolute inset-x-0 top-[29%] text-center leading-none">
          <span className="text-amber text-[clamp(8px,1vw,11px)] tracking-[0.16em] tabular-nums">
            TOP {Math.round(topSpeed)} MPH · {topName.toUpperCase().slice(0, 14)}
          </span>
        </div>
      )}
      {alertCount > 0 && (
        <div className="absolute inset-x-0 top-[22%] text-center leading-none">
          <span className="text-alert text-[clamp(8px,1.1vw,12px)] tracking-[0.2em] animate-blink">▲ {alertCount} ALERT{alertCount === 1 ? '' : 'S'}</span>
        </div>
      )}
    </div>
  )
}
