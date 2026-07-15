'use client'

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { ProtrudingClose } from '@/components/ui/window-chrome'
import { CloudRain, Wind, Zap, Map as MapIcon, Satellite, Layers, ChevronDown, ChevronRight, MapPin, Box, Signpost, Globe2, Search, Star, Check, Waves, Home, Pause, Play, Hexagon, RotateCcw, Plus, Cctv, Bookmark } from 'lucide-react'
import { type Conditions, weatherEmoji, PRECIP_PERIODS } from '@/lib/weather'
import type { PwsConditions } from '@/lib/pws'
import type { SavedMapView } from '@/lib/map-views'
import type { AssetType } from '@/lib/types'
import type { SearchItem } from './MapSearch'
import { GROUPS, BASEMAPS, LAYER_ROWS, rowState, type GroupId, type LayerRowDef, type BasemapId } from '@/lib/map-layers'

export type BaseStyle = BasemapId

interface WeatherControlProps {
  base: BaseStyle
  onBase: (b: BaseStyle) => void
  /** 3D buildings + tilt — an independent toggle layerable on any basemap. */
  threeD: boolean
  onThreeD: (v: boolean) => void
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
  conditions: Conditions | null
  pws?: PwsConditions | null
  frameTime: string | null
  place?: string
  onPlaceChange?: (name: string, lat?: number, lng?: number) => void
  onSaveDefault?: (place: string) => Promise<boolean | void>
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
  /** Start drawing a new zone. */
  onDrawZone?: () => void
  /** Demo-only Site IoT toggle. */
  showDevices?: boolean
  onToggleDevices?: () => void
  /** Find an asset or zone from inside the panel — full list on focus,
   *  filters as you type (or dictate via the keyboard mic). */
  searchItems?: SearchItem[]
  onPickItem?: (it: SearchItem) => void
  /** Rendered to the RIGHT of the collapsed pill (the map search button). */
  searchSlot?: ReactNode
}

/** "2m ago" style age for the station reading — stations report every 16s–5min. */
function pwsAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'live'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors ' +
        (active ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
      }
    >
      {children}
    </button>
  )
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
}

// v2: everything defaults collapsed (owner ask Jul 14) — new key so stored
// v1 expanded-states don't override the new default.
const GROUPS_LS = 'ht_layer_groups_v2'
const STALE_MS = 15 * 60_000

