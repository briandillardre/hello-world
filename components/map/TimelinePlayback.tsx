'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Pause, Gauge, Ban, Route, Flame, CalendarClock, SlidersHorizontal, HardHat, Video, X } from 'lucide-react'
import {
  type TimeRange, type TrailMode, type TrackWindow, RANGES, rangeLabel, scrubLabel,
  speedsForRange, formatSpeed, customScrubLabel, customTickLabel, windowTickLabel,
} from '@/lib/trails'
import type { AssetType } from '@/lib/types'
import { money } from '@/lib/projects'

export interface FollowAsset { id: string; name: string; type: AssetType; color: string }

// epoch ms <-> <input type="datetime-local"> value (local time, no seconds)
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
function fromLocalInput(v: string): number {
  return new Date(v).getTime()
}

const MODES: { key: TrailMode; label: string; icon: typeof Ban }[] = [
  { key: 'off', label: 'Off', icon: Ban },
  { key: 'trails', label: 'Trails', icon: Route },
  { key: 'heatmap', label: 'Heatmap', icon: Flame },
]

interface TimelinePlaybackProps {
  range: TimeRange
  onRange: (r: TimeRange) => void
  trailMode: TrailMode
  onTrailMode: (m: TrailMode) => void
  t: number
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onPlayPause: () => void
  onSpeed: (s: number) => void
  customFrom: number
  customTo: number
  onCustom: (fromMs: number, toMs: number) => void
  costTotal: number
  costLabel: string
  /** When tracks come from REAL history, the epoch window they span — labels
   *  then show true timestamps instead of the demo's 6AM-6PM pretend clock. */
  realWindow?: TrackWindow | null
  /** Cinematic camera-follow: the asset the camera is chasing (null = off). */
  followId: string | null
  onFollow: (id: string | null) => void
  /** Assets with a trail in the current window, offered as follow targets. */
  followAssets: FollowAsset[]
}

