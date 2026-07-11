'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Play, Pause, Gauge, Ban, Route, Flame, CalendarClock, SlidersHorizontal, HardHat, Video, X, Orbit, Map as MapIcon, Navigation, AreaChart, Link2, Check, ChevronUp, ChevronDown, History, Box } from 'lucide-react'
import { activityGradient, activityColor, deltas, bucketSpanLabel, areaPath, ACTIVITY_BUCKETS } from '@/lib/activity'

export type FollowMode = 'orbit' | 'overhead' | 'chase'
const CAMERA_MODES: { key: FollowMode; label: string; icon: typeof Orbit; note: string }[] = [
  { key: 'orbit', label: 'Orbit', icon: Orbit, note: 'Smoothly circles the asset' },
  { key: 'overhead', label: 'Overhead', icon: MapIcon, note: 'Top-down, follows along' },
  { key: 'chase', label: 'Chase', icon: Navigation, note: 'Rides behind, faces travel' },
]
import {
  type TimeRange, type TrailMode, type TrackWindow, RANGES, rangeLabel, scrubLabel,
  speedsForWindow, formatSpeed, customScrubLabel, customTickLabel, windowTickLabel,
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
  { key: '3d', label: '3D', icon: Box },
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
  /** False = viewer lacks the $-costs permission; hide the cost chip. */
  showCost?: boolean
  /** When tracks come from REAL history, the epoch window they span — labels
   *  then show true timestamps instead of the demo's 6AM-6PM pretend clock. */
  realWindow?: TrackWindow | null
  /** Per-bucket count of assets moving across the window (heat slider + chart). */
  activity?: number[]
  /** Cumulative $ curve across the window ($ chart mode). Null = unavailable. */
  costCurve?: number[] | null
  /** Real-world seconds the window spans (labels the $-per-interval unit). */
  windowSeconds?: number
  /** Cinematic camera-follow: the asset the camera is chasing (null = off). */
  followId: string | null
  onFollow: (id: string | null) => void
  /** Camera style while following. */
  followMode: FollowMode
  onFollowMode: (m: FollowMode) => void
  /** Assets with a trail in the current window, offered as follow targets. */
  followAssets: FollowAsset[]
  /** IANA timezone for clock/date labels (kiosk walls + shared replays render
   *  somewhere else — labels must still read in the crew's local time). */
  tz?: string
  /** Command Center wall display: starts minimized as a pill above the
   *  ticker; expandable/collapsible so the map stays the star. */
  kiosk?: boolean
}