export function WeatherControl({ base, onBase, threeD, onThreeD, radarOn, onRadar, radarPaused = false, onRadarPause, cloudsOn = false, onClouds, stormTopsOn = false, onStormTops, precipOn = false, onPrecip, precipPeriod = '24h', onPrecipPeriod, conditions, pws = null, frameTime, place, onPlaceChange, onSaveDefault, parcelsOn = false, onParcels, overlays, onOverlay, showZones = true, onShowZones, zoom = 10, overlayOpacity = {}, onOverlayOpacity, onResetLayers, views, activeViewId = null, defaultViewId = null, onApplyView, onSaveView, onDeleteView, onSetDefaultView, top = 58, z = 10, side = 'left', filter, onFilter, onDrawZone, showDevices = false, onToggleDevices, searchItems, onPickItem, searchSlot }: WeatherControlProps) {
  const [open, setOpen] = useState(false)
  const sideCls = side === 'right' ? 'right-3' : 'left-3'
  // Find-anything (assets + zones) inside the panel.
  const [findQ, setFindQ] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const activeView = views?.find((v) => v.id === activeViewId) ?? null
  const submitSaveView = (e: React.FormEvent) => {
    e.preventDefault()
    onSaveView?.(viewName)
    setViewName('')
    setSavingView(false)
  }
  const [placeInput, setPlaceInput] = useState(place ?? '')
  useEffect(() => { setPlaceInput(place ?? '') }, [place])
  const temp = conditions ? `${weatherEmoji(conditions.code)} ${conditions.tempF}°` : null

  // Live place autocomplete (free geocoder), debounced.
  type Place = { name: string; admin1?: string; country_code?: string; latitude?: number; longitude?: number }
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [sugOpen, setSugOpen] = useState(false)
  useEffect(() => {
    const q = placeInput.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const id = setTimeout(() => {
      fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) => setSuggestions(Array.isArray(j?.results) ? j.results : []))
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(id)
  }, [placeInput])
  const placeLabel = (s: Place) => [s.name, s.admin1, s.country_code].filter(Boolean).join(', ')
  const pickPlace = (s: Place) => {
    setSugOpen(false)
    setSuggestions([])
    onPlaceChange?.([s.name, s.admin1].filter(Boolean).join(', '), s.latitude, s.longitude)
  }

  const [savedDefault, setSavedDefault] = useState(false)
  const saveDefault = async () => {
    if (!place || !onSaveDefault) return
    try { await onSaveDefault(place) } catch { /* handled upstream */ }
    setSavedDefault(true)
    setTimeout(() => setSavedDefault(false), 2000)
  }

  const submitPlace = (e: React.FormEvent) => {
    e.preventDefault()
    setSugOpen(false)
    const v = placeInput.trim()
    if (v && onPlaceChange) onPlaceChange(v)
  }

  // ── Collapsible groups, persisted per device ──────────────────────────────
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = { views: true }
    for (const g of GROUPS) init[g.id] = !!g.defaultCollapsed
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(GROUPS_LS) : null
      if (raw) Object.assign(init, JSON.parse(raw))
    } catch { /* fresh device */ }
    return init
  })
  const toggleGroup = (gid: GroupId | 'views') => {
    setCollapsed((c) => {
      const next = { ...c, [gid]: !c[gid] }
      try { localStorage.setItem(GROUPS_LS, JSON.stringify(next)) } catch { /* full */ }
      return next
    })
  }

  // ── Feed freshness: layer effects broadcast when they fetch ───────────────
  const [feedAt, setFeedAt] = useState<Record<string, number>>({})
  // Layer effects report failures here (missing key, dead feed, tiles not
  // rendering) — the row says WHY instead of sitting silently empty.
  const [feedErr, setFeedErr] = useState<Record<string, string>>({})
  const [, setTick] = useState(0)
  useEffect(() => {
    const onUpd = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; at: number }>).detail
      if (!d?.key) return
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
      if (d?.key && d?.msg) setFeedErr((f) => ({ ...f, [d.key]: d.msg }))
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

  function LayerRow({ def }: { def: LayerRowDef }) {
    const st = rowState(def, isOn(def.id), zoom, base)
    const comingSoon = def.status === 'coming-soon'
    const dim = st.disabled || (!!st.reason && !comingSoon)
    const fresh = def.isLive && st.on ? stamp(def.id) : null
    return (
      <div className="border-t border-navy-800 first:border-t-0">
        <button
          onClick={() => { if (!st.disabled) toggle(def.id) }}
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
        {st.on && !st.disabled && feedErr[def.id] && (
          <p className="px-3 pb-1.5 -mt-1 text-[10px] font-mono text-amber">⚠ {feedErr[def.id]}</p>
        )}
        {st.on && !st.disabled && !st.reason && def.hint && (
          <p className="px-3 pb-1.5 -mt-1 font-mono text-[10px] text-teal">
            {def.hint}
            {fresh && <span className={'ml-1.5 ' + (fresh.stale ? 'text-amber' : 'text-faint')}>{fresh.text}</span>}
          </p>
        )}
        {st.on && !st.disabled && def.hasOpacity && onOverlayOpacity && (
          <div className="px-3 pb-2 flex items-center gap-2">
            <span className="font-mono text-[9px] text-faint flex-none">opacity</span>
            <input
              type="range" min={15} max={100}
              value={Math.round((overlayOpacity[def.id] ?? 0.6) * 100)}
              onChange={(e) => onOverlayOpacity(def.id, Number(e.target.value) / 100)}
              className="flex-1 h-1 accent-teal cursor-pointer"
            />
          </div>
        )}
        {rowExtra(def.id)}
      </div>
    )
  }

  function Group({ gid, children }: { gid: GroupId; children: ReactNode }) {
    const g = GROUPS.find((x) => x.id === gid)!
    const Icon = GROUP_ICON[gid]
    const isCollapsed = !!collapsed[gid]
    return (
      <div className="border-b border-navy-800">
        <button onClick={() => toggleGroup(gid)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-navy-900 transition-colors">
          <Icon className="h-3.5 w-3.5 text-teal flex-none" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted flex-1 text-left">{g.label}</span>
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-faint" />}
        </button>
        {!isCollapsed && children}
      </div>
    )
  }

  // Collapsed: a compact pill — keeps the at-a-glance temp, hides the toggles.
  // The map search button rides to its right (owner layout, Jul 14 PM).
  if (!open) {
    return (
      <div style={{ top, zIndex: z }} className={`absolute ${sideCls} flex items-center gap-2`}>
      <button
        onClick={() => setOpen(true)}
        aria-label="Map layers and weather"
        className="flex items-center gap-2 rounded-xl bg-navy-950/80 backdrop-blur border border-navy-700 shadow-panel px-3 py-2"
      >
        {temp ? <span className="font-display font-bold text-[14px] text-ink">{temp}</span> : <Layers className="h-4 w-4 text-faint" />}
        {pws && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-amber" title={`${pws.station} — home station`}>
            <Home className="h-3 w-3" />{pws.tempF}°
          </span>
        )}
        {/* status icons: what's currently ON — rain cloud = radar looping,
            satellite dish = satellite/hybrid basemap active */}
        {(radarOn || base === 'satellite' || base === 'hybrid') && (
          <span className="flex items-center gap-1">
            {radarOn && <span title="Radar is on"><CloudRain className="h-3.5 w-3.5 text-teal" /></span>}
            {(base === 'satellite' || base === 'hybrid') && <span title="Satellite basemap active"><Satellite className="h-3.5 w-3.5 text-teal" /></span>}
          </span>
        )}
        <span className="flex items-center gap-0.5 text-faint">
          <Layers className="h-3.5 w-3.5" />
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
      {searchSlot}
      </div>
    )
  }

  const rowsFor = (gid: GroupId, nightFx = false) =>
    LAYER_ROWS.filter((d) => d.group === gid && !!d.nightFx === nightFx).map((d) => <LayerRow key={d.id} def={d} />)

  return (
    // Outer wrapper exists so the X can straddle the top edge un-clipped —
    // the inner panel scrolls (overflow-y-auto) and would cut it in half.
    <div style={{ top, zIndex: z }} className={`absolute ${sideCls} w-[224px]`}>
      <ProtrudingClose onClick={() => setOpen(false)} title="Minimize layers" />
      <div className="rounded-xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-y-auto no-scrollbar max-h-[min(560px,calc(100dvh-380px))] md:max-h-[min(640px,calc(100dvh-200px))]">

      {/* ── Find an asset or zone — full list on focus, filters as you type ── */}
      {searchItems && onPickItem && (() => {
        const q = findQ.trim().toLowerCase()
        const TYPE_ORDER: Record<string, number> = { vehicle: 0, equipment: 1, personnel: 2, tool: 3 }
        const match = (it: SearchItem) => !q || it.name.toLowerCase().includes(q)
        const assets = searchItems.filter((i) => i.kind === 'asset' && match(i))
          .sort((a, b) => (TYPE_ORDER[a.type ?? ''] ?? 9) - (TYPE_ORDER[b.type ?? ''] ?? 9) || a.name.localeCompare(b.name))
        const zones = searchItems.filter((i) => i.kind === 'zone' && match(i)).sort((a, b) => a.name.localeCompare(b.name))
        const pick = (it: SearchItem) => { onPickItem(it); setFindQ(''); setFindOpen(false); setOpen(false) }
        const row = (it: SearchItem) => (
          <button
            key={`${it.kind}-${it.id}`}
            onMouseDown={(e) => { e.preventDefault(); pick(it) }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-navy-800 hover:text-ink transition-colors"
          >
            {it.kind === 'zone'
              ? <Hexagon className="h-3 w-3 flex-none" style={{ color: it.color ?? '#ff9e16' }} />
              : <span className="text-[13px] leading-none flex-none">{it.type === 'vehicle' ? '🚛' : it.type === 'equipment' ? '🏗️' : it.type === 'personnel' ? '👷' : '🔧'}</span>}
            <span className="flex-1 min-w-0 truncate">{it.name}</span>
            {it.sub && <span className="font-mono text-[9px] text-faint flex-none max-w-[80px] truncate">{it.sub}</span>}
          </button>
        )
        return (
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-1.5 bg-navy-900 border border-navy-700 rounded-lg px-2 py-1.5 focus-within:border-teal transition-colors">
              <Search className="h-3.5 w-3.5 text-faint flex-none" />
              <input
                value={findQ}
                onChange={(e) => setFindQ(e.target.value)}
                onFocus={() => setFindOpen(true)}
                onBlur={() => setTimeout(() => setFindOpen(false), 150)}
                placeholder="Find asset or zone…"
                className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-faint outline-none"
              />
            </div>
            {findOpen && (
              <div className="mt-1 rounded-lg bg-navy-900 border border-navy-700 max-h-[240px] overflow-y-auto no-scrollbar">
                {assets.length > 0 && <p className="px-2.5 pt-1.5 pb-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Assets</p>}
                {assets.map(row)}
                {zones.length > 0 && <p className="px-2.5 pt-1.5 pb-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint border-t border-navy-800">Zones</p>}
                {zones.map(row)}
                {assets.length + zones.length === 0 && (
                  <p className="px-2.5 py-2.5 text-[11px] text-faint text-center">Nothing matches &ldquo;{findQ}&rdquo;</p>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Show on map — the old chip row lives here now, zero scrolling ── */}
      {filter && onFilter && (
        <div className="px-2 pb-1.5">
          <p className="px-1 pt-1 pb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Show on map</p>
          <div className="grid grid-cols-2 gap-1">
            {([
              ['vehicle', '🚛', 'Vehicles'],
              ['equipment', '🏗️', 'Equipment'],
              ['personnel', '👷', 'People'],
              ['tool', '🔧', 'Tools'],
            ] as [AssetType, string, string][]).map(([t, emoji, label]) => {
              const on = filter.has(t)
              return (
                <button
                  key={t}
                  onClick={() => {
                    const next = new Set(filter)
                    if (on) next.delete(t); else next.add(t)
                    onFilter(next)
                  }}
                  className={
                    'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-colors ' +
                    (on ? 'bg-teal/15 border-teal/40 text-ink' : 'bg-navy-900 border-navy-800 text-faint hover:text-ink')
                  }
                >
                  <span>{emoji}</span>{label}
                </button>
              )
            })}
            {onShowZones && (
              <button
                onClick={() => onShowZones(!showZones)}
                className={
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-colors ' +
                  (showZones ? 'bg-amber/15 border-amber/40 text-amber' : 'bg-navy-900 border-navy-800 text-faint hover:text-ink')
                }
              >
                <Hexagon className="h-3.5 w-3.5" /> Zones
              </button>
            )}
            {onDrawZone && (
              <button
                onClick={() => { setOpen(false); onDrawZone() }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold border border-dashed border-teal/60 text-teal hover:bg-teal/10 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> New zone
              </button>
            )}
            {onToggleDevices && (
              <button
                onClick={onToggleDevices}
                className={
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-colors ' +
                  (showDevices ? 'bg-teal/15 border-teal/40 text-teal' : 'bg-navy-900 border-navy-800 text-faint hover:text-ink')
                }
              >
                <Cctv className="h-3.5 w-3.5" /> Site IoT
              </button>
            )}
          </div>
        </div>
      )}

      {/* location — editable so the weather can follow any site/city */}
      {onPlaceChange ? (
        <div className="relative">
          <form onSubmit={submitPlace} className="flex items-center gap-1 px-2 pt-2 -mb-0.5">
            <MapPin className="h-3 w-3 text-teal flex-none" />
            <input
              value={placeInput}
              onChange={(e) => setPlaceInput(e.target.value)}
              onFocus={() => setSugOpen(true)}
              onBlur={() => setTimeout(() => setSugOpen(false), 150)}
              placeholder="City or place…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-ink placeholder:text-faint outline-none"
            />
            <button type="submit" title="Update weather location" className="grid place-items-center w-5 h-5 rounded text-faint hover:text-teal flex-none">
              <Search className="h-3 w-3" />
            </button>
            {onSaveDefault && (
              <button
                type="button"
                onClick={saveDefault}
                title="Save as company default location"
                className="grid place-items-center w-5 h-5 rounded text-faint hover:text-amber flex-none"
              >
                {savedDefault ? <Check className="h-3 w-3 text-amber" /> : <Star className="h-3 w-3" />}
              </button>
            )}
          </form>
          {sugOpen && suggestions.length > 0 && (
            <ul className="absolute left-2 right-2 top-full mt-1 z-30 rounded-lg bg-navy-900 border border-navy-700 shadow-panel overflow-hidden">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); pickPlace(s) }}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-ink hover:bg-navy-800 flex items-center gap-1.5"
                  >
                    <MapPin className="h-3 w-3 text-faint flex-none" />
                    <span className="truncate">{placeLabel(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : place ? (
        <div className="px-3 pt-2 -mb-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint flex items-center gap-1">
          <MapPin className="h-3 w-3 text-teal" /> {place}
        </div>
      ) : null}
      {/* header — tap anywhere to collapse; the protruding X above is the
          always-visible way */}
      <div className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-navy-800">
        <button onClick={() => setOpen(false)} className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <span className="font-display font-bold text-[14px] text-ink">{temp ?? 'Layers'}</span>
          <span className="font-mono text-[10px] text-muted flex items-center gap-2">
            {conditions && (
              <>
                <span className="flex items-center gap-1"><Wind className="h-3 w-3" />{conditions.windMph}</span>
                <span className={conditions.isThunder ? 'text-amber flex items-center gap-1' : 'flex items-center gap-1'}>
                  <Zap className="h-3 w-3" />{conditions.isThunder ? 'Storm' : 'Clear'}
                </span>
              </>
            )}
          </span>
        </button>
      </div>

      {/* home weather station — live hyper-local reading from the owner's PWS */}
      {pws && (
        <div className="px-3 py-2 border-b border-navy-800 bg-amber/[0.04]">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-amber">
              <Home className="h-3 w-3" /> Home station
            </span>
            <span className="font-mono text-[9.5px] text-faint">{pwsAge(pws.at)}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display font-bold text-[18px] text-ink">{pws.tempF}°</span>
            {pws.feelsF != null && Math.abs(pws.feelsF - pws.tempF) >= 2 && (
              <span className="font-mono text-[10px] text-muted">feels {Math.round(pws.feelsF)}°</span>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-muted flex items-center gap-1">
              <Wind className="h-3 w-3" />
              {pws.windDir ? `${pws.windDir} ` : ''}{pws.windMph}
              {pws.gustMph != null && pws.gustMph > pws.windMph + 2 ? ` g${Math.round(pws.gustMph)}` : ''}
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-faint flex items-center gap-3">
            {pws.humidity != null && <span>{Math.round(pws.humidity)}% rh</span>}
            {pws.rainTodayIn != null && (
              <span className={pws.rainTodayIn > 0 ? 'text-teal' : ''}>{pws.rainTodayIn}&quot; today</span>
            )}
            {pws.pressureInHg != null && <span>{pws.pressureInHg} inHg</span>}
          </div>
        </div>
      )}

      {/* named saveable views — one tap to a whole look; star = opens with it.
          Collapsed by default like every other section; saved per USER (your
          account across devices), not company-wide. */}
      {views && onApplyView && (
        <div className="border-b border-navy-800">
          <button onClick={() => toggleGroup('views')} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-navy-900 transition-colors">
            <Bookmark className="h-3.5 w-3.5 text-teal flex-none" />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted flex-1 text-left">Preset maps</span>
            {collapsed.views ? <ChevronRight className="h-3.5 w-3.5 text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-faint" />}
          </button>
          {!collapsed.views && (
          <div className="px-2 pb-2">
          <div className="px-1 flex items-center justify-between mb-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">Saved to your account</span>
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
            <form onSubmit={submitSaveView} className="flex items-center gap-1 mb-1.5 px-1">
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
          <div className="flex flex-wrap gap-1 px-1">
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => onApplyView(v.id)}
                className={
                  'flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors border ' +
                  (activeViewId === v.id
                    ? 'bg-teal/20 text-teal border-teal/40'
                    : 'text-faint border-navy-700 hover:text-ink hover:border-navy-600')
                }
              >
                {defaultViewId === v.id && <Star className="h-2.5 w-2.5 fill-current text-amber" />}
                {v.name}
              </button>
            ))}
          </div>
          {activeView && (
            <div className="flex items-center gap-2 mt-1.5 px-1">
              {onSetDefaultView && (
                <button
                  onClick={() => onSetDefaultView(activeView.id)}
                  className={
                    'flex items-center gap-1 text-[10.5px] font-semibold transition-colors ' +
                    (defaultViewId === activeView.id ? 'text-amber' : 'text-faint hover:text-amber')
                  }
                >
                  <Star className={'h-3 w-3' + (defaultViewId === activeView.id ? ' fill-current' : '')} />
                  {defaultViewId === activeView.id ? 'Opens with this view' : 'Use on open'}
                </button>
              )}
              {!activeView.preset && onDeleteView && (
                <button onClick={() => onDeleteView(activeView.id)} className="ml-auto flex items-center gap-1 text-[10.5px] text-faint hover:text-alert">
                  <RotateCcw className="h-3 w-3 rotate-90" /> Delete
                </button>
              )}
            </div>
          )}
          </div>
          )}
        </div>
      )}

      {/* ── Layer groups: Site · Weather · Water & Terrain · Basemap ── */}
      <Group gid="site">{rowsFor('site')}</Group>
      <Group gid="weather">{rowsFor('weather')}</Group>
      <Group gid="water">{rowsFor('water')}</Group>
      <Group gid="basemap">
        <div className="grid grid-cols-2 gap-1 p-1">
          {BASEMAPS.map((b) => (
            <Seg key={b.id} active={base === b.id} onClick={() => onBase(b.id)}>
              {b.id === 'dark' ? <MapIcon className="h-3.5 w-3.5" /> : b.id === 'streets' ? <Signpost className="h-3.5 w-3.5" /> : b.id === 'satellite' ? <Satellite className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />}
              {b.label}
            </Seg>
          ))}
        </div>
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
        {/* View extras (satellites, …) — regular rows in the basemap group */}
        {rowsFor('basemap')}
        {/* Night effects — nested; greyed with the reason unless basemap = Dark */}
        <div className="border-t border-navy-800">
          <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Night effects</p>
          {rowsFor('basemap', true)}
        </div>
      </Group>

      {onResetLayers && (
        <button
          onClick={onResetLayers}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-faint hover:text-ink transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Reset layers to defaults
        </button>
      )}
      {/* honest bandwidth note — radar/clouds/overlays are live streams */}
      <p className="px-3 py-2 border-t border-navy-800 text-[10px] text-faint leading-relaxed">
        More layers = more live data. On weak job-site signal, turn a few off
        and the map loads noticeably faster.
      </p>
      </div>
    </div>
  )
}
