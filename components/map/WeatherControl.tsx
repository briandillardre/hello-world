'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { CloudRain, Wind, Zap, Map as MapIcon, Satellite, Layers, ChevronUp, ChevronDown, MapPin, Box, Signpost, Globe2, Search, Star, Check, Mountain } from 'lucide-react'
import { type Conditions, weatherEmoji } from '@/lib/weather'

export type BaseStyle = 'dark' | 'streets' | 'satellite' | 'hybrid' | '3d'

interface WeatherControlProps {
  base: BaseStyle
  onBase: (b: BaseStyle) => void
  radarOn: boolean
  onRadar: (v: boolean) => void
  conditions: Conditions | null
  frameTime: string | null
  place?: string
  onPlaceChange?: (name: string, lat?: number, lng?: number) => void
  /** Admin only: persist the current place as the company-wide default. */
  onSaveDefault?: (place: string) => Promise<void>
  /** Tax-parcel overlay toggle — rendered only when a parcel service is configured. */
  parcelsOn?: boolean
  onParcels?: (v: boolean) => void
  /** USGS contour-lines overlay (national, free) — always available. */
  topoOn?: boolean
  onTopo?: (v: boolean) => void
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

export function WeatherControl({ base, onBase, radarOn, onRadar, conditions, frameTime, place, onPlaceChange, onSaveDefault, parcelsOn = false, onParcels, topoOn = false, onTopo, top = 58 }: WeatherControlProps) {
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
    if (!onSaveDefault || !place) return
    try {
      await onSaveDefault(place)
      setSavedDefault(true)
      setTimeout(() => setSavedDefault(false), 2000)
    } catch { /* keep quiet; the star simply doesn't confirm */ }
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
      <div className="grid grid-cols-3 gap-1 p-1 border-b border-navy-800">
        <Seg active={base === 'dark'} onClick={() => onBase('dark')}><MapIcon className="h-3.5 w-3.5" />Dark</Seg>
        <Seg active={base === 'streets'} onClick={() => onBase('streets')}><Signpost className="h-3.5 w-3.5" />Streets</Seg>
        <Seg active={base === 'satellite'} onClick={() => onBase('satellite')}><Satellite className="h-3.5 w-3.5" />Satellite</Seg>
        <Seg active={base === 'hybrid'} onClick={() => onBase('hybrid')}><Globe2 className="h-3.5 w-3.5" />Hybrid</Seg>
        <Seg active={base === '3d'} onClick={() => onBase('3d')}><Box className="h-3.5 w-3.5" />3D</Seg>
      </div>

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
          live radar{frameTime ? ` · ${frameTime}` : ''}
        </div>
      )}

      {/* USGS topo contour lines — free national overlay, street zoom */}
      {onTopo && (
        <>
          <button onClick={() => onTopo(!topoOn)} className="w-full flex items-center justify-between px-3 py-2 border-t border-navy-800 hover:bg-navy-900 transition-colors">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <Mountain className={'h-4 w-4 ' + (topoOn ? 'text-teal' : 'text-faint')} /> Topo lines
            </span>
            <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (topoOn ? 'bg-teal/40' : 'bg-navy-700')}>
              <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (topoOn ? 'left-[18px]' : 'left-0.5')} />
            </span>
          </button>
          {topoOn && (
            <div className="px-3 pb-2 -mt-0.5 font-mono text-[10px] text-teal">
              USGS contours &middot; zoom in to see lines
            </div>
          )}
        </>
      )}

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
