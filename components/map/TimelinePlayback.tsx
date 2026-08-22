'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ProtrudingClose } from '@/components/ui/window-chrome'
import { SpeedControl } from '@/components/ui/speed-control'
import { Play, Pause, Ban, Route, Flame, CalendarClock, SlidersHorizontal, HardHat, Video, X, Orbit, Map as MapIcon, Navigation, Navigation2, Circle, AreaChart, Link2, Check, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, History, Box, Hexagon, Search, RotateCw, Plane, Gauge } from 'lucide-react'
import { activityGradient, activityColor, deltas, bucketSpanLabel, areaPath, ACTIVITY_BUCKETS } from '@/lib/activity'

export type FollowMode = 'orbit' | 'overhead' | 'chase'
const CAMERA_MODES: { key: FollowMode; label: string; icon: typeof Orbit; note: string }[] = [
  { key: 'orbit', label: 'Orbit', icon: Orbit, note: 'Smoothly circles the asset' },
  { key: 'overhead', label: 'Overhead', icon: MapIcon, note: 'Top-down, follows along' },
  { key: 'chase', label: 'Chase', icon: Navigation, note: 'Rides behind, faces travel' },
]
import {
  type TimeRange, type TrailMode, type TrackWindow, RANGES, rangeLabel, scrubLabel,
  speedsForWindow, customScrubLabel, customTickLabel, windowTickLabel,
} from '@/lib/trails'
import type { AssetType } from '@/lib/types'
import { money } from '@/lib/projects'

export interface FollowAsset { id: string; name: string; type: AssetType; color: string }

// epoch ms <-> <input type="date"> value. Whole days only — From snaps to
// 12:00:00 AM, To snaps to 11:59:59 PM, so "Jul 3 to Jul 5" means all three
// days without anyone fighting an hour picker on a phone.
function toDateInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayStartMs(v: string): number {
  return new Date(`${v}T00:00:00`).getTime()
}
function dayEndMs(v: string): number {
  return new Date(`${v}T23:59:59.999`).getTime()
}

// Remembered bottom-sheet stage (UX audit, Aug 22): reopening the map lands
// on whatever stage you last chose instead of always unfolding to 'full'.
const STAGE_KEY = 'ht_timeline_stage'
const KIOSK_STAGE_KEY = 'ht_cc_timeline_stage'
const STAGES = ['full', 'bar', 'min'] as const
type Stage = (typeof STAGES)[number]

// `short` = the phone label — full words on sm+ (labels stay, Brian Aug 22;
// they just tighten so the one-line strip fits a 400px screen, Aug 23).
const MODES: { key: TrailMode; label: string; short: string; icon: typeof Ban }[] = [
  { key: 'off', label: 'Off', short: 'Off', icon: Ban },
  { key: 'trails', label: 'Trails', short: 'Trails', icon: Route },
  { key: 'heatmap', label: 'Heatmap', short: 'Heat', icon: Flame },
  // '3d' is the hex activity terrain — towers of movement, i.e. a heatmap
  // with height. Named accordingly ("3D" read like a camera mode, Jul 21).
  { key: '3d', label: '3D heat', short: '3D', icon: Box },
]

interface TimelinePlaybackProps {
  range: TimeRange
  onRange: (r: TimeRange) => void
  /** True while the selected window's full-resolution history is still
   *  downloading — draws a thin sweep bar above the scrubber. */
  loading?: boolean
  trailMode: TrailMode
  onTrailMode: (m: TrailMode) => void
  /** Live marker style: clean colored dots (default) or direction arrows —
   *  ground-aligned pucks in asset color with the type emoji on top. */
  markerStyle?: 'dot' | 'arrow'
  onMarkerStyle?: (s: 'dot' | 'arrow') => void
  /** Speed-colored trails (Brian, Aug 23): trail ink shows how fast — teal
   *  crawl · amber streets · orange highway · red 70+ — instead of the
   *  per-asset color with age fading. */
  speedTrails?: boolean
  onSpeedTrails?: () => void
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
  /** Zones offered as follow targets — the camera circles the site itself.
   *  Ids arrive prefixed "zone:" so one followId field serves both kinds. */
  followZones?: { id: string; name: string; color: string }[]
  /** "360" — slow continuous rotation of the current view (disabled while following). */
  spinning?: boolean
  onSpin?: () => void
  /** Flyover — the slow-plane tour over every asset; speed = 0.5 | 1 | 2. */
  flying?: boolean
  onFlyover?: () => void
  flySpeed?: number
  onFlySpeed?: (v: number) => void
  /** Alerts inside the current window, as fractions — red ticks on the
   *  scrubber; tap one to jump the replay to that moment. */
  alertMarks?: { t: number; label: string }[]
  /** IANA timezone for clock/date labels (kiosk walls + shared replays render
   *  somewhere else — labels must still read in the crew's local time). */
  tz?: string
  /** Speed/time/miles readout for the followed or selected asset — docked in
   *  this bar (live: current fix + miles today; replay: values at the scrub
   *  position) so it never floats over the map. */
  hud?: { name: string; mph: number | null; clock: string; milesIn: number } | null
  /** Command Center wall display: starts minimized as a pill above the
   *  ticker; expandable/collapsible so the map stays the star. */
  kiosk?: boolean
}

