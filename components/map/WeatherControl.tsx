'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { CloudRain, Wind, Zap, Map as MapIcon, Satellite, Layers, ChevronUp, ChevronDown, MapPin, Box, Signpost, Globe2, Search } from 'lucide-react'
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
  onPlaceChange?: (name: string) => void
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

export function WeatherControl({ base, onBase, radarOn, onRadar, conditions, frameTime, place, onPlaceChange, top = 58 }: WeatherControlProps) {
  const [open, setOpen] = useState(false)
  const [placeInput, setPlaceInput] = useState(place ?? '')
  // Keep the input in sync with the resolved location after a search.
  useEffect(() => { setPlaceInput(place ?? '') }, [place])
  const temp = conditions ? `${weatherEmoji(conditions.code)} ${conditions.tempF}°` : null

  const submitPlace = (e: React.FormEvent) => {
    e.preventDefault()
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
        <form onSubmit={submitPlace} className="flex items-center gap-1 px-2 pt-2 -mb-0.5">
          <MapPin className="h-3 w-3 text-teal flex-none" />
          <input
            value={placeInput}
            onChange={(e) => setPlaceInput(e.target.value)}
            placeholder="City or place…"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-ink placeholder:text-faint outline-none"
          />
          <button type="submit" title="Update weather location" className="grid place-items-center w-5 h-5 rounded text-faint hover:text-teal flex-none">
            <Search className="h-3 w-3" />
          </button>
        </form>
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
    </div>
  )
}
