'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { CloudRain, Wind, Zap, Map as MapIcon, Satellite, Layers, ChevronUp, ChevronDown, MapPin, Box, Signpost, Globe2, Search, Star, Check, Mountain, Droplets, Waves, SunDim } from 'lucide-react'
import { type Conditions, weatherEmoji } from '@/lib/weather'

export type BaseStyle = 'dark' | 'streets' | 'satellite' | 'hybrid'

interface WeatherControlProps {
  base: BaseStyle
  onBase: (b: BaseStyle) => void
  /** 3D buildings + tilt — an independent toggle layerable on any basemap. */
  threeD: boolean
  onThreeD: (v: boolean) => void
  radarOn: boolean
  onRadar: (v: boolean) => void
  conditions: Conditions | null
  frameTime: string | null
  place?: string
  onPlaceChange?: (name: string, lat?: number, lng?: number) => void
  /** Admin only: persist the current place as the company-wide default.
   *  Resolve false when the write failed (e.g. migration 008 not applied). */
  onSaveDefault?: (place: string) => Promise<boolean | void>
  /** Tax-parcel overlay toggle — rendered only when a parcel service is configured. */
  parcelsOn?: boolean
  onParcels?: (v: boolean) => void
  /** Free national overlays (topo, hillshade, wetlands, streams). */
  overlays?: { key: string; label: string; note: string; on: boolean }[]
  onOverlay?: (key: string, on: boolean) => void
  top?: number
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

export function WeatherControl({ base, onBase, threeD, onThreeD, radarOn, onRadar, conditions, frameTime, place, onPlaceChange, onSaveDefault, parcelsOn = false, onParcels, overlays, onOverlay, top = 58 }: WeatherControlProps) {
  const [open, setOpen] = useState(false)
  const [placeInput, setPlaceInput] = useState(place ?? '')
  // Keep the input in sync with the resolved location after a search.
  useEffect(() => { setPlaceInput(place ?? '') }, [place])
  const temp = conditions ? `${weatherEmoji(conditions.code)} ${conditions.tempF}°` : null

  // Live place autocomplete (free Open-Meteo geocoder), debounced.
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
    // Pass the coordinates straight through — re-geocoding the full label
    // ("Greenville, South Carolina, US") fails and left the weather stale.
    onPlaceChange?.([s.name, s.admin1].filter(Boolean).join(', '), s.latitude, s.longitude)
  }

  const [savedDefault, setSavedDefault] = useState(false)
  const saveDefault = async () => {
    if (!place) return
    // Always persist on THIS device immediately — survives redeploys and works
    // even before migration 008 adds the company-wide column. The server write
    // (if it succeeds) additionally shares it across the whole team.
    try { localStorage.setItem('ht_weather_place', place) } catch { /* private mode */ }
    setSavedDefault(true)
    setTimeout(() => setSavedDefault(false), 2000)
    if (onSaveDefault) {
      try { await onSaveDefault(place) } catch { /* device save already stuck */ }
    }
  }

  const submitPlace = (e: React.FormEvent) => {
    e.preventDefault()
    setSugOpen(false)
    const v = placeInput.trim()
    if (v && onPlaceChange) onPlaceChange(v)
  }

  // Collapsed: a compact pill — keeps the at-a-glance temp, hides the toggles
  if (!open) {
    return (
      <button
        style={{ top }}
        onClick={() => setOpen(true)}
        className="absolute left-3 z-10 flex items-center gap-2 rounded-xl bg-navy-950/80 backdrop-blur border border-navy-700 shadow-panel px-3 py-2"
      >
        {temp ? <span className="font-display font-bold text-[14px] text-ink">{temp}</span> : <Layers className="h-4 w-4 text-faint" />}
        {(radarOn || base === 'satellite' || base === 'hybrid') && (
          <span className="flex items-center gap-1">
            {radarOn && <CloudRain className="h-3.5 w-3.5 text-teal" />}
            {(base === 'satellite' || base === 'hybrid') && <Satellite className="h-3.5 w-3.5 text-teal" />}
          </span>
        )}
        {/* maximize affordance */}
        <span className="flex items-center gap-0.5 text-faint">
          <Layers className="h-3.5 w-3.5" />
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
    )
  }