export function TimelinePlayback({
  range, onRange, loading = false, trailMode, onTrailMode, markerStyle = 'dot', onMarkerStyle, speedTrails = false, onSpeedTrails, t, playing, speed, onSeek, onPlayPause, onSpeed,
  customFrom, customTo, onCustom, costTotal, costLabel, showCost = true, realWindow,
  activity = [], costCurve = null, windowSeconds = 12 * 3600,
  followId, onFollow, followMode, onFollowMode, followAssets, followZones = [],
  spinning = false, onSpin, flying = false, onFlyover, flySpeed = 1, onFlySpeed,
  alertMarks = [], tz, kiosk = false, hud = null,
}: TimelinePlaybackProps) {
  const live = range === 'live'
  const custom = range === 'custom'
  // Three-stage bottom sheet (Brian, Aug 10): 'full' = ranges + options +
  // scrubber · 'bar' = the timeline alone · 'min' = the pill. Drag the
  // handle down to step full → bar → min, up to climb back. The X stays for
  // non-tech users and jumps straight to the pill. Kiosk starts as a pill —
  // the wall display leads with the map. Otherwise the last choice is
  // remembered per device; phones with nothing stored start at 'bar' —
  // 'full' ate half a 400px screen before anyone touched it (Aug 22).
  const [stage, setStageRaw] = useState<Stage>(() => {
    // Kiosk remembers its own stage under a separate key (Brian, Aug 22:
    // /command matches /map) — fresh walls still lead with the map (pill).
    try {
      const saved = localStorage.getItem(kiosk ? KIOSK_STAGE_KEY : STAGE_KEY)
      if ((STAGES as readonly string[]).includes(saved ?? '')) return saved as Stage
    } catch { /* private mode / SSR */ }
    if (kiosk) return 'min'
    try { if (window.matchMedia('(max-width: 767px)').matches) return 'bar' } catch { /* SSR */ }
    return 'full'
  })
  const stageRef = useRef(stage)
  stageRef.current = stage
  // True while WE stepped full → bar for an opening selection sheet — only
  // then does the sheet closing restore 'full' (see the ht:sheet-open effect).
  const autoStepRef = useRef(false)
  // Every EXPLICIT stage change routes through here: it persists the choice
  // and cancels any pending auto-restore (a user's manual change wins).
  const setStage = useCallback((next: Stage | ((s: Stage) => Stage)) => {
    autoStepRef.current = false
    setStageRaw((s) => {
      const v = typeof next === 'function' ? next(s) : next
      // Separate keys: the wall's choice never decides what /map opens to.
      try { localStorage.setItem(kiosk ? KIOSK_STAGE_KEY : STAGE_KEY, v) } catch { /* private mode */ }
      return v
    })
  }, [kiosk])
  // A selection sheet opening asks the timeline to get out of the way
  // (MapView dispatches 'ht:sheet-open'): step full → bar so the sheet and
  // the option rows don't stack; closing it climbs back up — but only if the
  // auto-step did the folding, never over a choice the user made meanwhile.
  useEffect(() => {
    if (kiosk) return
    const onSheet = (e: Event) => {
      // Phones only (ship-check P2): the desktop sheet is a side panel that
      // never overlaps the bar — folding there just closed the cost chart
      // every time the user clicked a marker to identify it.
      if (!window.matchMedia('(max-width: 767px)').matches) return
      const open = !!(e as CustomEvent<{ open?: boolean }>).detail?.open
      if (open) {
        if (stageRef.current === 'full') {
          autoStepRef.current = true
          setShowChart(false); setShowFollow(false); setShowCustom(false)
          setStageRaw('bar')
        }
      } else if (autoStepRef.current) {
        autoStepRef.current = false
        setStageRaw((s) => (s === 'bar' ? 'full' : s))
      }
    }
    window.addEventListener('ht:sheet-open', onSheet as EventListener)
    return () => window.removeEventListener('ht:sheet-open', onSheet as EventListener)
  }, [kiosk])
  const minimized = stage === 'min'
  // Range-pill overflow cue: fade the right edge while pills hide off-screen.
  const pillsRef = useRef<HTMLDivElement>(null)
  const [pillsMore, setPillsMore] = useState(false)
  // Same cue for the phone control strip (chart/share/modes/camera) — a
  // clipped "3D heat" has to read as scrollable, not broken.
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripMore, setStripMore] = useState(false)
  const measurePills = useCallback(() => {
    const el = pillsRef.current
    if (el) setPillsMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
    const st = stripRef.current
    if (st) setStripMore(st.scrollWidth - st.clientWidth - st.scrollLeft > 8)
  }, [])
  useEffect(() => {
    measurePills()
    window.addEventListener('resize', measurePills)
    return () => window.removeEventListener('resize', measurePills)
  }, [measurePills, stage, live, range, trailMode])
  const dragRef = useRef<{ x: number; y: number; done: boolean } | null>(null)
  // A stage-step just happened via swipe — the very next click (the tail of
  // that same gesture, often on a button) gets swallowed.
  const swipeStepped = useRef(false)
  const [showCustom, setShowCustom] = useState(false)
  const [showFollow, setShowFollow] = useState(false)
  // One Camera button folds 360/Fly/Follow (8c-c) — this is its popover.
  const [showCam, setShowCam] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [shared, setShared] = useState(false)
  const [chartMode, setChartMode] = useState<'assets' | 'cost'>('assets')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const followed = followAssets.find((a) => a.id === followId)
    ?? followZones.find((z) => z.id === followId)
    ?? null
  const followedIsZone = !!followId?.startsWith('zone:')
  // Quick filter for big fleets — type a few letters, list narrows live.
  const [followQ, setFollowQ] = useState('')
  const q = followQ.trim().toLowerCase()
  const pickAssets = q ? followAssets.filter((a) => a.name.toLowerCase().includes(q)) : followAssets
  const pickZones = q ? followZones.filter((z) => z.name.toLowerCase().includes(q)) : followZones

  // Share replay. Following ONE asset → mint a PUBLIC link (no login, dies in
  // 7 days) so "watch this trip" can go to anyone by text. Any other view
  // copies the private link (teammates sign in and land on the same replay).
  const shareReplay = async () => {
    let url: string | null = null
    if (followed && !followedIsZone && !live && realWindow) {
      try {
        const r = await fetch('/api/share/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId: followed.id, fromMs: Math.round(realWindow.from), toMs: Math.round(realWindow.to), t }),
        })
        if (r.ok) url = ((await r.json()) as { url?: string }).url ?? null
      } catch { /* demo mode or offline — fall through to the private link */ }
    }
    if (!url) {
      const p = new URLSearchParams({ range, t: t.toFixed(3) })
      if (followId) p.set('follow', followId)
      if (range === 'custom') { p.set('from', String(customFrom)); p.set('to', String(customTo)) }
      url = `${window.location.origin}${window.location.pathname}?${p.toString()}`
    }
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard blocked */ }
    setShared(true)
    setTimeout(() => setShared(false), 1800)
  }

  // Close the follow + camera menus on any tap/click outside the playback bar.
  useEffect(() => {
    if (!showFollow && !showCam) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) { setShowFollow(false); setShowCam(false) }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [showFollow, showCam])
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

  // Lift the phone selection sheet clear of this bar (owner ask, Jul 23 —
  // "can not operate timeline slider with an asset selected on phone"):
  // publish how far the bar rises above the 54px gap the sheet already
  // leaves. 0 while collapsed to the pill; kiosk has its own layout.
  const measureRef = useRef<HTMLElement | null>(null)
  const publishLift = useCallback(() => {
    if (kiosk || typeof document === 'undefined') return
    const h = measureRef.current?.getBoundingClientRect().height ?? 0
    document.documentElement.style.setProperty('--ht-sheet-lift', `${Math.max(0, Math.ceil(h) + 8 - 54)}px`)
    // Stage broadcast: with just the pill showing, the scale bar + (i) drop
    // to the true bottom corners (Brian, Aug 22) — CSS keys off this.
    document.documentElement.setAttribute('data-ht-tl', stageRef.current)
  }, [kiosk])
  const attachMeasure = useCallback((el: HTMLElement | null) => { measureRef.current = el; publishLift() }, [publishLift])
  useEffect(() => {
    if (kiosk || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publishLift)
    if (measureRef.current) ro.observe(measureRef.current)
    return () => {
      ro.disconnect()
      document.documentElement.style.setProperty('--ht-sheet-lift', '0px')
      document.documentElement.removeAttribute('data-ht-tl')
    }
  }, [kiosk, stage, publishLift])

  // One stage per gesture; leaving 'full' folds any open popovers with it.
  const stepDown = useCallback(() => {
    setStage((s) => {
      if (s === 'full') { setShowChart(false); setShowFollow(false); setShowCustom(false); return 'bar' }
      return 'min'
    })
  }, [setStage])
  const stepUp = useCallback(() => setStage((s) => (s === 'bar' ? 'full' : s === 'min' ? 'bar' : s)), [setStage])

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
        ref={attachMeasure}
        onClick={() => setStage('full')}
        className={'absolute left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-teal hover:text-ink transition-colors ' + (kiosk ? 'bottom-[calc(104px+env(safe-area-inset-bottom))] md:bottom-12 z-[45]' : 'bottom-2 md:bottom-4 z-10')}
      >
        <History className="h-3.5 w-3.5" /> TIMELINE
        {!live && <span className="text-amber">{RANGES.find((r) => r.key === range)?.label ?? 'Replay'}</span>}
        {/* Keep the asset readout visible even collapsed. */}
        {hud && (
          <span className="text-ink tabular-nums whitespace-nowrap">
            {[hud.mph != null ? `${Math.round(hud.mph)} mph` : null, `${hud.milesIn.toFixed(1)} mi`].filter(Boolean).join(' · ')}
          </span>
        )}
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    // Hug the bottom edge — the page already pads for the mobile tab bar, so
    // the old 80px offset left a dead strip of map under the controls. Kiosk
    // rides above the event ticker.
    <div ref={(el) => { rootRef.current = el; attachMeasure(el) }} data-tour="timeline" className={'absolute left-3 right-3 md:left-4 md:right-4 ' + (kiosk ? 'bottom-[calc(104px+env(safe-area-inset-bottom))] md:bottom-12 z-[45]' : 'bottom-2 md:bottom-4 z-10')}>
      {/* Camera popover — sibling of the bar for the same overflow-hidden
          reason as the follow menu below (rendering INSIDE the bar clipped
          it invisible; ship-check P0, Aug 22). */}
      {showCam && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[230px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-1.5 flex flex-col gap-0.5">
          {onSpin && !followed && (
            <button
              onClick={() => { onSpin(); setShowCam(false) }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold text-ink hover:bg-navy-800 text-left"
            >
              <RotateCw className={'h-3.5 w-3.5 ' + (spinning ? 'text-teal' : 'text-faint')} />
              {spinning ? 'Stop the 360 spin' : '360° spin'}
            </button>
          )}
          {onFlyover && !followed && (
            <span className="flex items-center gap-1">
              <button
                onClick={() => { onFlyover(); setShowCam(false) }}
                className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold text-ink hover:bg-navy-800 text-left"
              >
                <Plane className={'h-3.5 w-3.5 ' + (flying ? 'text-amber' : 'text-faint')} />
                {flying ? 'End the flyover' : 'Flyover every asset'}
              </button>
              {flying && onFlySpeed && (
                <span className="flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800 flex-none">
                  {([[0.5, '½×'], [1, '1×'], [2, '2×']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => onFlySpeed(v)}
                      className={
                        'px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold transition-colors ' +
                        (flySpeed === v ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')
                      }
                    >{label}</button>
                  ))}
                </span>
              )}
            </span>
          )}
          {(followAssets.length > 0 || followZones.length > 0) && (
            <button
              onClick={() => { setShowCam(false); setShowFollow(true) }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold text-ink hover:bg-navy-800 text-left"
            >
              {live ? <Navigation className={'h-3.5 w-3.5 ' + (followed ? 'text-amber' : 'text-faint')} /> : <Video className={'h-3.5 w-3.5 ' + (followed ? 'text-amber' : 'text-faint')} />}
              {followed ? `Following ${followed.name}…` : 'Follow an asset…'}
            </button>
          )}
        </div>
      )}
      {/* Follow popover — sibling of the bar so it escapes the overflow-hidden clip
          (rendering it inside the rounded bar made it invisible on iPad). When not
          following it's the asset picker; while following it's the camera styles. */}
      {showFollow && !followed && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[250px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2">
          <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink flex items-center gap-1.5">
            <Video className="h-3.5 w-3.5 text-amber" /> Fly the camera with…
          </p>
          <div className="relative mx-1 mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint pointer-events-none" />
            <input
              value={followQ}
              onChange={(e) => setFollowQ(e.target.value)}
              placeholder="Search assets & zones…"
              autoFocus
              className="w-full bg-navy-900 border border-navy-700 rounded-lg text-ink text-[12.5px] pl-8 pr-2 py-1.5 outline-none focus:border-amber placeholder:text-faint"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto no-scrollbar">
            {pickAssets.map((a) => (
              <button
                key={a.id}
                onClick={() => { onFollow(a.id); setFollowQ(''); setShowFollow(false) }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-[13px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: a.color }} />
                <span className="truncate">{a.name}</span>
              </button>
            ))}
            {pickZones.length > 0 && (
              <p className="px-2 pt-2 pb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Zones</p>
            )}
            {pickZones.map((z) => (
              <button
                key={z.id}
                onClick={() => { onFollow(z.id); setFollowQ(''); setShowFollow(false) }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-[13px] text-muted hover:bg-navy-900 hover:text-ink transition-colors"
              >
                <Hexagon className="h-3.5 w-3.5 flex-none" style={{ color: z.color }} />
                <span className="truncate">{z.name}</span>
              </button>
            ))}
            {pickAssets.length + pickZones.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-faint text-center">Nothing matches &ldquo;{followQ}&rdquo;</p>
            )}
          </div>
          <p className="px-2 pt-1.5 pb-0.5 text-[10px] text-faint leading-snug">
            Locks the camera on. Assets replay their route; zones get a slow aerial of the site.
          </p>
        </div>
      )}
      {showFollow && followed && (
        <div className="absolute bottom-full mb-2 right-0 z-30 w-[220px] rounded-xl bg-navy-950 border border-navy-700 shadow-panel p-2">
          <p className="px-2 pt-1 pb-1.5 font-display font-bold text-[12px] text-ink flex items-center gap-1.5 truncate">
            <Video className="h-3.5 w-3.5 text-amber" /> Camera · {followed.name}
          </p>
          {CAMERA_MODES.filter(({ key }) => !followedIsZone || key !== 'chase').map(({ key, label, icon: Icon, note }) => (
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
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">From day · starts 12:00 AM</span>
            <input type="date" value={toDateInput(customFrom)} max={toDateInput(customTo)} onChange={(e) => { if (e.target.value) onCustom(dayStartMs(e.target.value), customTo) }} className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">To day · ends 11:59 PM</span>
            <input type="date" value={toDateInput(customTo)} min={toDateInput(customFrom)} onChange={(e) => { if (e.target.value) onCustom(customFrom, dayEndMs(e.target.value)) }} className="w-full mt-0.5 bg-navy-900 border border-navy-700 rounded-lg text-ink text-xs px-2 py-1.5 outline-none focus:border-amber" />
          </label>
          <button onClick={() => setShowCustom(false)} className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-xs py-1.5 hover:bg-amber-600 transition-colors">Done</button>
        </div>
      )}
      <div className="relative">
      {/* X straddles the bar's top edge (site convention) — always visible,
          always tappable, never buried in the wrapping control rows. */}
      <ProtrudingClose onClick={() => setStage('min')} title="Minimize timeline" />
      <div
        className="rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden"
        // The whole bar accepts the sheet gesture — ANYWHERE, buttons and
        // pills included (Brian, Aug 23: "any of this should be able to be
        // swiped up or down"). Only real inputs (sliders, date pickers,
        // search) keep their drags. A mostly-VERTICAL move steps the stage
        // and the tail-end click is swallowed so the button under the finger
        // doesn't also fire; horizontal drags still scroll the pill strips.
        onPointerDown={(e) => {
          // Reset the eaten-click flag on every NEW gesture — on touch a
          // completed swipe never synthesizes a click, so without this the
          // flag stayed armed and silently ate the next legitimate tap
          // (ship-check P1, Aug 23).
          swipeStepped.current = false
          if ((e.target as HTMLElement).closest('input, select, textarea, a, [role="slider"]')) return
          dragRef.current = { x: e.clientX, y: e.clientY, done: false }
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (!d || d.done) return
          const dy = e.clientY - d.y
          const dx = e.clientX - d.x
          if (Math.abs(dy) <= 26 || Math.abs(dy) < Math.abs(dx) * 1.2) return
          d.done = true
          swipeStepped.current = true
          if (dy > 0) stepDown(); else stepUp()
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
        onClickCapture={(e) => {
          if (swipeStepped.current) { swipeStepped.current = false; e.preventDefault(); e.stopPropagation() }
        }}
      >
      {/* Drag handle + stage arrows (Brian, Aug 11: "add arrows here to
          simplify this function") — the chevrons make the three stages
          tappable, not just draggable: ∨ steps down (full → bar → pill),
          ∧ climbs back up (shown once there's somewhere up to go). The
          whole bar still drags; touch-none keeps the gesture off the
          browser on the primary target. */}
      <div className="flex items-center justify-center gap-4 h-6 -mb-1 cursor-grab touch-none select-none">
        {/* px-3/py-2 + matching negative margins = a ~40×32px thumb target
            on a 16px glyph without moving a pixel visually. Taller would eat
            taps meant for the range pills right below (gloved-thumb audit,
            Aug 22 — same pattern on every small control in this bar).
            BOTH directions always render (Brian, Aug 22: "a different
            chevron to slide up and slide down") — ∧ dims when the sheet is
            already fully open, so the pair always reads as two actions. */}
        <button
          onClick={stepUp}
          disabled={stage === 'full'}
          className="px-3 py-2 -mx-3 -my-2 text-faint hover:text-ink transition-colors disabled:opacity-25 disabled:hover:text-faint"
          aria-label="Slide timeline up"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <span className="w-9 h-1 rounded-full bg-navy-600" aria-hidden />
        <button onClick={stepDown} className="px-3 py-2 -mx-3 -my-2 text-faint hover:text-ink transition-colors" aria-label="Slide timeline down">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {/* range pills + movement-display control — the 'options' stage. On
          phones the pills get their own full-width scrollable row — sharing
          one row squeezed them into a useless 10px sliver next to all the
          flex-none controls. */}
      {stage === 'full' && (
      <div className={'flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-3 pr-11 pt-1 ' + (live ? 'pb-2' : 'pb-1.5 border-b border-navy-800')}>
        {/* Reserve real width for the range pills — without a floor, the pile
            of flex-none controls crushes this strip to a sliver ("Toda…") on
            mid-width screens; controls wrap to a second line instead. */}
        <div className="relative w-full sm:w-auto sm:flex-1 min-w-0 sm:min-w-[270px]">
        {/* Right-edge fade whenever more pills hide off-screen — a clipped
            "30d" read as broken, not scrollable ("7 days 3", Aug 11). */}
        <div ref={pillsRef} onScroll={measurePills} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
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
        {pillsMore && <div className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-l from-navy-950 to-transparent" />}
        </div>
        {/* Day stepper — flip through calendar days one at a time (Brian, Aug 3).
            Appears whenever the view IS a single day (Today, Yesterday, or a
            one-day Custom); ◀ walks back through history as single-day Custom
            windows, ▶ walks forward and snaps back onto the named Yesterday/
            Today pills at the boundary. Live and multi-day ranges untouched. */}
        {(() => {
          let base: number | null = null
          if (range === 'today') base = Date.now()
          else if (range === 'yesterday') base = Date.now() - 86_400_000
          else if (custom && toDateInput(customFrom) === toDateInput(customTo)) base = customFrom + 12 * 3_600_000
          if (base == null) return null
          const key = toDateInput(base)
          const todayKey = toDateInput(Date.now())
          const isToday = key === todayKey
          const label = new Date(dayStartMs(key) + 12 * 3_600_000)
            .toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
          const step = (delta: number) => {
            const targetKey = toDateInput(dayStartMs(key) + 12 * 3_600_000 + delta * 86_400_000)
            if (targetKey >= todayKey) { onRange('today'); return }
            if (targetKey === toDateInput(Date.now() - 86_400_000)) { onRange('yesterday'); return }
            onCustom(dayStartMs(targetKey), dayEndMs(targetKey))
            onRange('custom')
          }
          return (
            <div className="flex-none flex items-center gap-0.5 rounded-full bg-navy-900 border border-navy-700 px-1 py-0.5">
              {/* 40px-wide touch boxes via negative margins — the visible
                  pill stays this slim, the date label between them soaks up
                  the invisible overlap (it isn't tappable anyway). */}
              <button type="button" onClick={() => step(-1)} title="Previous day" aria-label="Previous day"
                className="px-[13px] py-2 -mx-[13px] -my-2 text-faint hover:text-ink">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[10.5px] text-muted whitespace-nowrap px-0.5">{isToday ? 'Today' : label}</span>
              <button type="button" onClick={() => step(1)} disabled={isToday} title="Next day" aria-label="Next day"
                className="px-[13px] py-2 -mx-[13px] -my-2 text-faint hover:text-ink disabled:opacity-30">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })()}
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
            {/* Label ALWAYS visible — a bare "$11k" was mystery meat on
                phones (Grok-doc: say what the number is). */}
            <span className="text-faint">· cost {costLabel}</span>
          </div>
        )}
        {/* One control strip on phones (Brian, Aug 23: "condense these into
            one line") — chart, share, display modes, marker style, and Camera
            share a single horizontally-scrollable row instead of wrapping
            into three. sm:contents dissolves the wrapper on desktop so the
            controls stay inline in the wrap row exactly as before. */}
        {/* Camera sits OUTSIDE the scroll area, pinned at the row's right end
            (Brian, Aug 23: "fix this partially covered") — only the mode
            pills scroll under the fade cue; nothing rests half-clipped. */}
        <div className="w-full flex items-center gap-2 sm:contents">
        <div className="relative flex-1 min-w-0 sm:contents">
        <div ref={stripRef} onScroll={measurePills} className="flex items-center gap-2 overflow-x-auto no-scrollbar sm:contents">
        {/* Pull-up activity chart toggle (replay modes only) */}
        {!live && (
          <button
            onClick={() => setShowChart((s) => !s)}
            title="Activity chart"
            // before:-inset-1.5 pads the 28px chip out to a 40px touch box
            // without growing the visible bordered square.
            className={
              "relative before:absolute before:-inset-1.5 before:content-[''] flex-none grid place-items-center w-7 h-7 rounded-lg border transition-colors " +
              (showChart ? 'bg-teal/20 text-teal border-teal/40' : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            <AreaChart className="h-3.5 w-3.5" />
          </button>
        )}
        {!live && (
          <button
            onClick={shareReplay}
            title={followed && !followedIsZone
              ? 'Copy PUBLIC replay link — anyone with it can watch this trip for 7 days, no login'
              : 'Copy replay link (teammates sign in and see this view)'}
            className={
              "relative before:absolute before:-inset-1.5 before:content-[''] flex-none grid place-items-center w-7 h-7 rounded-lg border transition-colors " +
              (shared ? 'bg-teal/20 text-teal border-teal/40' : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            {shared ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          </button>
        )}
        {/* Earth spin moved to the layers panel → Advanced (owner ask, Jul 21).
            360 + Fly folded into the single Camera button below (8c-c). */}
        <div className="flex-none flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800">
          {MODES.map(({ key, label, short, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onTrailMode(key)}
              title={label}
              className={
                'flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ' +
                (trailMode === key ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {/* Label always visible (Brian, Aug 22: circled this row asking
                  where Trails lives — it was the unlabeled second glyph). */}
              <span className="text-[10px] sm:hidden">{short}</span>
              <span className="hidden sm:inline text-[11px]">{label}</span>
            </button>
          ))}
        </div>

        {/* Marker style — only meaningful while live pins show (trails off). */}
        {onMarkerStyle && trailMode === 'off' && (
          <div className="flex-none flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800">
            <button
              onClick={() => onMarkerStyle('dot')}
              title="Colored dots — clean, matches replay view"
              className={
                'flex items-center px-2 py-1 rounded-md transition-colors ' +
                (markerStyle === 'dot' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
              }
            >
              <Circle className="h-3.5 w-3.5 fill-current" />
            </button>
            <button
              onClick={() => onMarkerStyle('arrow')}
              title="Direction arrows — asset-colored pucks pointing the way they're headed, type icon on top"
              className={
                'flex items-center px-2 py-1 rounded-md transition-colors ' +
                (markerStyle === 'arrow' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
              }
            >
              <Navigation2 className="h-3.5 w-3.5 fill-current" />
            </button>
          </div>
        )}

        </div>
        {stripMore && <div className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-l from-navy-950 to-transparent sm:hidden" />}
        </div>

        {/* Speed-colored trails (Brian, Aug 23: "where do I find speed trail
            color toggle") — pinned beside Camera so it can never rest
            half-clipped in the scroll area. */}
        {onSpeedTrails && trailMode === 'trails' && (
          <button
            onClick={onSpeedTrails}
            title="Color trails by speed — teal under 10 · amber 10–45 · orange 45–70 · red 70+ mph"
            className={
              'flex-none flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ' +
              (speedTrails ? 'bg-amber/20 text-amber border-amber/40' : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            <Gauge className="h-3.5 w-3.5" />
            <span className="text-[10px] sm:text-[11px]">Speed</span>
          </button>
        )}

        {/* ONE Camera button (Brian, Aug 22, decision 8c-c): 360, Fly, and
            Follow fold behind it so the options row slims. The button wears
            the active mode's color + label; the follow MENU still renders
            above the bar (see top). */}
        {(onSpin || onFlyover || followAssets.length > 0 || followZones.length > 0) && (
          <button
            onClick={() => { setShowCam((s) => !s); setShowFollow(false) }}
            title={followed ? `Following ${followed.name}` : flying ? 'Flyover running' : spinning ? '360 spin running' : 'Camera — 360, flyover, follow'}
            className={
              'flex-none flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ' +
              (followed || flying
                ? 'bg-amber/20 text-amber border-amber/40'
                : spinning
                  ? 'bg-teal/20 text-teal border-teal/40'
                  : showCam
                    ? 'bg-navy-800 text-ink border-navy-700'
                    : 'bg-navy-900 text-faint border-navy-800 hover:text-ink')
            }
          >
            <Video className="h-3.5 w-3.5" />
            <span className="hidden sm:inline max-w-[90px] truncate">
              {followed ? CAMERA_MODES.find((m) => m.key === followMode)?.label ?? 'Following'
                : flying ? 'Fly' : spinning ? '360' : 'Camera'}
            </span>
          </button>
        )}
        </div>
      </div>
      )}

      {/* Asset readout — speed / clock / miles for the followed or selected
          asset, docked in the bar so it never covers the map. Same row, same
          look, live and replay. */}
      {hud && (
        <div className="flex items-center gap-2.5 px-4 pt-1.5 -mb-0.5 font-mono text-[11.5px] tabular-nums min-w-0 flex-nowrap overflow-hidden">
          <Navigation className="h-3 w-3 text-amber flex-none" />
          <span className="text-ink font-semibold truncate min-w-0 max-w-[150px]">{hud.name}</span>
          <span className="text-amber font-bold flex-none whitespace-nowrap">{hud.mph != null ? `${Math.round(hud.mph)} mph` : '— mph'}</span>
          <span className="text-teal flex-none whitespace-nowrap">{hud.clock}</span>
          <span className="text-muted flex-none whitespace-nowrap">{hud.milesIn.toFixed(1)} mi</span>
        </div>
      )}

      {live ? (
        /* Phones show this always; desktop shows it inline in the pill row —
           except in the timeline-only stage, where it's all there is. */
        <div className={(stage === 'bar' ? 'flex' : 'sm:hidden flex') + ' items-center gap-2 px-4 pb-2 pt-1 min-w-0 flex-nowrap overflow-hidden'}>
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
            {/* Long ranges re-fetch full-resolution history — a thin sweep
                right above the scrubber says "still filling in" (Aug 5). */}
            {loading && (
              <div className="h-[3px] mb-[3px] rounded-full bg-navy-800 overflow-hidden" aria-label="Loading history">
                <div className="h-full w-1/3 rounded-full bg-teal/80 animate-tl-sweep" />
              </div>
            )}
            {/* Heat-mapped track: color = # assets moving at that moment
                (blue = nobody moving, teal→amber→red = busier). */}
            <div className="relative h-[17px] flex items-center">
              <div
                className="absolute inset-x-0 h-[9px] top-1/2 -translate-y-1/2 rounded-full border border-navy-700/60"
                style={{ background: heatGradient ?? 'rgba(20,80,111,0.5)' }}
              />
              {/* Alert moments live ON the timeline — red diamonds at the
                  minute they fired; tap to jump the replay there. */}
              {/* The 8px diamond stays the visual; the button around it is a
                  40px touch box (an 8px target is unhittable with gloves).
                  It hangs ABOVE the track — only the top sliver of the
                  scrubber sits under it — so drags on the slider itself
                  still land on the range input, and a tap here jumps to the
                  alert, which is the same moment that spot on the track is. */}
              {alertMarks.map((mk, i) => (
                <button
                  key={i}
                  title={mk.label}
                  onClick={() => onSeek(Math.min(1, Math.max(0, mk.t)))}
                  className="group absolute -top-[35px] z-10 flex h-10 w-10 -translate-x-1/2 items-end justify-center pb-1"
                  style={{ left: `${(mk.t * 100).toFixed(2)}%` }}
                  aria-label={`Jump to alert: ${mk.label}`}
                >
                  <span className="w-2 h-2 rotate-45 bg-alert border border-navy-950 group-hover:scale-150 transition-transform" />
                </button>
              ))}
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

          <SpeedControl speeds={speeds} value={speed} onChange={onSpeed} />
        </div>
        </>
      )}
      </div>
      </div>
    </div>
  )
}
