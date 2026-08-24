'use client'

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { CloudRain, Map as MapIcon, Satellite, Layers, ChevronDown, Box, Star, Check, Waves, Pause, Play, Hexagon, RotateCcw, Plus, Cctv, Bookmark, X, Type, HardHat, TrafficCone, LandPlot, Sparkles, Search, Sun } from 'lucide-react'
import { PRECIP_PERIODS } from '@/lib/weather'
import type { SavedMapView } from '@/lib/map-views'
import type { AssetType } from '@/lib/types'
import { GROUPS, BASEMAPS, BASEMAP_TILE, BASEMAP_THUMB_FILTER, LAYER_ROWS, rowState, type GroupId, type LayerRowDef, type BasemapId } from '@/lib/map-layers'

export type BaseStyle = BasemapId

interface WeatherControlProps {
  base: BaseStyle
  onBase: (b: BaseStyle) => void
  /** 3D buildings + tilt — an independent toggle layerable on any basemap. */
  threeD: boolean
  onThreeD: (v: boolean) => void
  /** 3D terrain relief (the "3D map") — heavy, so it's a separate opt-in. */
  terrain3d?: boolean
  onTerrain3d?: (v: boolean) => void
  /** Terrain vertical exaggeration (×). Boosting it makes creeks and ditches
   *  read on flat ground. */
  terrainExag?: number
  onTerrainExag?: (v: number) => void
  /** Sunlight mode (8c-f): high-contrast canvas boost for bright daylight. */
  sunMode?: boolean
  onSunMode?: (v: boolean) => void
  radarOn: boolean
  onRadar: (v: boolean) => void
  radarPaused?: boolean
  onRadarPause?: (v: boolean) => void
  cloudsOn?: boolean
  onClouds?: (v: boolean) => void
  stormTopsOn?: boolean
  onStormTops?: (v: boolean) => void
  precipOn?: boolean
  onPrecip?: (v: boolean) => void
  precipPeriod?: string
  onPrecipPeriod?: (k: string) => void
  frameTime: string | null
  parcelsOn?: boolean
  onParcels?: (v: boolean) => void
  /** On/off state for every registry overlay, keyed by persisted layer id. */
  overlays?: { key: string; on: boolean }[]
  onOverlay?: (key: string, on: boolean) => void
  /** Master switch for every name label (assets, tools, zones) at all zooms. */
  showLabels?: boolean
  onShowLabels?: (v: boolean) => void
  /** Current map zoom — powers visible zoom-gating on rows. */
  zoom?: number
  /** Per-layer raster opacity (0-1), keyed by layer id. */
  overlayOpacity?: Record<string, number>
  onOverlayOpacity?: (key: string, v: number) => void
  /** Put every layer back to factory defaults. */
  onResetLayers?: () => void
  views?: SavedMapView[]
  activeViewId?: string | null
  defaultViewId?: string | null
  onApplyView?: (id: string) => void
  onSaveView?: (name: string) => void
  /** Overwrite a PERSONAL view's cfg with the current look — never presets. */
  onUpdateView?: (id: string) => void
  onDeleteView?: (id: string) => void
  onSetDefaultView?: (id: string) => void
  top?: number
  z?: number
  /** Which screen edge the pill/panel hugs. Live map = right; kiosk = left. */
  side?: 'left' | 'right'
  /** Rendered to the RIGHT of the collapsed pill (the map search button). */
  searchSlot?: ReactNode
  /** Asset-type visibility — BACK inside the panel (Brian, Aug 22 2:38 AM:
   *  "add the asset on and off functionality back into layers"), as the
   *  first section: the everyday set, one tap from the pill. */
  filter?: Set<AssetType>
  onFilter?: (f: Set<AssetType>) => void
  showZones?: boolean
  onShowZones?: (v: boolean) => void
  /** Demo-only Site IoT toggle. */
  showDevices?: boolean
  onToggleDevices?: () => void
  /** Historical imagery (Esri Wayback): one entry per year, oldest first. */
  waybackYears?: string[]
  waybackIdx?: number
  onWaybackIdx?: (i: number) => void
  /** Slide the whole cluster (pill + search + chips + open panel) off the
   *  LEFT edge — the mirror of the right rail's tuck (Brian, Aug 22:
   *  "too cluttered… swiped out of the way fully just like the right side"). */
  hidden?: boolean
  /** No collapsed pill at all — the drawer opens via the 'ht:open-layers'
   *  window event instead (the bottom-right thumb cluster, Brian Aug 22). */
  hidePill?: boolean
}

/** Shared tuck animation for both roots (collapsed row + open panel). */
const tuckCls = (hidden: boolean) =>
  'transition-all duration-300 ease-out ' +
  (hidden ? '-translate-x-[130%] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100')

function Toggle({ on, disabled = false }: { on: boolean; disabled?: boolean }) {
  // ON = full amber track (Brian, Aug 12: "make it more obvious when a layer
  // is turned on") — unmissable against the navy panel; teal was too subtle.
  return (
    <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (on && !disabled ? 'bg-amber' : 'bg-navy-700') + (disabled ? ' opacity-50' : '')}>
      <span className={'absolute top-0.5 w-4 h-4 rounded-full transition-all ' + (on && !disabled ? 'left-[18px] bg-[#1a1100]' : 'left-0.5 bg-ink')} />
    </span>
  )
}

const GROUP_ICON: Record<GroupId, typeof Hexagon> = {
  basemap: MapIcon,
  jobs: HardHat,
  weather: CloudRain,
  roads: TrafficCone,
  land: LandPlot,
  sky: Sparkles,
}

