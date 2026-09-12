'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Fix } from '@/lib/aircraft-log'

/**
 * The three profile charts for one flight (Brian, Sep 12: "altitude and
 * ground speed and vertical speed charts as an option when a plane or flight
 * from flight log is clicked").
 *
 * Form notes (dataviz):
 *  • THREE charts, never one with three y-scales. Altitude in feet, speed in
 *    knots and climb rate in feet-per-minute share nothing but time, and a
 *    dual axis is the one thing that method rules out outright. They are
 *    small multiples on a shared x, with ONE crosshair and ONE tooltip
 *    reading all three at the same instant — which is the actual question
 *    ("what was it doing here?").
 *  • Altitude and ground speed are single series, so they carry no legend —
 *    the chart title names them — and they keep the brand hues the map
 *    already uses for the same quantities, so the popup and the chart agree.
 *  • Vertical speed is DIVERGING around zero: climbing and descending are
 *    opposite states, not more-and-less of one. Two hues with a neutral gray
 *    midpoint, and the pair is validated on this navy surface (OKLCH band,
 *    chroma, CVD ΔE 12.5, normal-vision 24.3, contrast — all pass).
 *  • Identity never rides colour alone: each chart is titled, the climb and
 *    descent halves are labelled at the zero line, and the readout names
 *    every value in words.
 */

const ALT = '#ff9e16'      // brand amber — the altitude colour on the map popup
const GS = '#2dd4bf'       // brand teal
const CLIMB = '#0d9488'    // validated diverging pair, dark surface
const DESCEND = '#d97706'
const GRID = 'rgba(159,182,204,0.14)'
const AXIS_TEXT = '#6f88a0'

type Metric = 'alt' | 'gs' | 'vs'

interface Series {
  key: Metric
  title: string
  unit: string
  color: string
  values: (number | null)[]
  /** Diverging series get the zero rule and the two-hue fill. */
  diverging?: boolean
}

const H = 132
const PAD_L = 48
const PAD_R = 10
const PAD_T = 12
const PAD_B = 18
const PLOT_H = H - PAD_T - PAD_B
/** Below this the labels start colliding, so the chart scrolls instead. */
const MIN_W = 300

const nf = (n: number) => Math.round(n).toLocaleString()

