'use client'

import { Play, Pause, History, X, Gauge } from 'lucide-react'
import { PLAYBACK_START_HOUR, PLAYBACK_END_HOUR } from '@/lib/trails'

const SPEEDS = [60, 300, 500, 1000]

interface TimelinePlaybackProps {
  active: boolean
  t: number
  playing: boolean
  speed: number
  label: string
  onToggleActive: () => void
  onSeek: (t: number) => void
  onPlayPause: () => void
  onSpeed: (s: number) => void
}

export function TimelinePlayback({
  active, t, playing, speed, label,
  onToggleActive, onSeek, onPlayPause, onSpeed,
}: TimelinePlaybackProps) {
  // Collapsed entry point
  if (!active) {
    return (
      <button
        onClick={onToggleActive}
        className="absolute bottom-4 left-3 z-10 inline-flex items-center gap-2 rounded-xl bg-navy-950/85 backdrop-blur border border-navy-700 text-ink px-4 py-2.5 text-sm font-display font-bold shadow-panel hover:bg-navy-900 transition-colors"
      >
        <History className="h-4 w-4 text-teal" />
        Replay day
      </button>
    )
  }

  const hours = Array.from({ length: PLAYBACK_END_HOUR - PLAYBACK_START_HOUR + 1 }, (_, i) => PLAYBACK_START_HOUR + i)

  return (
    <div className="absolute bottom-4 left-3 right-3 md:left-4 md:right-4 z-10 rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-800">
        <span className="font-display font-bold text-amber tracking-wide text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> TIMELINE PLAYBACK
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-ink tabular-nums">{label}</span>
          <button onClick={onToggleActive} className="p-1 text-faint hover:text-ink transition-colors" aria-label="Exit playback">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onPlayPause}
          className="flex-none grid place-items-center w-10 h-10 rounded-full bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>

        {/* scrubber */}
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(t * 1000)}
            onChange={(e) => onSeek(Number(e.target.value) / 1000)}
            className="w-full accent-teal cursor-pointer h-1.5"
          />
          <div className="flex justify-between mt-1 font-mono text-[10px] text-faint">
            {hours.filter((_, i) => i % 2 === 0).map((h) => {
              const ampm = h >= 12 ? 'P' : 'A'
              let hh = h % 12
              if (hh === 0) hh = 12
              return <span key={h}>{hh}{ampm}</span>
            })}
          </div>
        </div>

        {/* speed */}
        <div className="flex-none flex items-center gap-1.5 text-faint">
          <Gauge className="h-4 w-4" />
          <select
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
            className="bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs font-mono px-2 py-1.5 outline-none focus:border-teal"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
