'use client'

import { useEffect, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import { formatSpeed } from '@/lib/trails'

/**
 * Playback-speed picker. A native <select> here opens Android's full-screen
 * radio list over the whole map — so instead: a compact button that pops a
 * stepped slider (snaps across the discrete speeds for the current window),
 * with tappable tick labels underneath.
 */
export function SpeedControl({
  speeds, value, onChange,
}: {
  speeds: number[]
  value: number
  onChange: (s: number) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Closest index — the speeds list changes with the time window, so the
  // current value may not be an exact member.
  const idx = speeds.reduce(
    (best, s, i) => (Math.abs(s - value) < Math.abs(speeds[best] - value) ? i : best),
    0,
  )

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={wrap} className="relative flex-none">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs font-mono px-2 py-1.5 outline-none hover:border-amber/60 focus-visible:border-amber"
        aria-label="Playback speed"
        aria-expanded={open}
      >
        <Gauge className="h-4 w-4 text-faint" />
        <span className="tabular-nums">{formatSpeed(value)}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-30 w-[232px] rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel px-3 pt-2.5 pb-2">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Speed</span>
            <span className="font-display font-bold text-amber text-[13px] tabular-nums">{formatSpeed(speeds[idx])}</span>
          </div>
          <input
            type="range" min={0} max={speeds.length - 1} step={1} value={idx}
            onChange={(e) => onChange(speeds[Number(e.target.value)])}
            className="slider-heat w-full h-[22px] cursor-pointer touch-none"
            aria-label="Playback speed"
            aria-valuetext={formatSpeed(speeds[idx])}
          />
          <div className="flex justify-between mt-0.5">
            {speeds.map((s, i) => (
              <button
                key={s}
                onClick={() => onChange(s)}
                className={`font-mono text-[9.5px] px-0.5 py-1 ${i === idx ? 'text-amber font-bold' : 'text-faint hover:text-ink'}`}
              >
                {formatSpeed(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