// v2: everything defaults collapsed (owner ask Jul 14) — new key so stored
// v1 expanded-states don't override the new default.
// LayerRow/GroupSection live at MODULE scope on purpose: defined inside the
// component they took a new identity every render, so React REMOUNTED every
// row on the first slider tick and the opacity drag died mid-gesture (owner:
// "the teal bars don't drag", Jul 14). Same type across renders = live drag.
function LayerRow({ def, on, zoom, base, err, fresh, opacity, onOpacity, onToggle, extra }: {
  def: LayerRowDef
  on: boolean
  zoom: number
  base: BasemapId
  err?: string
  fresh: { text: string; stale: boolean } | null
  opacity: number
  onOpacity?: (v: number) => void
  onToggle: () => void
  extra?: ReactNode
}) {
  const st = rowState(def, on, zoom, base)
  const comingSoon = def.status === 'coming-soon'
  const dim = st.disabled || ((!!st.reason || !!st.zoomDir) && !comingSoon)
  return (
    <div className="border-t border-navy-800 first:border-t-0">
      <button
        onClick={() => { if (!st.disabled) onToggle() }}
        disabled={st.disabled}
        className={'w-full flex items-center gap-2 px-3 py-2 transition-colors ' + (st.disabled ? 'cursor-not-allowed' : 'hover:bg-navy-900')}
      >
        <span className={'flex-1 min-w-0 truncate text-left text-[13px] font-semibold ' + (dim ? 'text-faint' : 'text-ink')}>{def.label}</span>
        {st.zoomDir && !comingSoon && (
          <span className="flex-none text-[10px] font-mono text-amber/90">(zoom {st.zoomDir})</span>
        )}
        {comingSoon
          ? <span className="font-mono text-[9px] uppercase tracking-wide text-faint border border-navy-700 rounded px-1.5 py-0.5 flex-none">Coming soon</span>
          : <Toggle on={st.on} disabled={st.disabled} />}
      </button>
      {st.reason && !comingSoon && (
        <p className="px-3 pb-1.5 -mt-1 text-[10px] font-mono text-amber/90">{st.reason}</p>
      )}
      {st.on && !st.disabled && err && (
        <p className="px-3 pb-1.5 -mt-1 text-[10px] font-mono text-amber">⚠ {err}</p>
      )}
      {st.on && !st.disabled && !st.reason && !st.zoomDir && def.hint && (
        <p className="px-3 pb-1.5 -mt-1 font-mono text-[10px] text-teal">
          {def.hint}
          {fresh && <span className={'ml-1.5 ' + (fresh.stale ? 'text-amber' : 'text-faint')}>{fresh.text}</span>}
        </p>
      )}
      {st.on && !st.disabled && def.hasOpacity && onOpacity && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <span className="font-mono text-[9px] text-faint flex-none">opacity</span>
          <input
            type="range" min={15} max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-teal cursor-pointer"
          />
        </div>
      )}
      {extra}
    </div>
  )
}

/** Collapsible group header (Aug 16 reorg) — chevron + icon + a "N on" count
 *  badge (teal; amber when a live feed inside the group is failing). Expand
 *  state is per-session component state only — never persisted. */
function GroupHeader({ gid, open, count, hasErr, onToggle }: {
  gid: GroupId
  open: boolean
  count: number
  hasErr: boolean
  onToggle: () => void
}) {
  const g = GROUPS.find((x) => x.id === gid)
  const Icon = GROUP_ICON[gid]
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      // Lighter band than the rows (Brian, Aug 22): heading vs layer option
      // reads at a glance.
      className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-navy-800 bg-navy-900/70 hover:bg-navy-800 transition-colors"
    >
      <Icon className="h-3 w-3 text-teal flex-none" />
      <span className="flex-1 min-w-0 truncate text-left font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{g?.label}</span>
      {count > 0 && (
        <span className={'flex-none font-mono text-[9px] rounded px-1.5 py-0.5 ' + (hasErr ? 'bg-amber/20 text-amber' : 'bg-teal/20 text-teal')}>
          {count} on
        </span>
      )}
      <ChevronDown className={'h-3 w-3 text-faint flex-none transition-transform ' + (open ? '' : '-rotate-90')} />
    </button>
  )
}

const STALE_MS = 15 * 60_000

