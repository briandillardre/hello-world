'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gauge } from 'lucide-react'
import { formatSpeed, niceSpeed } from '@/lib/trails'

/**
 * Playback-speed picker. A native <select> here opens Android's full-screen
 * radio list over the whole map — so instead: a compact button that pops a
 * CONTINUOUS slider (log scale from 1× to the window's fastest sweep, so the
 * bounds adapt to every timeframe), snapped to clean 1/2/5×10ⁿ values, with
 * the window's preset speeds as tappable ticks underneath.
 */
const STEPS = 200 // slider resolution across the log range

export function SpeedControl({
  speeds, value, onChange,
}: {
  speeds: number[]
  value: number
  onChange: (s: number) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // The timeline sheet clips children (overflow-hidden + backdrop-blur, which
  // also traps position:fixed descendants) — so the popup PORTALS to <body>
  // and anchors to the button's measured viewport rect. It protrudes above
  // the sheet instead of getting its top sliced off ("cut off", Aug 11).
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const toggle = () => {
    if (!open && wrap.current) {
      const r = wrap.current.getBoundingClientRect()
      const right = Math.min(Math.max(8, window.innerWidth - r.right), Math.max(8, window.innerWidth - 256))
      setPos({ right, bottom: window.innerHeight - r.top + 8 })
    }
    setOpen((v) => !v)
  }

  // Log-scale mapping between slider position (0..STEPS) and multiplier.
  // Bounds come from the per-window speeds list, so Today slides 1×–5k×
  // while YTD slides 1×–1M× — "applicable to each timeframe" for free.
  const min = Math.max(1, speeds[0] ?? 1)
  const max = Math.max(min + 1, speeds[speeds.length - 1] ?? 1000)
  const lnMin = Math.log(min)
  const lnMax = Math.log(max)
  const toPos = (v: number) =>
    Math.round(((Math.log(Math.min(max, Math.max(min, v))) - lnMin) / (lnMax - lnMin)) * STEPS)
  const fromPos = (p: number) => niceSpeed(Math.exp(lnMin + (p / STEPS) * (lnMax - lnMin)))

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrap.current?.contains(t) || pop.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={wrap} className="relative flex-none">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs font-mono px-2 py-1.5 outline-none hover:border-amber/60 focus-visible:border-amber"
        aria-label="Playback speed"
        aria-expanded={open}
      >
        <Gauge className="h-4 w-4 text-faint" />
        <span className="tabular-nums">{formatSpeed(value)}</span>
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={pop} className="fixed z-[130] w-[248px] rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel px-3 pt-2.5 pb-2" style={{ right: pos.right, bottom: pos.bottom }}>
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Speed</span>
            <span className="font-display font-bold text-amber text-[13px] tabular-nums">{formatSpeed(value)}</span>
          </div>
          {/* slider-heat's track is transparent (it expects a heat gradient
              behind it on the timeline) — give this one a visible rail with
              an amber fill up to the thumb ("hard to see", Aug 5). */}
          <div className="relative h-[22px] flex items-center">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[7px] rounded-full bg-navy-700 border border-navy-600/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber/45 to-amber"
                style={{ width: `${Math.max(3, (toPos(value) / STEPS) * 100)}%` }}
              />
            </div>
            <input
              type="range" min={0} max={STEPS} step={1} value={toPos(value)}
              onChange={(e) => onChange(fromPos(Number(e.target.value)))}
              className="slider-heat relative w-full h-[22px] cursor-pointer touch-none"
              aria-label="Playback speed"
              aria-valuetext={formatSpeed(value)}
            />
          </div>
          {/* Preset ticks — one-tap jumps to the window's canonical speeds */}
          <div className="flex justify-between mt-0.5">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => onChange(s)}
                className={`font-mono text-[9.5px] px-0.5 py-1 ${s === value ? 'text-amber font-bold' : 'text-faint hover:text-ink'}`}
              >
                {formatSpeed(s)}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