  return (
    <div style={{ top }} className="absolute left-3 z-10 w-[200px] rounded-xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
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
      {/* header — tap to collapse */}
      <button onClick={() => setOpen(false)} className="w-full flex items-center justify-between px-3 py-1.5 border-b border-navy-800">
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
          <ChevronUp className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* basemap segmented */}
      <div className="grid grid-cols-2 gap-1 p-1 border-b border-navy-800">
        <Seg active={base === 'dark'} onClick={() => onBase('dark')}><MapIcon className="h-3.5 w-3.5" />Dark</Seg>
        <Seg active={base === 'streets'} onClick={() => onBase('streets')}><Signpost className="h-3.5 w-3.5" />Streets</Seg>
        <Seg active={base === 'satellite'} onClick={() => onBase('satellite')}><Satellite className="h-3.5 w-3.5" />Satellite</Seg>
        <Seg active={base === 'hybrid'} onClick={() => onBase('hybrid')}><Globe2 className="h-3.5 w-3.5" />Hybrid</Seg>
      </div>

      {/* 3D buildings + tilt — independent toggle, works on any basemap above */}
      <button onClick={() => onThreeD(!threeD)} className="w-full flex items-center justify-between px-3 py-2 border-b border-navy-800 hover:bg-navy-900 transition-colors">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <Box className={'h-4 w-4 ' + (threeD ? 'text-teal' : 'text-faint')} /> 3D buildings &amp; tilt
        </span>
        <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (threeD ? 'bg-teal/40' : 'bg-navy-700')}>
          <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (threeD ? 'left-[18px]' : 'left-0.5')} />
        </span>
      </button>

      {/* radar toggle */}
      <button onClick={() => onRadar(!radarOn)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-navy-900 transition-colors">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <CloudRain className={'h-4 w-4 ' + (radarOn ? 'text-teal' : 'text-faint')} /> Rain radar
        </span>
        <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (radarOn ? 'bg-teal/40' : 'bg-navy-700')}>
          <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (radarOn ? 'left-[18px]' : 'left-0.5')} />
        </span>
      </button>
      {radarOn && (
        <div className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-blink" />
          radar loop{frameTime ? ` · ${frameTime}` : ''}
        </div>
      )}

      {/* free national overlays: topo, hillshade, wetlands, streams */}
      {overlays && onOverlay && overlays.map((o) => {
        const Icon = o.key === 'topo' ? Mountain : o.key === 'hillshade' ? SunDim : o.key === 'wetlands' ? Droplets : Waves
        return (
          <div key={o.key}>
            <button onClick={() => onOverlay(o.key, !o.on)} className="w-full flex items-center justify-between px-3 py-2 border-t border-navy-800 hover:bg-navy-900 transition-colors">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                <Icon className={'h-4 w-4 ' + (o.on ? 'text-teal' : 'text-faint')} /> {o.label}
              </span>
              <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (o.on ? 'bg-teal/40' : 'bg-navy-700')}>
                <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (o.on ? 'left-[18px]' : 'left-0.5')} />
              </span>
            </button>
            {o.on && (
              <div className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">{o.note}</div>
            )}
          </div>
        )
      })}

      {/* tax parcel lines — county GIS overlay, appears at street zoom */}
      {onParcels && (
        <>
          <button onClick={() => onParcels(!parcelsOn)} className="w-full flex items-center justify-between px-3 py-2 border-t border-navy-800 hover:bg-navy-900 transition-colors">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <Layers className={'h-4 w-4 ' + (parcelsOn ? 'text-amber' : 'text-faint')} /> Parcel lines
            </span>
            <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (parcelsOn ? 'bg-amber/40' : 'bg-navy-700')}>
              <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (parcelsOn ? 'left-[18px]' : 'left-0.5')} />
            </span>
          </button>
          {parcelsOn && (
            <div className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-amber">
              county tax parcels · zoom in to see lines
            </div>
          )}
        </>
      )}
    </div>
  )
}