export function TimelinePlayback({
  range, onRange, trailMode, onTrailMode, t, playing, speed, onSeek, onPlayPause, onSpeed,
  customFrom, customTo, onCustom, costTotal, costLabel, realWindow,
  followId, onFollow, followAssets,
}: TimelinePlaybackProps) {
  const live = range === 'live'
  const custom = range === 'custom'
  const [showCustom, setShowCustom] = useState(false)
  const [showFollow, setShowFollow] = useState(false)
  const followWrap = useRef<HTMLDivElement>(null)
  const followed = followAssets.find((a) => a.id === followId) ?? null

  // Close the follow menu on any outside click.
  useEffect(() => {
    if (!showFollow) return
    const onDoc = (e: MouseEvent) => {
      if (followWrap.current && !followWrap.current.contains(e.target as Node)) setShowFollow(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [showFollow])
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    custom ? customTickLabel(customFrom, customTo, f)
    : realWindow ? windowTickLabel(realWindow, f)
    : rangeLabel(range, f)
  )
  const speeds = speedsForRange(range)

  // ticking "updated Ns ago" while live (cycles to feel real-time)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setTick((t) => (t + 1) % 5), 1000)
    return () => clearInterval(id)
  }, [live])
  const ago = tick === 0 ? 'updated just now' : `updated ${tick}s ago`

  return (
    <div className="absolute bottom-[80px] md:bottom-4 left-3 right-3 md:left-4 md:right-4 z-10">
      {/* Custom From/To panel — sibling of the bar so it escapes the overflow clip */}
      {custom && showCustom && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[260px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-3 space-y-2">
          <p className="font-display font-bold text-[13px] text-ink">Custom range</p>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">From</span>
            <input type="datetime-local" value={toLocalInput(customFrom)} max={toLocalInput(customTo)} onChange={(e) => onCustom(fromLocalInput(e.target.value), customTo)} className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">To</span>
            <input type="datetime-local" value={toLocalInput(customTo)} min={toLocalInput(customFrom)} onChange={(e) => onCustom(customFrom, fromLocalInput(e.target.value))} className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
          </label>
          <button onClick={() => setShowCustom(false)} className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-xs py-1.5 hover:bg-amber-600 transition-colors">Done</button>
        </div>
      )}
      <div className="rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      {/* range pills + movement-display control */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-navy-800">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => onRange(r.key)}
              className={
                'flex-none px-3 py-1 rounded-full text-[12px] font-display font-bold transition-colors ' +
                (range === r.key
                  ? r.key === 'live' ? 'bg-teal/20 text-teal' : 'bg-amber/20 text-amber'
                  : 'text-faint hover:text-ink hover:bg-navy-900')
              }
            >
              {r.key === 'live' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal mr-1.5 align-middle animate-blink" />}
              {r.label}
            </button>
          ))}
        </div>
        {/* Custom pill — pinned outside the scroll area so its panel isn't clipped */}
        <button
          onClick={() => { onRange('custom'); setShowCustom((s) => !s) }}
          className={
            'flex-none flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-display font-bold transition-colors ' +
            (custom ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink hover:bg-navy-900')
          }
        >
          <SlidersHorizontal className="h-3 w-3" /> Custom
        </button>
        {/* Live project cost — moved here from the floating panel */}
        <div className="flex-none flex items-center gap-1 font-mono text-[11px] text-amber whitespace-nowrap" title={`Project cost · ${costLabel}`}>
          <HardHat className="h-3.5 w-3.5" />
          {money(costTotal)}
          <span className="hidden md:inline text-faint">· {costLabel}</span>
        </div>
        <div className="flex-none flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onTrailMode(key)}
              title={label}
              className={
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ' +
                (trailMode === key ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Cinematic camera-follow */}
        {followAssets.length > 0 && (
          <div ref={followWrap} className="flex-none relative">
            <button
              onClick={() => (followed ? onFollow(null) : setShowFollow((s) => !s))}
              title={followed ? `Following ${followed.name} — click to release` : 'Cinematic follow'}
              className={
                'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ' +
                (followed
                  ? 'bg-amber/20 text-amber border-amber/40'
                  : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
              }
            >
              <Video className="h-3.5 w-3.5" />
              <span className="hidden sm:inline max-w-[90px] truncate">{followed ? followed.name : 'Follow'}</span>
              {followed && <X className="h-3 w-3" />}
            </button>

            {showFollow && !followed && (
              <div className="absolute bottom-full mb-2 right-0 z-30 w-[220px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2">
                <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink flex items-center gap-1.5">
                  <Video className="h-3.5 w-3.5 text-amber" /> Fly the camera with…
                </p>
                <div className="max-h-[200px] overflow-y-auto no-scrollbar">
                  {followAssets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { onFollow(a.id); setShowFollow(false) }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[13px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: a.color }} />
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
                <p className="px-2 pt-1.5 pb-0.5 text-[10px] text-faint leading-snug">
                  Tilts into 3D and chases the asset along its route. Turn off any time.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {live ? (
        <div className="flex items-center gap-2 px-4 py-3 min-w-0 flex-nowrap overflow-hidden">
          <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink flex-none" />
          <span className="font-mono text-[12px] text-teal whitespace-nowrap flex-none">Live · {ago}</span>
          <span className="font-mono text-[12px] text-faint truncate whitespace-nowrap min-w-0">
            · {trailMode === 'off' ? 'pick a range to replay, or turn on Trails / Heatmap' : 'showing all of today'}
          </span>
        </div>
      ) : (
        <>
        {/* prominent date/time readout (visible on mobile too) */}
        <div className="px-4 pt-2.5 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber flex-none" />
          <span className="font-display font-bold text-amber text-[15px] tabular-nums">
            {custom ? customScrubLabel(customFrom, customTo, t)
              : realWindow ? customScrubLabel(realWindow.from, realWindow.to, t)
              : scrubLabel(range, t)}
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 pt-2 pb-3">
          <button
            onClick={onPlayPause}
            className="flex-none grid place-items-center w-10 h-10 rounded-full bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>

          <div className="flex-1 min-w-0">
            <input
              type="range" min={0} max={1000} value={Math.round(t * 1000)}
              onChange={(e) => onSeek(Number(e.target.value) / 1000)}
              className="w-full accent-amber cursor-pointer h-1.5"
            />
            <div className="flex justify-between mt-1 font-mono text-[10px] text-faint">
              {ticks.map((label, i) => <span key={i}>{label}</span>)}
            </div>
          </div>

          <div className="flex-none flex items-center gap-1.5 text-faint">
            <Gauge className="h-4 w-4" />
            <select
              value={speed}
              onChange={(e) => onSpeed(Number(e.target.value))}
              className="bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs font-mono px-2 py-1.5 outline-none focus:border-amber"
            >
              {speeds.map((s) => <option key={s} value={s}>{formatSpeed(s)}</option>)}
            </select>
          </div>
        </div>
        </>
      )}
      </div>
    </div>
  )
}
