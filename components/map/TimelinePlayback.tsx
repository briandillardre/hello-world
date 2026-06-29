'use client'

import { useState, useEffect } from 'react'
import { Play, Pause, Gauge, Ban, Route, Flame, CalendarClock, SlidersHorizontal } from 'lucide-react'
import {
  type TimeRange, type TrailMode, RANGES, rangeLabel, scrubLabel, speedsForRange, formatSpeed,
  customScrubLabel, customTickLabel,
} from '@/lib/trails'

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
}

export function TimelinePlayback({
  range, onRange, trailMode, onTrailMode, t, playing, speed, onSeek, onPlayPause, onSpeed,
  customFrom, customTo, onCustom,
}: TimelinePlaybackProps) {
  const live = range === 'live'
  const custom = range === 'custom'
  const [showCustom, setShowCustom] = useState(false)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    custom ? customTickLabel(customFrom, customTo, f) : rangeLabel(range, f)
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
    <div className="absolute bottom-[80px] md:bottom-4 left-3 right-3 md:left-4 md:right-4 z-10 rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
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
          {/* Custom From/To range */}
          <div className="relative flex-none">
            <button
              onClick={() => { onRange('custom'); setShowCustom((s) => !s) }}
              className={
                'flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-display font-bold transition-colors ' +
                (custom ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink hover:bg-navy-900')
              }
            >
              <SlidersHorizontal className="h-3 w-3" />
              Custom
            </button>
            {showCustom && (
              <div className="absolute bottom-full mb-2 right-0 z-20 w-[240px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-3 space-y-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-faint">From</span>
                  <input
                    type="datetime-local"
                    value={toLocalInput(customFrom)}
                    max={toLocalInput(customTo)}
                    onChange={(e) => onCustom(fromLocalInput(e.target.value), customTo)}
                    className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-faint">To</span>
                  <input
                    type="datetime-local"
                    value={toLocalInput(customTo)}
                    min={toLocalInput(customFrom)}
                    onChange={(e) => onCustom(customFrom, fromLocalInput(e.target.value))}
                    className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber"
                  />
                </label>
                <button
                  onClick={() => setShowCustom(false)}
                  className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-xs py-1.5 hover:bg-amber-600 transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>
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
      </div>

      {live ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink" />
          <span className="font-mono text-[12px] text-teal">Live · {ago}</span>
          <span className="font-mono text-[12px] text-faint truncate">
            · {trailMode === 'off' ? 'pick a range to replay, or turn on Trails / Heatmap' : 'showing all of today'}
          </span>
        </div>
      ) : (
        <>
        {/* prominent date/time readout (visible on mobile too) */}
        <div className="px-4 pt-2.5 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber flex-none" />
          <span className="font-display font-bold text-amber text-[15px] tabular-nums">
            {custom ? customScrubLabel(customFrom, customTo, t) : scrubLabel(range, t)}
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
  )
}