export function TimelinePlayback({
  range, onRange, trailMode, onTrailMode, t, playing, speed, onSeek, onPlayPause, onSpeed,
  customFrom, customTo, onCustom, costTotal, costLabel, showCost = true, realWindow,
  activity = [], costCurve = null, windowSeconds = 12 * 3600,
  followId, onFollow, followMode, onFollowMode, followAssets, tz, kiosk = false,
}: TimelinePlaybackProps) {
  const live = range === 'live'
  const custom = range === 'custom'
  // Kiosk starts as a pill — the wall display leads with the map.
  const [minimized, setMinimized] = useState(kiosk)
  const [showCustom, setShowCustom] = useState(false)
  const [showFollow, setShowFollow] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [shared, setShared] = useState(false)

  // Shareable replay link: current range + scrub position (+ follow target),
  // so "watch this trip" is a text message, not a screen-share.
  const shareReplay = async () => {
    const p = new URLSearchParams({ range, t: t.toFixed(3) })
    if (followId) p.set('follow', followId)
    if (range === 'custom') { p.set('from', String(customFrom)); p.set('to', String(customTo)) }
    const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard blocked */ }
    setShared(true)
    setTimeout(() => setShared(false), 1800)
  }
  const [chartMode, setChartMode] = useState<'assets' | 'cost'>('assets')
  const rootRef = useRef<HTMLDivElement>(null)
  const followed = followAssets.find((a) => a.id === followId) ?? null

  // Close the follow menu on any tap/click outside the playback bar.
  useEffect(() => {
    if (!showFollow) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setShowFollow(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [showFollow])
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    custom ? customTickLabel(customFrom, customTo, f, tz)
    : realWindow ? windowTickLabel(realWindow, f, tz)
    : rangeLabel(range, f)
  )
  const speeds = speedsForWindow(windowSeconds)

  // ticking "updated Ns ago" while live (cycles to feel real-time)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setTick((t) => (t + 1) % 5), 1000)
    return () => clearInterval(id)
  }, [live])
  const ago = tick === 0 ? 'updated just now' : `updated ${tick}s ago`

  // ── Fleet activity: heat-mapped slider track + pull-up chart ──────────────
  const activityMax = useMemo(() => Math.max(0, ...activity), [activity])
  const heatGradient = useMemo(
    () => (activity.length ? activityGradient(activity, Math.max(1, activityMax)) : null),
    [activity, activityMax]
  )
  const costPer = useMemo(() => (costCurve ? deltas(costCurve) : null), [costCurve])
  const series = chartMode === 'cost' && costPer ? costPer : activity
  const seriesMax = Math.max(0, ...series)
  const spanLabel = bucketSpanLabel(windowSeconds, activity.length || ACTIVITY_BUCKETS)

  const chartRef = useRef<HTMLDivElement>(null)
  const seekFromPointer = useCallback((clientX: number) => {
    const el = chartRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
  }, [onSeek])

  // Chart geometry (viewBox space — stretches to fill, labels stay HTML)
  const CW = 960
  const CH = 110
  const linePath = seriesMax > 0 ? areaPath(series, seriesMax, CW, CH, 6) : ''
  const bucketIdx = Math.min(series.length - 1, Math.max(0, Math.floor(t * series.length)))
  const headY = seriesMax > 0 ? CH - 6 - (Math.min(series[bucketIdx] ?? 0, seriesMax) / seriesMax) * (CH - 12) : CH - 6

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[45] flex items-center gap-2 rounded-full bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-teal hover:text-ink transition-colors"
      >
        <History className="h-3.5 w-3.5" /> TIMELINE
        {!live && <span className="text-amber">{RANGES.find((r) => r.key === range)?.label ?? 'Replay'}</span>}
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    // Hug the bottom edge — the page already pads for the mobile tab bar, so
    // the old 80px offset left a dead strip of map under the controls. Kiosk
    // rides above the event ticker.
    <div ref={rootRef} className={'absolute left-3 right-3 md:left-4 md:right-4 ' + (kiosk ? 'bottom-12 z-[45]' : 'bottom-2 md:bottom-4 z-10')}>
      {/* Follow popover — sibling of the bar so it escapes the overflow-hidden clip
          (rendering it inside the rounded bar made it invisible on iPad). When not
          following it's the asset picker; while following it's the camera styles. */}
      {showFollow && !followed && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[240px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2">
          <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink flex items-center gap-1.5">
            <Video className="h-3.5 w-3.5 text-amber" /> Fly the camera with…
          </p>
          <div className="max-h-[220px] overflow-y-auto no-scrollbar">
            {followAssets.map((a) => (
              <button
                key={a.id}
                onClick={() => { onFollow(a.id); setShowFollow(false) }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-[13px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: a.color }} />
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
          <p className="px-2 pt-1.5 pb-0.5 text-[10px] text-faint leading-snug">
            Locks the camera onto the asset. Pick a camera style once it&rsquo;s following.
          </p>
        </div>
      )}
      {showFollow && followed && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[220px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2">
          <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink flex items-center gap-1.5 truncate">
            <Video className="h-3.5 w-3.5 text-amber" /> Camera · {followed.name}
          </p>
          {CAMERA_MODES.map(({ key, label, icon: Icon, note }) => (
            <button
              key={key}
              onClick={() => onFollowMode(key)}
              className={
                'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ' +
                (followMode === key ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-navy-900 hover:text-ink')
              }
            >
              <Icon className="h-4 w-4 flex-none" />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">{label}</span>
                <span className="block text-[10px] text-faint leading-tight">{note}</span>
              </span>
            </button>
          ))}
          <button
            onClick={() => { onFollow(null); setShowFollow(false) }}
            className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12px] font-semibold text-faint hover:text-alert hover:bg-alert/10 transition-colors border-t border-navy-800"
          >
            <X className="h-3.5 w-3.5" /> Stop following
          </button>
        </div>
      )}
      {/* Pull-up activity chart — rises out of the timeline; tap/drag = seek */}
      {showChart && !live && (
        <div className="mb-2 rounded-2xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
          <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
            <AreaChart className="h-3.5 w-3.5 text-teal flex-none" />
            <span className="font-display font-bold text-[12px] text-ink flex-1 truncate">
              {chartMode === 'cost' ? `Cost per ${spanLabel}` : 'Assets moving'}
            </span>
            {costPer && (
              <div className="flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800">
                <button
                  onClick={() => setChartMode('assets')}
                  className={'px-2 py-0.5 rounded-md text-[10.5px] font-semibold transition-colors ' + (chartMode === 'assets' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')}
                >Moving</button>
                <button
                  onClick={() => setChartMode('cost')}
                  className={'px-2 py-0.5 rounded-md text-[10.5px] font-semibold transition-colors ' + (chartMode === 'cost' ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}
                >$ / {spanLabel}</button>
              </div>
            )}
            <button onClick={() => setShowChart(false)} className="grid place-items-center w-6 h-6 rounded-md text-faint hover:text-ink flex-none" aria-label="Close chart">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            ref={chartRef}
            className="relative h-[110px] mx-3 mb-2 touch-none cursor-crosshair select-none"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e.clientX) }}
            onPointerMove={(e) => { if (e.buttons) seekFromPointer(e.clientX) }}
          >
            {seriesMax > 0 ? (
              <>
                <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                  <defs>
                    <linearGradient id="ht-heat-line" x1="0" y1="0" x2="1" y2="0">
                      {series.map((v, i) => (
                        <stop key={i} offset={`${((i + 0.5) / series.length) * 100}%`} stopColor={activityColor(chartMode === 'cost' ? (v > 0 ? 1 + (v / seriesMax) * (Math.max(1, activityMax) - 1) : 0) : v, Math.max(1, activityMax))} />
                      ))}
                    </linearGradient>
                    <linearGradient id="ht-heat-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff9e16" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line key={f} x1="0" x2={CW} y1={CH * f} y2={CH * f} stroke="#14364f" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  <path d={`${linePath} L ${CW} ${CH} L 0 ${CH} Z`} fill="url(#ht-heat-fill)" stroke="none" />
                  <path d={linePath} fill="none" stroke="url(#ht-heat-line)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  {/* playhead */}
                  <line x1={t * CW} x2={t * CW} y1="0" y2={CH} stroke="#e8f0f7" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity="0.7" />
                  <circle cx={t * CW} cy={headY} r="4.5" fill="#e8f0f7" stroke="#ff9e16" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="absolute top-1 left-1.5 font-mono text-[9.5px] text-faint bg-navy-950/70 rounded px-1">
                  peak {chartMode === 'cost' ? money(seriesMax) : `${seriesMax} moving`}
                </span>
                <span className="absolute bottom-0.5 right-1.5 font-mono text-[9.5px] text-amber bg-navy-950/70 rounded px-1 tabular-nums">
                  {chartMode === 'cost'
                    ? `${money(series[bucketIdx] ?? 0)} this ${spanLabel}`
                    : `${series[bucketIdx] ?? 0} moving now`}
                </span>
              </>
            ) : (
              <p className="absolute inset-0 grid place-items-center text-[12px] text-faint">
                No movement recorded in this window.
              </p>
            )}
          </div>
        </div>
      )}
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
      {/* range pills + movement-display control. On phones the pills get their
          own full-width scrollable row — sharing one row squeezed them into a
          useless 10px sliver next to all the flex-none controls. */}
      <div className={'flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pt-2 ' + (live ? 'pb-2' : 'pb-1.5 border-b border-navy-800')}>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto sm:flex-1 min-w-0">
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
          {/* Live status rides the same row — its own row wasted a strip of map */}
          {live && (
            <span className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap flex-none pl-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-teal shadow-glow-teal animate-blink flex-none" />
              <span className="text-teal">{ago}</span>
              <span className="text-faint truncate">· {trailMode === 'off' ? 'pick a range to replay, or turn on Trails' : 'showing all of today'}</span>
            </span>
          )}
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
        {/* Live project cost — permission-gated ($ hidden for e.g. foremen) */}
        {showCost && (
          <div className="flex-none flex items-center gap-1 font-mono text-[11px] text-amber whitespace-nowrap" title={`Project cost · ${costLabel}`}>
            <HardHat className="h-3.5 w-3.5" />
            {money(costTotal)}
            <span className="hidden md:inline text-faint">· {costLabel}</span>
          </div>
        )}
        {/* Pull-up activity chart toggle (replay modes only) */}
        {!live && (
          <button
            onClick={() => setShowChart((s) => !s)}
            title="Activity chart"
            className={
              'flex-none grid place-items-center w-7 h-7 rounded-lg border transition-colors ' +
              (showChart ? 'bg-teal/20 text-teal border-teal/40' : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            <AreaChart className="h-3.5 w-3.5" />
          </button>
        )}
        {!live && (
          <button
            onClick={shareReplay}
            title="Copy replay link"
            className={
              'flex-none grid place-items-center w-7 h-7 rounded-lg border transition-colors ' +
              (shared ? 'bg-teal/20 text-teal border-teal/40' : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            {shared ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          </button>
        )}
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

        {/* Cinematic camera-follow (menu itself renders above the bar — see top) */}
        {followAssets.length > 0 && (
          <button
            onClick={() => setShowFollow((s) => !s)}
            title={followed ? `Following ${followed.name} — camera settings` : 'Cinematic follow'}
            className={
              'flex-none flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ' +
              (followed
                ? 'bg-amber/20 text-amber border-amber/40'
                : showFollow
                  ? 'bg-navy-800 text-ink border-navy-700'
                  : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            <Video className="h-3.5 w-3.5" />
            <span className="hidden sm:inline max-w-[90px] truncate">
              {followed ? CAMERA_MODES.find((m) => m.key === followMode)?.label ?? 'Following' : 'Follow'}
            </span>
          </button>
        )}
        {kiosk && (
          <button
            onClick={() => setMinimized(true)}
            title="Minimize timeline"
            className="flex-none grid place-items-center w-7 h-7 rounded-lg border bg-navy-900 text-faint border-navy-800 hover:text-ink transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {live ? (
        /* phones only — desktop shows the status inline in the pill row */
        <div className="sm:hidden flex items-center gap-2 px-4 pb-2 min-w-0 flex-nowrap overflow-hidden">
          <span className="w-2 h-2 rounded-full bg-teal shadow-glow-teal animate-blink flex-none" />
          <span className="font-mono text-[12px] text-teal whitespace-nowrap flex-none">Live · {ago}</span>
          <span className="font-mono text-[12px] text-faint truncate whitespace-nowrap min-w-0">
            · {trailMode === 'off' ? 'replay or turn on Trails' : 'showing all of today'}
          </span>
        </div>
      ) : (
        <>
        {/* date/time readout — tight against the slider row */}
        <div className="px-4 pt-1.5 -mb-0.5 flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-amber flex-none" />
          <span className="font-display font-bold text-amber text-[13px] tabular-nums">
            {custom ? customScrubLabel(customFrom, customTo, t, tz)
              : realWindow ? customScrubLabel(realWindow.from, realWindow.to, t, tz)
              : scrubLabel(range, t)}
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 pt-1 pb-2">
          <button
            onClick={onPlayPause}
            className="flex-none grid place-items-center w-9 h-9 rounded-full bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          <div className="flex-1 min-w-0">
            {/* Heat-mapped track: color = # assets moving at that moment
                (blue = nobody moving, teal→amber→red = busier). */}
            <div className="relative h-[17px] flex items-center">
              <div
                className="absolute inset-x-0 h-[9px] top-1/2 -translate-y-1/2 rounded-full border border-navy-700/60"
                style={{ background: heatGradient ?? 'rgba(20,80,111,0.5)' }}
              />
              <input
                type="range" min={0} max={1000} value={Math.round(t * 1000)}
                onChange={(e) => onSeek(Number(e.target.value) / 1000)}
                className="slider-heat relative w-full h-[17px] cursor-pointer"
                aria-label="Timeline position"
              />
            </div>
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
