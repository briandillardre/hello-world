'use client'

import { Play, Pause, Gauge } from 'lucide-react'
import { type TimeRange, RANGES, rangeLabel } from '@/lib/trails'

const SPEEDS = [60, 300, 500, 1000]

interface TimelinePlaybackProps {
  range: TimeRange
  onRange: (r: TimeRange) => void
  t: number
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onPlayPause: () => void
  onSpeed: (s: number) => void
}

export function TimelinePlayback({
  range, onRange, t, playing, speed, onSeek, onPlayPause, onSpeed,
}: TimelinePlaybackProps) {
  const live = range === 'live'
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => rangeLabel(range, f))

  return (
    <div className="absolute bottom-[80px] md:bottom-4 left-3 right-3 md:left-4 md:right-4 z-10 rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      {/* range pills */}
      <div className="flex gap-1.5 px-3 pt-2.5 pb-2 overflow-x-auto no-scrollbar border-b border-navy-800">
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

      {live ? (
        <div className="flex items-center gap-2 px-4 py-3 text-faint">
          <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink" />
          <span className="font-mono text-[12px] text-muted">Real-time. Pick a range above to replay.</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
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

          <span className="flex-none font-display font-bold text-[14px] text-amber tabular-nums hidden sm:block min-w-[70px] text-right">
            {rangeLabel(range, t)}
          </span>

          <div className="flex-none flex items-center gap-1.5 text-faint">
            <Gauge className="h-4 w-4" />
            <select
              value={speed}
              onChange={(e) => onSpeed(Number(e.target.value))}
              className="bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs font-mono px-2 py-1.5 outline-none focus:border-amber"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
