'use client'

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { ProtrudingClose } from '@/components/ui/window-chrome'
import { CloudRain, Map as MapIcon, Satellite, Layers, ChevronDown, Box, Star, Check, Waves, Pause, Play, Hexagon, RotateCcw, Plus, Cctv, Bookmark, X } from 'lucide-react'
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
  /** Zones visibility (mirrors the chip; zones are site CONTEXT, so they also
   *  live here per the layers spec). */
  showZones?: boolean
  onShowZones?: (v: boolean) => void
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
  onDeleteView?: (id: string) => void
  onSetDefaultView?: (id: string) => void
  top?: number
  z?: number
  /** Which screen edge the pill/panel hugs. Live map = right; kiosk = left. */
  side?: 'left' | 'right'
  /** Asset-type visibility (the old chip row, folded in here). */
  filter?: Set<AssetType>
  onFilter?: (f: Set<AssetType>) => void
  /** Demo-only Site IoT toggle. */
  showDevices?: boolean
  onToggleDevices?: () => void
  /** Rendered to the RIGHT of the collapsed pill (the map search button). */
  searchSlot?: ReactNode
}

function Toggle({ on, disabled = false }: { on: boolean; disabled?: boolean }) {
  return (
    <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (on && !disabled ? 'bg-teal/40' : 'bg-navy-700') + (disabled ? ' opacity-50' : '')}>
      <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (on && !disabled ? 'left-[18px]' : 'left-0.5')} />
    </span>
  )
}

