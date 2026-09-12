'use client'

import { useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import type { Fix } from '@/lib/aircraft-log'

/**
 * Fly the flight back (Brian, Sep 12, sending FlightRadar24's flight view,
 * which has a play button and a speed slider).
 *
 * Speeds are multiples of REAL TIME, the way every other playback in this app
 * and in FR24 means them: at 60× a minute of flight passes in a second. The
 * clock is what advances, not an index — stepping "one fix per frame" would
 * run a sparse stretch of track at a different speed from a dense one, which
 * is exactly the lie the trails scrubber avoids elsewhere.
 *
 * Nothing animates unless it is playing: paused is paused, same rule as the
 * map's timeline.
 */

const SPEEDS = [10, 30, 60, 120]

export function FlightPlayback({
  track, idx, onIdx, playing, onPlaying, speed, onSpeed,
}: {
  track: Fix[]
  idx: number
  onIdx: (i: number) => void
  playing: boolean
  onPlaying: (p: boolean) => void
  speed: number
  onSpeed: (s: number) => void
}) {
  const raf = useRef<number | null>(null)
  const simT = useRef<number>(0)
  const last = useRef<number>(0)

  const t0 = track[0]?.t ?? 0
  const tN = track[track.length - 1]?.t ?? 0
  const span = Math.max(1, tN - t0)

  // Keep the clock in step when the index is moved from outside (a scrub, or
  // the chart being dragged) so pressing play resumes from there.
  useEffect(() => {
    const t = track[idx]?.t
    if (t != null && !playing) simT.current = t
  }, [idx, playing, track])

  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
      return
    }
    // Restart from the beginning if it was parked at the end.
    if (simT.current >= tN) simT.current = t0
    last.current = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last.current) / 1000) // a backgrounded
      last.current = now                                     // tab must not jump
      simT.current += dt * speed
      if (simT.current >= tN) {
        simT.current = tN
        onIdx(track.length - 1)
        onPlaying(false)
        return
      }
      // Nearest fix to the simulated clock.
      let lo = 0
      let hi = track.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (track[mid].t < simT.current) lo = mid + 1
        else hi = mid
      }
      onIdx(lo)
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [playing, speed, t0, tN, track, onIdx, onPlaying])

  const at = track[idx]
  const frac = at ? (at.t - t0) / span : 0
  const elapsed = at ? Math.round(at.t - t0) : 0
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-navy-800 bg-navy-950 px-2.5 py-2">
      <button
        type="button"
        onClick={() => onPlaying(!playing)}
        aria-label={playing ? 'Pause the replay' : 'Fly this flight back'}
        className="grid h-8 w-8 flex-none place-items-center rounded-full bg-amber text-[#1a1100]"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <button
        type="button"
        onClick={() => { simT.current = t0; onIdx(0) }}
        aria-label="Back to the start"
        className="grid h-8 w-8 flex-none place-items-center rounded-full border border-navy-700 text-muted hover:text-ink"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0, track.length - 1)}
        value={idx}
        onChange={(e) => { onPlaying(false); onIdx(Number(e.target.value)) }}
        aria-label="Scrub through the flight"
        className="ht-flight-scrub min-w-[120px] flex-1"
        style={{ accentColor: '#ff9e16' }}
      />

      <span className="flex-none font-mono text-[11px] tabular-nums text-muted">
        {mmss(elapsed)}
        <span className="text-faint"> / {mmss(Math.round(span))}</span>
      </span>

      <span className="flex flex-none items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
              speed === s ? 'bg-amber/20 text-amber' : 'text-faint hover:text-muted'
            }`}
          >
            {s}×
          </button>
        ))}
      </span>
      <span className="sr-only" role="status">{Math.round(frac * 100)}% through the flight</span>
    </div>
  )
}