export function WeatherControl({ base, onBase, threeD, onThreeD, terrain3d = false, onTerrain3d, terrainExag = 1.3, onTerrainExag, sunMode = false, onSunMode, radarOn, onRadar, radarPaused = false, onRadarPause, cloudsOn = false, onClouds, stormTopsOn = false, onStormTops, precipOn = false, onPrecip, precipPeriod = '24h', onPrecipPeriod, frameTime, parcelsOn = false, onParcels, overlays, onOverlay, showLabels = true, onShowLabels, zoom = 10, overlayOpacity = {}, onOverlayOpacity, onResetLayers, views, activeViewId = null, defaultViewId = null, onApplyView, onSaveView, onUpdateView, onDeleteView, onSetDefaultView, top = 58, z = 10, side = 'left', searchSlot, filter, onFilter, showZones = true, onShowZones, showDevices = false, onToggleDevices, waybackYears, waybackIdx = 0, onWaybackIdx, hidden = false, hidePill = false }: WeatherControlProps) {
  const [open, setOpen] = useState(false)
  // The thumb cluster's Layers FAB opens the drawer from outside.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('ht:open-layers', onOpen)
    return () => window.removeEventListener('ht:open-layers', onOpen)
  }, [])
  // Swipe the drawer toward the LEFT EDGE anywhere on it to close (Brian,
  // Aug 23) — a mostly-horizontal leftward drag ≥48px dismisses; vertical
  // scrolling and taps are untouched, and the tail-end click is swallowed so
  // the row under the finger doesn't also toggle.
  const drawerSwipe = useRef<{ x: number; y: number } | null>(null)
  const drawerSwiped = useRef(false)
  const drawerDown = (e: React.PointerEvent) => {
    drawerSwipe.current = { x: e.clientX, y: e.clientY }
    drawerSwiped.current = false
  }
  const drawerMove = (e: React.PointerEvent) => {
    const st = drawerSwipe.current
    if (!st || drawerSwiped.current) return
    const dx = e.clientX - st.x
    const dy = e.clientY - st.y
    if (dx < -48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      drawerSwiped.current = true
      setOpen(false)
    }
  }
  const drawerClickCapture = (e: React.MouseEvent) => {
    if (drawerSwiped.current) { drawerSwiped.current = false; e.preventDefault(); e.stopPropagation() }
  }
  const sideCls = side === 'right' ? 'right-3' : 'left-3'
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  // Two-tap confirm for deleting a personal preset — first × arms it, second removes.
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const submitSaveView = (e: React.FormEvent) => {
    e.preventDefault()
    onSaveView?.(viewName)
    setViewName('')
    setSavingView(false)
  }
  // ── Panel tabs: Layers (grouped toggles) | Views (saved looks). ──────────
  const [tab, setTab] = useState<'layers' | 'views'>('layers')
  // Collapsible groups (Aug 16 reorg): ALL collapsed on open; expand state is
  // per-session only — deliberately NOT persisted (fresh panel every visit).
  const [openGroups, setOpenGroups] = useState<Set<GroupId>>(() => new Set())
  const toggleGroup = (gid: GroupId) => setOpenGroups((s) => {
    const next = new Set(s)
    if (next.has(gid)) next.delete(gid); else next.add(gid)
    return next
  })
  // Assets dropdown (Brian, Aug 22): same collapsible treatment as every
  // other group — starts collapsed, badge shows how many types are on.
  const [fleetOpen, setFleetOpen] = useState(false)
  // Which groups have their advanced ("More layers") rows expanded.
  const [moreRows, setMoreRows] = useState<Set<GroupId>>(() => new Set())
  // Search/filter across the registry rows (label + hint, case-insensitive).
  const [query, setQuery] = useState('')
  // Basemap strip shows the everyday 6; "More" reveals the specialty set.
  // Derived at RENDER, not snapshotted at mount (ship-check P1): the default
  // saved view / onApplyView can switch to a specialty basemap after mount,
  // and the active thumb must never be hidden.
  const [moreBasemaps, setMoreBasemaps] = useState(false)
  const specialtyBase = BASEMAPS.slice(6).some((b) => b.id === base)
  const stripAll = moreBasemaps || specialtyBase

  // ── Feed freshness: layer effects broadcast when they fetch ───────────────
  const [feedAt, setFeedAt] = useState<Record<string, number>>({})
  // Layer effects report failures here (missing key, dead feed, tiles not
  // rendering) — the row says WHY instead of sitting silently empty.
  const [feedErr, setFeedErr] = useState<Record<string, string>>({})
  // Live feeds still downloading after their toggle flipped on — drives the
  // thin sweep bar at the top of the panel (same branding as the timeline's).
  const [pendingFeeds, setPendingFeeds] = useState<Set<string>>(new Set())
  const [, setTick] = useState(0)
  useEffect(() => {
    const settle = (key: string) => setPendingFeeds((p) => {
      if (!p.has(key)) return p
      const next = new Set(p); next.delete(key); return next
    })
    const onUpd = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; at: number }>).detail
      if (!d?.key) return
      settle(d.key)
      setFeedAt((f) => ({ ...f, [d.key]: d.at }))
      // A successful update clears any earlier failure note.
      setFeedErr((f) => {
        if (!(d.key in f)) return f
        const next = { ...f }
        delete next[d.key]
        return next
      })
    }
    const onErr = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; msg: string }>).detail
      if (d?.key && d?.msg) { settle(d.key); setFeedErr((f) => ({ ...f, [d.key]: d.msg })) }
    }
    window.addEventListener('ht:layer-updated', onUpd)
    window.addEventListener('ht:layer-error', onErr)
    const id = setInterval(() => setTick((t) => t + 1), 60_000) // refresh "updated Xp" stamps
    return () => {
      window.removeEventListener('ht:layer-updated', onUpd)
      window.removeEventListener('ht:layer-error', onErr)
      clearInterval(id)
    }
  }, [])
  // A feed that never reports (dead endpoint with no error path) shouldn't
  // sweep forever — give up quietly after 20 s.
  useEffect(() => {
    if (!pendingFeeds.size) return
    const id = setTimeout(() => setPendingFeeds(new Set()), 20_000)
    return () => clearTimeout(id)
  }, [pendingFeeds])
  const stamp = (key: string): { text: string; stale: boolean } | null => {
    const at = feedAt[key]
    if (!at) return null
    const stale = Date.now() - at > STALE_MS
    return { text: `updated ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')}`, stale }
  }

  // ── One resolver: registry id → current on-state + toggler ────────────────
  const overlayOn = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const o of overlays ?? []) m[o.key] = o.on
    return m
  }, [overlays])
  const isOn = (id: string): boolean => {
    switch (id) {
      case 'radar': return radarOn
      case 'clouds': return cloudsOn
      case 'stormtops': return stormTopsOn
      case 'precip': return precipOn
      case 'parcels': return parcelsOn
      default: return !!overlayOn[id]
    }
  }
  const toggle = (id: string) => {
    // Turning a LIVE feed on = a download starts — sweep until it reports.
    if (!isOn(id) && LAYER_ROWS.find((d) => d.id === id)?.isLive) {
      setPendingFeeds((p) => new Set(p).add(id))
    }
    switch (id) {
      case 'radar': return onRadar(!radarOn)
      case 'clouds': return onClouds?.(!cloudsOn)
      case 'stormtops': return onStormTops?.(!stormTopsOn)
      case 'precip': return onPrecip?.(!precipOn)
      case 'parcels': return onParcels?.(!parcelsOn)
      default: return onOverlay?.(id, !overlayOn[id])
    }
  }

  // Extra controls that belong to specific rows (radar pause, rain periods).
  const rowExtra = (id: string): ReactNode => {
    if (id === 'radar' && radarOn) {
      return (
        <div className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal flex items-center gap-1.5">
          <span className={'w-1.5 h-1.5 rounded-full bg-teal ' + (radarPaused ? '' : 'animate-blink')} />
          {radarPaused ? 'paused' : 'live'}{frameTime ? ` · ${frameTime}` : ''}
          {onRadarPause && (
            <button
              onClick={() => onRadarPause(!radarPaused)}
              title={radarPaused ? 'Resume radar loop' : 'Pause radar loop'}
              className="ml-auto grid place-items-center w-5 h-5 rounded text-faint hover:text-teal"
            >
              {radarPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
          )}
        </div>
      )
    }
    if (id === 'wayback' && isOn('wayback')) {
      if (!waybackYears || waybackYears.length === 0) {
        return <p className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-faint">loading the year list…</p>
      }
      const i = Math.min(waybackIdx, waybackYears.length - 1)
      return (
        <div className="px-3 pb-2 -mt-0.5 flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-amber tabular-nums flex-none w-10">{waybackYears[i]}</span>
          <input
            type="range" min={0} max={waybackYears.length - 1} value={i}
            onChange={(e) => onWaybackIdx?.(Number(e.target.value))}
            className="flex-1 h-1 accent-amber cursor-pointer"
            aria-label="Imagery year"
          />
        </div>
      )
    }
    if (id === 'precip' && precipOn) {
      return (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800">
            {PRECIP_PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => onPrecipPeriod?.(p.key)}
                className={
                  'flex-1 py-1 rounded-md text-[10.5px] font-semibold transition-colors ' +
                  (precipPeriod === p.key ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
                }
              >{p.label}</button>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // ── Derived, all off rowState/isOn — the single gating authority ─────────
  // A row "counts" only when its parent (requiresLayer) chain is visible too,
  // so a stranded satswarm=on with satellites off never ghosts a chip/badge.
  const rowVisible = (d: LayerRowDef) => !d.requiresLayer || isOn(d.requiresLayer)
  // Every ON registry overlay — feeds the active-now chip row. Registry rows
  // ONLY: basemap choice, Show-on-map toggles and the 3D switches never
  // appear here (and "Clear overlays" never touches them).
  const activeRows = LAYER_ROWS.filter((d) => d.status !== 'coming-soon' && rowVisible(d) && isOn(d.id))
  const groupCount = (gid: GroupId): number =>
    gid === 'basemap'
      ? (threeD ? 1 : 0) + (terrain3d ? 1 : 0)
      : LAYER_ROWS.filter((d) => d.group === gid && d.status !== 'coming-soon' && rowVisible(d) && isOn(d.id)).length
  // Same visibility filters as groupCount/activeRows (ship-check P2): a
  // hidden or coming-soon row's stale error must never amber-badge a group
  // whose visible layers are all healthy.
  const groupErr = (gid: GroupId): boolean =>
    LAYER_ROWS.some((d) => d.group === gid && d.status !== 'coming-soon' && rowVisible(d) && isOn(d.id) && !!feedErr[d.id])
  // Search matches label + hint, case-insensitive — registry layers only
  // (fleet visibility is chips on the map now, not rows in here).
  const q = query.trim().toLowerCase()
  const matchedRows = q
    ? LAYER_ROWS.filter((d) => rowVisible(d) && (d.label.toLowerCase().includes(q) || (d.hint ?? '').toLowerCase().includes(q)))
    : []

  // Collapsed: a compact pill — just Layers + what's-on status icons (the
  // weather readout moved to the top bar, Jul 21). Search rides to its right.
  if (!open) {
    if (hidePill) return null
    return (
      <div style={{ top, zIndex: z }} data-tour="layers" className={`absolute ${sideCls} flex flex-col items-start gap-1.5 ${tuckCls(hidden)}`}>
      <div className="flex items-center gap-2">
      <button
        onClick={() => setOpen(true)}
        aria-label="Map layers"
        className="flex items-center gap-2 rounded-xl bg-navy-950/80 backdrop-blur border border-navy-700 shadow-panel px-3 py-2"
      >
        <Layers className="h-4 w-4 text-faint" />
        <span className="font-display font-bold text-[13px] text-ink hidden sm:inline">Layers</span>
        {/* status icons: what's currently ON — rain cloud = radar looping,
            satellite dish = satellite/hybrid basemap active */}
        {(radarOn || base === 'satellite' || base === 'hybrid') && (
          <span className="flex items-center gap-1">
            {radarOn && <span title="Radar is on"><CloudRain className="h-3.5 w-3.5 text-teal" /></span>}
            {(base === 'satellite' || base === 'hybrid') && <span title="Satellite basemap active"><Satellite className="h-3.5 w-3.5 text-teal" /></span>}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-faint" />
      </button>
      {searchSlot}
      </div>
      </div>
    )
  }

  const renderRow = (d: LayerRowDef) => (
      <LayerRow
        key={d.id}
        def={d}
        on={isOn(d.id)}
        zoom={zoom}
        base={base}
        err={feedErr[d.id]}
        fresh={d.isLive && isOn(d.id) ? stamp(d.id) : null}
        opacity={overlayOpacity[d.id] ?? (d.id === 'precip' ? 0.45 : 0.6)}
        onOpacity={onOverlayOpacity ? (v: number) => onOverlayOpacity(d.id, v) : undefined}
        onToggle={() => toggle(d.id)}
        extra={rowExtra(d.id)}
      />
  )
  const rowsFor = (gid: GroupId) => {
    const rows = LAYER_ROWS
      .filter((d) => d.group === gid)
      // A sub-layer (e.g. the satellite swarm) stays hidden until its parent
      // layer is on — no orphan toggle sitting there doing nothing.
      .filter(rowVisible)
    // Progressive disclosure (Aug 22 declutter): specialist rows wait behind
    // one inline expander. Rows NEVER change sections when toggled (Brian,
    // 4:04 AM — flipping a switch must not move the row); an ON advanced row
    // still renders while the section is collapsed, but stays below the
    // expander in its own slot. Never hide state.
    const everyday = rows.filter((d) => !d.advanced)
    const advanced = rows.filter((d) => d.advanced)
    const showAll = moreRows.has(gid)
    const advVisible = showAll ? advanced : advanced.filter((d) => isOn(d.id))
    const tucked = advanced.length - advVisible.length
    return (
      <>
        {everyday.map(renderRow)}
        {advanced.length > 0 && (
          <button
            onClick={() => setMoreRows((m) => { const n = new Set(m); if (n.has(gid)) n.delete(gid); else n.add(gid); return n })}
            className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-navy-800 text-[11.5px] font-semibold text-faint hover:text-ink transition-colors"
          >
            <ChevronDown className={'h-3 w-3 transition-transform ' + (showAll ? '' : '-rotate-90')} />
            {(gid === 'weather' ? 'Advanced weather' : 'More layers') + (tucked > 0 ? ` (${tucked})` : '')}
          </button>
        )}
        {advVisible.map(renderRow)}
      </>
    )
  }

  return (
    // Outer wrapper exists so the X can straddle the top edge un-clipped —
    // the inner panel scrolls (overflow-y-auto) and would cut it in half.
    // Full-height LEFT DRAWER (Brian, Aug 22: "open from the left similar to
    // what Google Maps does") — backdrop tap closes; the map stays visible
    // to the right of it.
    <div style={{ zIndex: z }} className={`absolute inset-0 ${tuckCls(hidden)}`}>
      <button aria-label="Close layers" onClick={() => setOpen(false)} className="absolute inset-0 w-full h-full bg-black/35 cursor-default" />
      {/* ~half the phone (Brian, Aug 22: "try half screen width") — the map
          stays alive beside the drawer; 320px cap keeps desktop sane. */}
      <div
        onPointerDown={drawerDown}
        onPointerMove={drawerMove}
        onPointerUp={() => { drawerSwipe.current = null }}
        onPointerCancel={() => { drawerSwipe.current = null }}
        onClickCapture={drawerClickCapture}
        // touch-pan-y is what makes the swipe-left-to-close actually FIRE on
        // phones: without it the browser claims any horizontal drag on this
        // scrollable panel (pointercancel before the 48px threshold) — the
        // gesture only ever worked with a mouse (Brian, Aug 24: "swipe to
        // close is currently not working"). pan-y keeps vertical scroll
        // native and hands horizontal drags to the pointer handlers.
        className="absolute left-0 top-0 bottom-0 w-[min(320px,55vw)] bg-navy-950/95 backdrop-blur border-r border-navy-700 shadow-panel overflow-y-auto no-scrollbar ht-drawer-in touch-pan-y"
      >

      {/* Reference-style tabs (Jul 31 redesign): the everyday toggles vs your
          saved looks. Sticky so the tab bar survives the scroll. */}
      <div className="sticky top-0 z-20 flex bg-navy-950/95 backdrop-blur border-b border-navy-800 rounded-t-xl">
        <button
          onClick={() => setTab('layers')}
          className={'flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-display font-bold border-b-2 -mb-px transition-colors ' +
            (tab === 'layers' ? 'border-teal text-ink' : 'border-transparent text-faint hover:text-muted')}
        >
          <Layers className="h-3.5 w-3.5" /> Layers
        </button>
        <button
          onClick={() => setTab('views')}
          className={'flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-display font-bold border-b-2 -mb-px transition-colors ' +
            (tab === 'views' ? 'border-teal text-ink' : 'border-transparent text-faint hover:text-muted')}
        >
          <Bookmark className="h-3.5 w-3.5" /> Views
        </button>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close layers"
          className="flex-none grid place-items-center w-9 border-b-2 border-transparent -mb-px text-faint hover:text-ink transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Something just toggled on and its feed is still downloading — the
          same thin sweep the timeline uses (one loading language everywhere). */}
      {/* z-20: the chip row shares this sticky offset at z-10 and would
          otherwise paint over the sweep exactly while a feed loads. */}
      {pendingFeeds.size > 0 && (
        <div className="sticky top-[37px] z-20 h-[3px] bg-navy-800 overflow-hidden" aria-label="Loading layers">
          <div className="h-full w-1/3 rounded-full bg-teal/80 animate-tl-sweep" />
        </div>
      )}

      {/* Views tab — preset looks + your saved views, promoted from an
          accordion to a first-class tab (the reference tools' "My layers"). */}
      {tab === 'views' && views && onApplyView && (
        <div>
          {/* Same row + switch language as the Layers tab (owner ask, Aug 5):
              a view is a look you turn ON — and only one can be on at a time. */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">One tap to a whole look</span>
            {onSaveView && !savingView && (
              <button
                onClick={() => setSavingView(true)}
                className="flex items-center gap-1 rounded-md bg-amber text-[#1a1100] font-display font-bold text-[10.5px] px-2 py-1 hover:bg-amber-600 transition-colors"
              >
                <Plus className="h-3 w-3" /> Save current
              </button>
            )}
          </div>
          {savingView && (
            <form onSubmit={submitSaveView} className="flex items-center gap-1 px-3 pb-2">
              <input
                autoFocus
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="Name this view…"
                className="flex-1 min-w-0 bg-navy-900 border border-navy-700 rounded-md px-2 py-1 text-[11px] text-ink placeholder:text-faint outline-none"
              />
              <button type="submit" title="Save view" className="grid place-items-center w-6 h-6 rounded-md bg-teal/20 text-teal flex-none">
                <Check className="h-3 w-3" />
              </button>
            </form>
          )}
          {views.map((v) => {
            const active = activeViewId === v.id
            return (
              <div key={v.id} className="border-t border-navy-800">
                <div className="flex items-center hover:bg-navy-900 transition-colors">
                  <button
                    onClick={() => onApplyView(v.id)}
                    className="flex-1 min-w-0 overflow-hidden flex items-center gap-1.5 px-3 py-2 text-left"
                  >
                    <span className={'block min-w-0 text-[12px] font-semibold truncate ' + (active ? 'text-ink' : 'text-faint')}>{v.name}</span>
                    {defaultViewId === v.id && <Star className="h-3 w-3 flex-none fill-current text-amber" />}
                  </button>
                  {/* Personal views get an inline × (two-tap confirm) — presets
                      ship with the app and can't be removed. */}
                  {!v.preset && onDeleteView && (
                    <button
                      onClick={() => { if (confirmDelId === v.id) { onDeleteView(v.id); setConfirmDelId(null) } else setConfirmDelId(v.id) }}
                      onBlur={() => setConfirmDelId((c) => (c === v.id ? null : c))}
                      title={confirmDelId === v.id ? 'Tap again to delete' : `Delete "${v.name}"`}
                      className={'grid place-items-center px-1.5 py-2 flex-none ' + (confirmDelId === v.id ? 'text-alert' : 'text-faint/60 hover:text-alert')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* flex on the button matters: Toggle's w-9 span only sizes
                      as a flex item — inline it collapses to just the knob. */}
                  <button onClick={() => onApplyView(v.id)} className="flex items-center pr-3 pl-1 py-2 flex-none shrink-0" aria-label={`Apply view ${v.name}`}>
                    <Toggle on={active} />
                  </button>
                </div>
                {active && (
                  <div className="flex items-center gap-3 px-3 pb-2 -mt-0.5">
                    {onSetDefaultView && (
                      <button
                        onClick={() => onSetDefaultView(v.id)}
                        className={
                          'flex items-center gap-1 text-[10.5px] font-semibold transition-colors ' +
                          (defaultViewId === v.id ? 'text-amber' : 'text-faint hover:text-amber')
                        }
                      >
                        <Star className={'h-3 w-3' + (defaultViewId === v.id ? ' fill-current' : '')} />
                        {defaultViewId === v.id ? 'Opens with this view' : 'Use on open'}
                      </button>
                    )}
                    {/* Personal views can be re-saved in place (Brian, Aug 22):
                        tweak the layers, then stamp the view with the new
                        look. Presets ship with the app and never change. */}
                    {!v.preset && onUpdateView && (
                      <button
                        onClick={() => onUpdateView(v.id)}
                        className="flex items-center gap-1 text-[10.5px] font-semibold text-faint hover:text-teal transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Overwrite with current look
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Layers tab (Aug 22: context-only — fleet visibility moved to the
             chips under the collapsed pill): search → active-now chips →
             Map look (basemap strip + 3D + Labels) → My sites · Weather ·
             Roads & travel · Land check · Sky & extras, all collapsible. ── */}
      {tab === 'layers' && (<>

      {/* Find a layer — filters the registry by label + hint; while typing,
          the groups flatten to one matched list with group-name prefixes. */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-1.5 bg-navy-900 border border-navy-800 rounded-lg px-2 py-1.5">
          <Search className="h-3 w-3 text-faint flex-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a layer…"
            aria-label="Find a layer"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-ink placeholder:text-faint outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear layer search" className="grid place-items-center flex-none text-faint hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Active now — every ON registry overlay as a chip, × turns it off.
          Sticky so what's-on stays in sight while the list scrolls. Registry
          overlays ONLY: basemap, Show-on-map and 3D never appear here. */}
      {activeRows.length > 0 && (
        <div className="sticky top-[37px] z-10 flex flex-nowrap items-center gap-1 px-2 py-1.5 bg-navy-950/95 backdrop-blur border-b border-navy-800 overflow-x-auto no-scrollbar">
          {/* The WHOLE chip is the dismiss button (ship-check P2) — a bare
              14px × was a precision tap for gloved thumbs, with near-misses
              landing on the neighbor chip. Single-line scroll keeps a stack
              of overlays from eating the list height. */}
          {activeRows.map((d) => (
            <button key={d.id} onClick={() => toggle(d.id)} aria-label={`Turn off ${d.label}`} className="flex flex-none items-center gap-1 rounded-full bg-teal/15 border border-teal/30 pl-2 pr-1.5 py-1 font-mono text-[10px] text-teal hover:bg-teal/25 transition-colors whitespace-nowrap">
              {d.label.replace(/^↳ /, '')}
              <X className="h-2.5 w-2.5 flex-none" />
            </button>
          ))}
          {activeRows.length >= 2 && (
            <button
              onClick={() => activeRows.forEach((d) => toggle(d.id))}
              className="flex-none rounded-full border border-navy-700 px-2 py-1 font-mono text-[10px] text-faint hover:text-ink transition-colors whitespace-nowrap"
            >
              Clear overlays
            </button>
          )}
        </div>
      )}

      {q ? (
        /* Search active: groups flatten to one matched list with tiny
           group-name prefixes. Show-on-map rows deliberately excluded. */
        matchedRows.length === 0 ? (
          <p className="px-3 py-3 border-t border-navy-800 text-[11px] text-faint">No layers match “{query.trim()}”.</p>
        ) : (
          matchedRows.map((d) => (
            <div key={d.id}>
              <p className="px-3 pt-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-faint/70">{GROUPS.find((g) => g.id === d.group)?.label}</p>
              <LayerRow
                def={d}
                on={isOn(d.id)}
                zoom={zoom}
                base={base}
                err={feedErr[d.id]}
                fresh={d.isLive && isOn(d.id) ? stamp(d.id) : null}
                opacity={overlayOpacity[d.id] ?? (d.id === 'precip' ? 0.45 : 0.6)}
                onOpacity={onOverlayOpacity ? (v: number) => onOverlayOpacity(d.id, v) : undefined}
                onToggle={() => toggle(d.id)}
                extra={rowExtra(d.id)}
              />
            </div>
          ))
        )
      ) : (<>

      {/* ── Assets — the fleet on/off dropdown, FIRST (Brian, Aug 22: same
             collapsible treatment as every other group). ── */}
      {filter && onFilter && (
        <>
          <button
            onClick={() => setFleetOpen((o) => !o)}
            aria-expanded={fleetOpen}
            className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-navy-800 bg-navy-900/70 hover:bg-navy-800 transition-colors"
          >
            <Box className="h-3 w-3 text-teal flex-none" />
            <span className="flex-1 min-w-0 truncate text-left font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Assets</span>
            {(filter.size + (onShowZones && showZones ? 1 : 0) + (onToggleDevices && showDevices ? 1 : 0)) > 0 && (
              <span className="flex-none font-mono text-[9px] rounded px-1.5 py-0.5 bg-teal/20 text-teal">
                {filter.size + (onShowZones && showZones ? 1 : 0) + (onToggleDevices && showDevices ? 1 : 0)} on
              </span>
            )}
            <ChevronDown className={'h-3 w-3 text-faint flex-none transition-transform ' + (fleetOpen ? '' : '-rotate-90')} />
          </button>
          {fleetOpen && (<>
          {([
            ['vehicle', '🚛', 'Vehicles'],
            ['equipment', '🏗️', 'Equipment'],
            ['personnel', '👷', 'People'],
            ['tool', '🔧', 'Tools'],
          ] as [AssetType, string, string][]).map(([t, emoji, label]) => {
            const on = filter.has(t)
            return (
              <div key={t} className="border-t border-navy-800 first:border-t-0">
                <button
                  onClick={() => {
                    const next = new Set(filter)
                    if (on) next.delete(t); else next.add(t)
                    onFilter(next)
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-navy-900 transition-colors"
                >
                  <span className={'text-[13px] font-semibold flex items-center gap-2 ' + (on ? 'text-ink' : 'text-faint')}>
                    <span>{emoji}</span>{label}
                  </span>
                  <Toggle on={on} />
                </button>
              </div>
            )
          })}
          {onShowZones && (
            <div className="border-t border-navy-800">
              <button
                onClick={() => onShowZones(!showZones)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-navy-900 transition-colors"
              >
                <span className={'text-[13px] font-semibold flex items-center gap-2 ' + (showZones ? 'text-ink' : 'text-faint')}>
                  <Hexagon className={'h-3.5 w-3.5 ' + (showZones ? 'text-amber' : 'text-faint')} /> Zones
                </span>
                <Toggle on={showZones} />
              </button>
            </div>
          )}
          {onToggleDevices && (
            <div className="border-t border-navy-800">
              <button
                onClick={onToggleDevices}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-navy-900 transition-colors"
              >
                <span className={'text-[13px] font-semibold flex items-center gap-2 ' + (showDevices ? 'text-ink' : 'text-faint')}>
                  <Cctv className={'h-3.5 w-3.5 ' + (showDevices ? 'text-teal' : 'text-faint')} /> Site IoT
                </span>
                <Toggle on={showDevices} />
              </button>
            </div>
          )}
          {/* Name labels ride with the assets they name (Brian, Aug 22). */}
          {onShowLabels && (
            <div className="border-t border-navy-800">
              <button
                onClick={() => onShowLabels(!showLabels)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-navy-900 transition-colors"
              >
                <span className={'text-[13px] font-semibold flex items-center gap-2 ' + (showLabels ? 'text-ink' : 'text-faint')}>
                  <Type className={'h-3.5 w-3.5 ' + (showLabels ? 'text-teal' : 'text-faint')} /> Labels
                </span>
                <Toggle on={showLabels} />
              </button>
            </div>
          )}
          </>)}
        </>
      )}

      {/* ── Map look: the basemap thumb strip (everyday 6 + More) and the 3D
             switches — they change how the map LOOKS, not what's on it. ── */}
      <GroupHeader gid="basemap" open={openGroups.has('basemap')} count={groupCount('basemap')} hasErr={false} onToggle={() => toggleGroup('basemap')} />
      {openGroups.has('basemap') && (<>
      {/* One swipe row of real tile thumbnails. */}
      <div className="flex gap-1.5 px-2 pt-1 pb-2 overflow-x-auto no-scrollbar">
        {(stripAll ? BASEMAPS : BASEMAPS.slice(0, 6)).map((b) => (
          <button
            key={b.id}
            onClick={() => onBase(b.id)}
            className={
              'relative flex-none w-[54px] h-[54px] rounded-lg overflow-hidden border transition-all ' +
              (base === b.id ? 'border-amber ring-2 ring-amber/50' : 'border-navy-700 hover:border-navy-500')
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BASEMAP_TILE[b.id]}
              alt={b.label}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
              style={BASEMAP_THUMB_FILTER[b.id] ? { filter: BASEMAP_THUMB_FILTER[b.id] } : undefined}
            />
            {b.id === 'hybrid' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={BASEMAP_TILE.dark} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-35 mix-blend-screen" />
            )}
            <span className={
              'absolute inset-x-0 bottom-0 text-[8.5px] font-semibold text-center py-0.5 ' +
              (base === b.id ? 'bg-amber/90 text-[#1a1100]' : 'bg-black/55 text-white')
            }>
              {b.label}
            </span>
          </button>
        ))}
        {/* Everyday 6 up front; the specialty set (Plain, B/W, Aubergine,
            Night, VFR, IFR) lives behind More. While the ACTIVE basemap is a
            specialty one the strip is force-expanded and the tile hides —
            collapsing would hide the highlighted thumb. */}
        {!specialtyBase && (
          <button
            onClick={() => setMoreBasemaps((m) => !m)}
            className="flex-none w-[54px] h-[54px] rounded-lg border border-navy-700 hover:border-navy-500 bg-navy-900 grid place-items-center transition-all"
          >
            <span className="text-[9px] font-semibold text-faint text-center leading-tight">
              {moreBasemaps ? 'Less' : `+${BASEMAPS.length - 6} More`}
            </span>
          </button>
        )}
      </div>
      {/* New zone moved to the map's right-side control rail (Aug 6) —
          drawing is a map action, this panel is what-you-see toggles. */}
      {/* Sunlight mode — noon-in-the-truck contrast boost (8c-f) */}
      {onSunMode && (
        <div className="border-t border-navy-800">
          <button onClick={() => onSunMode(!sunMode)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-navy-900 transition-colors">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <Sun className={'h-4 w-4 ' + (sunMode ? 'text-amber' : 'text-faint')} /> Sunlight mode
            </span>
            <Toggle on={sunMode} />
          </button>
          {sunMode && (
            <p className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">
              brighter, harder contrast — for reading the map in direct sun
            </p>
          )}
        </div>
      )}
      {/* 3D buildings + tilt — layerable on any basemap */}
      <div className="border-t border-navy-800">
        <button onClick={() => onThreeD(!threeD)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-navy-900 transition-colors">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
            <Box className={'h-4 w-4 ' + (threeD ? 'text-teal' : 'text-faint')} /> 3D buildings &amp; tilt
          </span>
          <Toggle on={threeD} />
        </button>
        {threeD && (
          <p className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">
            tilt: right-click + drag on PC · two-finger drag on mobile
          </p>
        )}
      </div>
      {/* 3D terrain — split from buildings & tilt (Jul 21): the DEM relief
          is the heavy half, so it's its own opt-in. */}
      {onTerrain3d && (
        <div className="border-t border-navy-800">
          <button onClick={() => onTerrain3d(!terrain3d)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-navy-900 transition-colors">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <Waves className={'h-4 w-4 ' + (terrain3d ? 'text-teal' : 'text-faint')} /> 3D terrain (real elevation)
            </span>
            <Toggle on={terrain3d} />
          </button>
          {terrain3d && (
            <div className="px-3 pb-2 -mt-0.5 space-y-1.5">
              <p className="font-mono text-[10px] text-teal">
                mountains rise · measure reads elevation · map renders lighter while this is on
              </p>
              {onTerrainExag && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-faint flex-none w-16">height ×{(terrainExag ?? 1.3).toFixed(1)}</span>
                    <input
                      type="range" min={5} max={40}
                      value={Math.round((terrainExag ?? 1.3) * 10)}
                      onChange={(e) => onTerrainExag(Number(e.target.value) / 10)}
                      className="flex-1 h-1 accent-teal cursor-pointer"
                      aria-label="Terrain vertical exaggeration"
                    />
                    <button
                      onClick={() => onTerrainExag(1.3)}
                      className="font-mono text-[9px] text-faint hover:text-ink transition-colors flex-none"
                      title="Back to natural (×1.3)"
                    >
                      reset
                    </button>
                  </div>
                  <p className="font-mono text-[10px] text-faint">
                    crank it on flat ground — creeks, ditches and grades pop
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      </>)}

      {/* ── The registry groups, in owner order: My sites · Weather ·
             Roads & travel · Land check · Sky & extras. Each header is a
             collapsible button with a "N on" badge; rowState stays the only
             gating authority for the rows inside. ── */}
      {GROUPS.filter((g) => g.id !== 'basemap').map((g) => (
        <div key={g.id}>
          <GroupHeader gid={g.id} open={openGroups.has(g.id)} count={groupCount(g.id)} hasErr={groupErr(g.id)} onToggle={() => toggleGroup(g.id)} />
          {openGroups.has(g.id) && (<>
            {/* Land-development blurb removed (Brian, Aug 22): "not really
                the use case for this app yet" — the rows speak for themselves. */}
            {rowsFor(g.id)}
            {/* Earth's real rotation needs no switch: with Satellites & sky
                on, the globe simply turns with the timeline clock. */}
            {g.id === 'sky' && isOn('satellites') && (
              <p className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">
                ↳ zoom out to the globe — Earth turns in real time (and with the timeline in replays)
              </p>
            )}
          </>)}
        </div>
      ))}
      </>)}

      {onResetLayers && (
        <button
          onClick={onResetLayers}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-t border-navy-800 text-[11px] font-semibold text-faint hover:text-ink transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Reset layers to defaults
        </button>
      )}
      {/* honest bandwidth note — radar/clouds/overlays are live streams */}
      <p className="px-3 py-2 border-t border-navy-800 text-[10px] text-faint leading-relaxed">
        More layers = more live data. On weak job-site signal, turn a few off
        and the map loads noticeably faster.
      </p>
      </>)}
      </div>
    </div>
  )
}