const GROUP_ICON: Record<GroupId, typeof Hexagon> = {
  site: Hexagon,
  weather: CloudRain,
  water: Waves,
  basemap: MapIcon,
  advanced: Satellite,
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
  const dim = st.disabled || (!!st.reason && !comingSoon)
  return (
    <div className="border-t border-navy-800 first:border-t-0">
      <button
        onClick={() => { if (!st.disabled) onToggle() }}
        disabled={st.disabled}
        className={'w-full flex items-center justify-between gap-2 px-3 py-2 transition-colors ' + (st.disabled ? 'cursor-not-allowed' : 'hover:bg-navy-900')}
      >
        <span className={'text-[12px] font-semibold ' + (dim ? 'text-faint' : 'text-ink')}>{def.label}</span>
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
      {st.on && !st.disabled && !st.reason && def.hint && (
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

/** Flat, always-open section heading — the panel scrolls, sections don't hide. */
function SectionLabel({ gid, label, icon }: { gid?: GroupId; label?: string; icon?: typeof Hexagon }) {
  const g = gid ? GROUPS.find((x) => x.id === gid) : null
  const Icon = icon ?? (gid ? GROUP_ICON[gid] : Hexagon)
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1 border-t border-navy-800">
      <Icon className="h-3 w-3 text-teal flex-none" />
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{label ?? g?.label}</span>
    </div>
  )
}

const STALE_MS = 15 * 60_000

export function WeatherControl({ base, onBase, threeD, onThreeD, terrain3d = false, onTerrain3d, terrainExag = 1.3, onTerrainExag, radarOn, onRadar, radarPaused = false, onRadarPause, cloudsOn = false, onClouds, stormTopsOn = false, onStormTops, precipOn = false, onPrecip, precipPeriod = '24h', onPrecipPeriod, frameTime, parcelsOn = false, onParcels, overlays, onOverlay, showZones = true, onShowZones, zoom = 10, overlayOpacity = {}, onOverlayOpacity, onResetLayers, views, activeViewId = null, defaultViewId = null, onApplyView, onSaveView, onDeleteView, onSetDefaultView, top = 58, z = 10, side = 'left', filter, onFilter, showDevices = false, onToggleDevices, searchSlot }: WeatherControlProps) {
  const [open, setOpen] = useState(false)
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
  // ── Panel tabs: Layers (every toggle, flat + scannable) | Views (saved
  //    looks). Accordions are gone — the redesign references (Jul 31) all show
  //    their content instead of closed doors; one scroll beats six chevrons.
  const [tab, setTab] = useState<'layers' | 'views'>('layers')

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
      case 'zones': return showZones
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
      case 'zones': return onShowZones?.(!showZones)
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


  // Collapsed: a compact pill — just Layers + what's-on status icons (the
  // weather readout moved to the top bar, Jul 21). Search rides to its right.
  if (!open) {
    return (
      <div style={{ top, zIndex: z }} data-tour="layers" className={`absolute ${sideCls} flex items-center gap-2`}>
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
    )
  }

  const rowsFor = (gid: GroupId, nightFx = false) =>
    LAYER_ROWS
      .filter((d) => d.group === gid && !!d.nightFx === nightFx)
      // A sub-layer (e.g. the satellite swarm) stays hidden until its parent
      // layer is on — no orphan toggle sitting there doing nothing.
      .filter((d) => !d.requiresLayer || isOn(d.requiresLayer))
      .map((d) => (
      <LayerRow
        key={d.id}
        def={d}
        on={isOn(d.id)}
        zoom={zoom}
        base={base}
        err={feedErr[d.id]}
        fresh={d.isLive && isOn(d.id) ? stamp(d.id) : null}
        opacity={overlayOpacity[d.id] ?? 0.6}
        onOpacity={onOverlayOpacity ? (v: number) => onOverlayOpacity(d.id, v) : undefined}
        onToggle={() => toggle(d.id)}
        extra={rowExtra(d.id)}
      />
    ))

  return (
    // Outer wrapper exists so the X can straddle the top edge un-clipped —
    // the inner panel scrolls (overflow-y-auto) and would cut it in half.
    <div style={{ top, zIndex: z }} className={`absolute ${sideCls} w-[236px]`}>
      <ProtrudingClose onClick={() => setOpen(false)} title="Minimize layers" />
      <div className="rounded-xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-y-auto no-scrollbar max-h-[min(560px,calc(100dvh-380px))] md:max-h-[min(640px,calc(100dvh-200px))]">

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
      </div>

      {/* Something just toggled on and its feed is still downloading — the
          same thin sweep the timeline uses (one loading language everywhere). */}
      {pendingFeeds.size > 0 && (
        <div className="sticky top-[37px] z-10 h-[3px] bg-navy-800 overflow-hidden" aria-label="Loading layers">
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
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">One tap to a whole look</span>
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
                {active && onSetDefaultView && (
                  <button
                    onClick={() => onSetDefaultView(v.id)}
                    className={
                      'flex items-center gap-1 px-3 pb-2 -mt-0.5 text-[10.5px] font-semibold transition-colors ' +
                      (defaultViewId === v.id ? 'text-amber' : 'text-faint hover:text-amber')
                    }
                  >
                    <Star className={'h-3 w-3' + (defaultViewId === v.id ? ' fill-current' : '')} />
                    {defaultViewId === v.id ? 'Opens with this view' : 'Use on open'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Layers tab: flat, scannable sections — Basemap first (owner ask,
             Aug 5), New zone right under it, then Show-on-map toggles,
             then Site · Weather · 3D · Water & Terrain · Advanced. ── */}
      {tab === 'layers' && (<>
      <SectionLabel gid="basemap" />
      {/* One swipe row of real tile thumbnails — the most-used control no
          longer lives behind a door. */}
      <div className="flex gap-1.5 px-2 pt-1 pb-2 overflow-x-auto no-scrollbar">
        {BASEMAPS.map((b) => (
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
      </div>
      {/* New zone moved to the map's right-side control rail (Aug 6) —
          drawing is a map action, this panel is what-you-see toggles. */}

      {/* ── Show on map — asset types as the same toggle rows as every other
             layer (the old chip grid read as buttons, not switches). ── */}
      {filter && onFilter && (
        <>
          <SectionLabel label="Show on map" icon={Layers} />
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
                  <span className={'text-[12px] font-semibold flex items-center gap-2 ' + (on ? 'text-ink' : 'text-faint')}>
                    <span>{emoji}</span>{label}
                  </span>
                  <Toggle on={on} />
                </button>
              </div>
            )
          })}
          {onToggleDevices && (
            <div className="border-t border-navy-800">
              <button
                onClick={onToggleDevices}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-navy-900 transition-colors"
              >
                <span className={'text-[12px] font-semibold flex items-center gap-2 ' + (showDevices ? 'text-ink' : 'text-faint')}>
                  <Cctv className={'h-3.5 w-3.5 ' + (showDevices ? 'text-teal' : 'text-faint')} /> Site IoT
                </span>
                <Toggle on={showDevices} />
              </button>
            </div>
          )}
        </>
      )}

      <SectionLabel gid="site" />
      {rowsFor('site')}

      <SectionLabel gid="weather" />
        {/* Location + home-station readout moved to the TOP BAR dropdown —
            tap the temperature (owner ask, Aug 5). Only actual layers here. */}
        {rowsFor('weather')}

      <SectionLabel label="3D" icon={Box} />
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

      <SectionLabel gid="water" />
      {rowsFor('water')}

      {/* ── Advanced: satellites, aircraft, night effects — the show-off
             layers at the bottom of the scroll. Earth's real rotation needs
             no switch: with Satellites & sky on, the globe simply turns with
             the timeline clock. ── */}
      <SectionLabel gid="advanced" />
      {rowsFor('advanced')}
      {isOn('satellites') && (
        <p className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">
          ↳ zoom out to the globe — Earth turns in real time (and with the timeline in replays)
        </p>
      )}
      {/* Night effects — nested; greyed with the reason unless basemap = Dark */}
      <div className="border-t border-navy-800">
        <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Night effects</p>
        {rowsFor('advanced', true)}
      </div>

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