/** Elapsed-time label: 0:00, 1:23 … */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`
}

/**
 * A "nice" axis maximum: round enough to label, close enough not to waste the
 * plot. The coarse [1,2,2.5,5,10] ladder put a 28,100 ft flight on a 50,000 ft
 * axis and squashed it into the bottom half.
 */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => v <= s * mag) ?? 10
  return step * mag
}

export function FlightProfile({ track }: { track: Fix[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  /**
   * The SVG is drawn at the container's REAL pixel width rather than a fixed
   * viewBox scaled to fit. A 720-wide viewBox letterboxed inside a 340px
   * phone card left a third of every chart as empty band above and below the
   * trace, and stretching it instead (preserveAspectRatio="none") would have
   * distorted the axis text.
   */
  const [w, setW] = useState(720)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(MIN_W, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const plotW = w - PAD_L - PAD_R

  const { pts, series, t0, span } = useMemo(() => {
    const pts = track.filter((f) => Number.isFinite(f.t))
    const t0 = pts.length ? pts[0].t : 0
    const span = Math.max(1, (pts.length ? pts[pts.length - 1].t : 0) - t0)
    const series: Series[] = [
      { key: 'alt', title: 'Altitude', unit: 'ft', color: ALT, values: pts.map((f) => f.altFt) },
      { key: 'gs', title: 'Ground speed', unit: 'kt', color: GS, values: pts.map((f) => f.gsKt) },
      { key: 'vs', title: 'Vertical speed', unit: 'fpm', color: CLIMB, values: pts.map((f) => f.vsFpm), diverging: true },
    ]
    return { pts, series, t0, span }
  }, [track])

  if (pts.length < 2) {
    return (
      <p className="rounded-xl border border-navy-800 bg-navy-900 p-4 text-sm text-faint">
        This flight has too few position reports to chart. Coverage gaps happen where no
        ADS-B receiver could hear the aircraft — usually low, remote, or over water.
      </p>
    )
  }

  const x = (i: number) => PAD_L + ((pts[i].t - t0) / span) * plotW

  /**
   * One pointer handler for all three charts: the crosshair is shared, so
   * moving across any of them reads the same instant on every one.
   *
   * Measured off the SVG the pointer is actually over, NOT the wrapper. The
   * wrapper is wider than the plot by the card padding plus the y-axis
   * gutter, so mapping against it put the crosshair ~45 px right of the
   * finger at the left edge and named a time the user was not pointing at
   * (ship-check, Sep 12).
   */
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const svg = (e.target as Element).closest('figure')?.querySelector('svg')
      ?? wrapRef.current?.querySelector('svg')
    const box = svg?.getBoundingClientRect()
    if (!box || !box.width) return
    // Wrapper px → viewBox units → fraction of the plot area.
    const vbX = ((e.clientX - box.left) / box.width) * w
    const frac = Math.max(0, Math.min(1, (vbX - PAD_L) / plotW))
    const want = t0 + frac * span
    let best = 0
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].t - want) < Math.abs(pts[best].t - want)) best = i
    }
    setHoverIdx(best)
  }

  const hov = hoverIdx != null ? pts[hoverIdx] : null

  return (
    <div className="space-y-2">
      {/* Readout — the shared tooltip. Fixed above the charts rather than
          floating over them: on a phone a finger covers a floating box. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 text-[12px]">
        <span className="font-mono text-[11px] text-faint">
          {hov ? new Date(hov.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'hover the charts'}
        </span>
        <span className="text-muted">
          altitude <b style={{ color: ALT }}>{hov?.altFt != null ? `${nf(hov.altFt)} ft` : '—'}</b>
        </span>
        <span className="text-muted">
          ground speed <b style={{ color: GS }}>{hov?.gsKt != null ? `${nf(hov.gsKt)} kt` : '—'}</b>
        </span>
        <span className="text-muted">
          vertical <b style={{ color: (hov?.vsFpm ?? 0) < 0 ? DESCEND : CLIMB }}>
            {hov?.vsFpm != null ? `${hov.vsFpm > 0 ? '+' : ''}${nf(hov.vsFpm)} fpm` : '—'}
          </b>
        </span>
      </div>

      {/* pointerdown so a TAP reads the chart on a phone (pointermove alone
          never fires), pointercancel so scrolling away clears the crosshair
          instead of freezing it — pointerleave does not fire on touch. */}
      <div
        ref={wrapRef}
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerUp={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
        onPointerLeave={() => setHoverIdx(null)}
        className="space-y-2"
      >
        {series.map((s) => (
          <Chart key={s.key} s={s} pts={pts} x={x} hoverIdx={hoverIdx} span={span} w={w} plotW={plotW} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] text-faint">
          Tracks from the ADS-B receiver network — gaps are where nobody could hear it.
        </p>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="flex-none rounded-lg border border-navy-700 bg-navy-950 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink"
        >
          {showTable ? 'Hide numbers' : 'Show numbers'}
        </button>
      </div>

      {/* The table view: the same data without needing to read a colour or
          hover anything. */}
      {showTable && (
        <div className="max-h-64 overflow-auto rounded-lg border border-navy-800">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-navy-900 text-faint">
              <tr>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Time</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Altitude (ft)</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Ground speed (kt)</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Vertical (fpm)</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {pts.filter((_, i) => i % Math.ceil(pts.length / 120) === 0).map((f, i) => (
                <tr key={`${f.t}-${i}`} className="border-t border-navy-800/60">
                  <td className="px-2.5 py-1 font-mono">{new Date(f.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-2.5 py-1">{f.altFt != null ? nf(f.altFt) : '—'}</td>
                  <td className="px-2.5 py-1">{f.gsKt != null ? nf(f.gsKt) : '—'}</td>
                  <td className="px-2.5 py-1">{f.vsFpm != null ? `${f.vsFpm > 0 ? '+' : ''}${nf(f.vsFpm)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Chart({
  s, pts, x, hoverIdx, span, w, plotW,
}: {
  s: Series
  pts: Fix[]
  x: (i: number) => number
  hoverIdx: number | null
  span: number
  w: number
  plotW: number
}) {
  const vals = s.values
  const present = vals.filter((v): v is number => v != null)
  const lo = present.length ? Math.min(...present) : 0
  const hi = present.length ? Math.max(...present) : 1

  // Diverging series are symmetric about zero, so a 500 fpm climb and a 500
  // fpm descent are the same distance from the middle.
  const top = s.diverging ? niceMax(Math.max(Math.abs(lo), Math.abs(hi), 100)) : niceMax(Math.max(hi, 1))
  const bottom = s.diverging ? -top : 0
  const y = (v: number) => PAD_T + PLOT_H - ((v - bottom) / (top - bottom)) * PLOT_H
  const zeroY = y(0)

  // Break the line wherever the feed lost the aircraft rather than drawing a
  // straight line through a hole it never flew.
  // Each segment remembers its OWN extent. Closing every fill to the whole
  // chart's width painted a translucent wedge straight across the coverage
  // gaps the line deliberately breaks at (ship-check, Sep 12).
  const segments: { d: string; from: number; to: number }[] = []
  let cur: string[] = []
  let curFrom = 0
  let curTo = 0
  const flush = () => {
    if (cur.length > 1) segments.push({ d: cur.join(' '), from: curFrom, to: curTo })
    cur = []
  }
  vals.forEach((v, i) => {
    const gap = i > 0 && pts[i].t - pts[i - 1].t > 300
    if (v == null || gap) {
      flush()
      if (v == null) return
    }
    if (!cur.length) curFrom = i
    curTo = i
    cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  })
  flush()

  const ticks = s.diverging ? [bottom, 0, top] : [0, top / 2, top]
  const timeTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, sec: f * span }))

  return (
    <figure className="m-0 rounded-xl border border-navy-800 bg-navy-900 p-2">
      <figcaption className="mb-0.5 flex items-baseline gap-2 px-1">
        <span className="text-[12px] font-semibold text-ink">{s.title}</span>
        <span className="text-[10.5px] text-faint">{s.unit}</span>
        {s.diverging && (
          <span className="ml-auto flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 text-muted">
              <i className="inline-block h-2 w-2 rounded-sm" style={{ background: CLIMB }} /> climbing
            </span>
            <span className="flex items-center gap-1 text-muted">
              <i className="inline-block h-2 w-2 rounded-sm" style={{ background: DESCEND }} /> descending
            </span>
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} role="img"
        aria-label={`${s.title} over the flight, in ${s.unit}`}>
        {/* Recessive grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={9.5} fill={AXIS_TEXT} fontFamily="ui-monospace,monospace">
              {nf(t)}
            </text>
          </g>
        ))}
        {timeTicks.map(({ f, sec }) => (
          <text key={f} x={PAD_L + f * plotW} y={H - 5} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            fontSize={9.5} fill={AXIS_TEXT} fontFamily="ui-monospace,monospace">
            {clock(sec)}
          </text>
        ))}

        {/* Diverging fill: the area between the trace and zero, coloured by
            which side of zero it is on. */}
        {s.diverging ? (
          <>
            <defs>
              <clipPath id={`up-${s.key}`}><rect x={PAD_L} y={PAD_T} width={plotW} height={Math.max(0, zeroY - PAD_T)} /></clipPath>
              <clipPath id={`dn-${s.key}`}><rect x={PAD_L} y={zeroY} width={plotW} height={Math.max(0, PAD_T + PLOT_H - zeroY)} /></clipPath>
            </defs>
            {segments.map(({ d, from, to }, i) => {
              const area = `${d} L${x(to)},${zeroY} L${x(from)},${zeroY} Z`
              return (
                <g key={i}>
                  <path d={area} fill={CLIMB} opacity={0.22} clipPath={`url(#up-${s.key})`} />
                  <path d={area} fill={DESCEND} opacity={0.22} clipPath={`url(#dn-${s.key})`} />
                  <path d={d} fill="none" stroke={CLIMB} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#up-${s.key})`} />
                  <path d={d} fill="none" stroke={DESCEND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#dn-${s.key})`} />
                </g>
              )
            })}
            {/* The neutral midpoint — level flight. */}
            <line x1={PAD_L} x2={w - PAD_R} y1={zeroY} y2={zeroY} stroke={AXIS_TEXT} strokeWidth={1} strokeDasharray="3 3" />
          </>
        ) : (
          segments.map(({ d, from, to }, i) => (
            <g key={i}>
              <path d={`${d} L${x(to)},${PAD_T + PLOT_H} L${x(from)},${PAD_T + PLOT_H} Z`} fill={s.color} opacity={0.13} />
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))
        )}

        {/* Crosshair */}
        {hoverIdx != null && vals[hoverIdx] != null && (
          <g pointerEvents="none">
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="#e8f0f7" strokeOpacity={0.35} strokeWidth={1} />
            {/* 2px surface ring so the dot reads against the fill under it */}
            <circle cx={x(hoverIdx)} cy={y(vals[hoverIdx] as number)} r={4.5}
              fill={s.diverging ? ((vals[hoverIdx] as number) < 0 ? DESCEND : CLIMB) : s.color}
              stroke="#00203a" strokeWidth={2} />
          </g>
        )}
      </svg>
    </figure>
  )
}
