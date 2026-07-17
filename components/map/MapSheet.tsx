'use client'

import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

/**
 * One responsive shell for every map selection — asset, zone, or device.
 * Bottom sheet on phones (thumb-reachable, above the tab bar), right sidebar on
 * desktop. Every map tap now opens the SAME thing, instead of a mix of tiny
 * anchored popups and a slide-up panel. This is the pattern Google/Apple Maps,
 * Uber, and Airbnb all converged on because it reads the same on any device.
 */
export function MapSheet({
  icon,
  title,
  subtitle,
  badge,
  onClose,
  children,
}: {
  icon?: ReactNode
  title: string
  subtitle?: ReactNode
  badge?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  // Mobile only, three drag stops (owner ask, Jul 16 — "a drag-down stop so I
  // can see more of the map with an asset selected"):
  //   0 mini (~24dvh: handle + title + status) · 1 peek (~42dvh) · 2 full.
  const [level, setLevel] = useState(1)
  const expanded = level === 2
  // Live drag: pull the handle down to step down/close, up to step up.
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    startY.current = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    // Only track downward pull live (feels like pull-to-dismiss); upward just
    // snaps a level up on release so the sheet never detaches from the bottom.
    setDragY(Math.max(-70, e.clientY - startY.current))
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const dy = dragY
    setDragY(0)
    if (Math.abs(dy) < 8) { setLevel((l) => (l === 2 ? 1 : l + 1)); return } // tap = step up (full → peek)
    if (dy < -40) { setLevel((l) => Math.min(2, l + 1)); return }            // pull up → step up
    if (dy > 220) { onClose(); return }                                      // hard pull → close from anywhere
    if (dy > 80) {
      if (level === 0) onClose()                                             // already mini → close
      else setLevel((l) => l - 1)                                            // step down one stop
    }
  }
  const MAX_H = ['24dvh', '42dvh', '85dvh'][level]

  const header = (showMobileClose = false) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-bold text-ink truncate">{title}</h2>
        </div>
        {subtitle && <div className="mt-1 text-xs text-faint">{subtitle}</div>}
        {badge && <div className="mt-1.5">{badge}</div>}
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className={(showMobileClose ? 'grid' : 'hidden md:grid') + ' place-items-center w-9 h-9 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink active:scale-95 flex-none'}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )

  return (
    <>
      {/* Mobile: half-sheet first — the MAP stays visible and interactive
          (isolate/highlight is pointless behind a full-screen panel). Drag the
          handle up to maximize, down to minimize or close; the X is always in
          the fixed header. Only the expanded state dims + closes on tap-away. */}
      {expanded && <div className="absolute inset-0 z-[70] bg-navy-950/45 md:hidden" onClick={onClose} />}
      <div className="absolute bottom-[54px] left-0 right-0 z-[71] md:hidden">
        <div
          className="bg-navy-900 rounded-t-2xl shadow-2xl mx-2 border border-navy-800 flex flex-col"
          style={{
            maxHeight: MAX_H,
            transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
            transition: dragging.current ? 'none' : 'transform .2s ease, max-height .2s ease',
          }}
        >
          {/* Fixed header — handle + title + close never scroll away. */}
          <div
            className="shrink-0 px-5 pt-1.5 touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="w-full grid place-items-center py-1 mb-1.5 text-faint">
              <span className="w-10 h-1.5 rounded-full bg-navy-600 mb-0.5" />
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </div>
            {header(true)}
          </div>
          <div className="overflow-y-auto px-5 pb-6 mt-3 flex-1 overscroll-contain">{children}</div>
        </div>
      </div>

      {/* Desktop: right sidebar panel (kiosk offsets via .map-sheet-desktop) */}
      <div className="map-sheet-desktop absolute top-0 right-0 bottom-0 z-20 hidden md:block w-72">
        <div className="bg-navy-900 h-full shadow-2xl border-l border-navy-800 flex flex-col">
          <div className="p-5 border-b border-navy-800">{header()}</div>
          <div className="p-5 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </>
  )
}

/** Small heat-colored bar chart (assets-moving / cost per interval) as real SVG.
 *  Mirrors lib/activity sparkBarsSVG but as a React node for the panels. */
export function SparkBars({ series, color = '#ff9e16', height = 34 }: { series: number[]; color?: string; height?: number }) {
  const max = Math.max(0, ...series)
  const n = series.length || 1
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <line x1="0" y1={height - 0.5} x2="100" y2={height - 0.5} stroke="#14506f" strokeWidth="0.5" />
      {max > 0 &&
        series.map((v, i) => {
          if (v <= 0) return null
          const h = Math.max(1.2, (v / max) * (height - 2))
          const w = 100 / n
          return <rect key={i} x={i * w + 0.3} y={height - h} width={Math.max(0.6, w - 0.5)} height={h} rx={0.4} fill={color} opacity={0.35 + 0.65 * (v / max)} />
        })}
    </svg>
  )
}
