'use client'

import { useState, type ReactNode } from 'react'
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
  // Mobile only: peek (map visible + interactive) vs expanded (full detail).
  const [expanded, setExpanded] = useState(false)
  const header = (
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
        className="grid place-items-center w-9 h-9 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink active:scale-95 flex-none"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )

  return (
    <>
      {/* Mobile: half-sheet first — the MAP stays visible and interactive
          (isolate/highlight is pointless behind a full-screen panel). The
          handle/chevron expands to nearly full; collapse drops it back. Only
          the expanded state dims the map and closes on tap-away. */}
      {expanded && <div className="absolute inset-0 z-[70] bg-navy-950/45 md:hidden" onClick={onClose} />}
      <div className="absolute bottom-[70px] left-0 right-0 z-[71] md:hidden">
        <div className={'bg-navy-900 rounded-t-2xl shadow-2xl px-5 pt-1.5 pb-6 mx-2 border border-navy-800 overflow-y-auto transition-[max-height] duration-200 ' + (expanded ? 'max-h-[85dvh]' : 'max-h-[40dvh]')}>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
            className="w-full grid place-items-center py-1 mb-1.5 text-faint active:text-ink"
          >
            <span className="w-9 h-1 rounded-full bg-navy-700 mb-0.5" />
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          {header}
          <div className="mt-4">{children}</div>
        </div>
      </div>

      {/* Desktop: right sidebar panel (kiosk offsets via .map-sheet-desktop) */}
      <div className="map-sheet-desktop absolute top-0 right-0 bottom-0 z-20 hidden md:block w-72">
        <div className="bg-navy-900 h-full shadow-2xl border-l border-navy-800 flex flex-col">
          <div className="p-5 border-b border-navy-800">{header}</div>
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
