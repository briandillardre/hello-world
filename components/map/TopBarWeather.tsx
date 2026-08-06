'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Home, MapPin, Search, Star, Check, Wind } from 'lucide-react'
import { fetchConditions, weatherEmoji, type Conditions } from '@/lib/weather'
import { fetchPws, type PwsConditions } from '@/lib/pws'
import { setWeatherDefaultAction } from '@/lib/actions/company'

/** "2m ago" style age for the station reading — stations report every 16s–5min. */
function pwsAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'live'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

/**
 * Current conditions in the top bar, next to the branding. Tapping the
 * temperature/icon opens the weather dropdown — location search + the
 * company-default star + the home station reading all live HERE now, not in
 * the Layers menu (owner ask, Aug 5: "move weather to a drop down up here").
 * Picking a place broadcasts `ht:weather-place` so the map's radar/temps
 * follow along; the star persists the exact coords on this device and (for
 * admins) to the company row.
 */
export function TopBarWeather({
  place = null, coords = null, canSetDefault = false,
}: {
  place?: string | null
  coords?: { lat: number; lng: number } | null
  canSetDefault?: boolean
}) {
  const [cond, setCond] = useState<Conditions | null>(null)
  const [pws, setPws] = useState<PwsConditions | null>(null)
  const [label, setLabel] = useState<string | null>(place)
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(coords)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Company star (exact coords) → device star → give up quietly.
      let here = at ?? coords
      let name = label ?? place
      if (!here) {
        try {
          const raw = localStorage.getItem('ht_weather_default')
          if (raw) {
            const saved = JSON.parse(raw) as { name?: string; lat?: number; lng?: number }
            if (typeof saved.lat === 'number' && typeof saved.lng === 'number') {
              here = { lat: saved.lat, lng: saved.lng }
              name = name ?? saved.name ?? null
            }
          }
        } catch { /* corrupt value — skip */ }
      }
      if (!here) return
      const c = await fetchConditions(here.lat, here.lng)
      if (!cancelled && c) { setCond(c); setLabel(name); setAt(here) }
    }
    load()
    fetchPws().then((p) => { if (!cancelled) setPws(p) })
    const iv = setInterval(() => { load(); fetchPws().then((p) => { if (!cancelled) setPws(p) }) }, 10 * 60_000)
    return () => { cancelled = true; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, coords])

  // Close on tap-outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  // Live place autocomplete (free geocoder), debounced — same behavior the
  // Layers panel had before the move.
  type Place = { name: string; admin1?: string; country_code?: string; latitude?: number; longitude?: number }
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<Place[]>([])
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setSuggestions([]); return }
    const id = setTimeout(() => {
      fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((j) => setSuggestions(Array.isArray(j?.results) ? j.results : []))
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const pick = async (s: Place) => {
    if (s.latitude == null || s.longitude == null) return
    const name = [s.name, s.admin1].filter(Boolean).join(', ')
    setQ(''); setSuggestions([])
    setLabel(name)
    setAt({ lat: s.latitude, lng: s.longitude })
    const c = await fetchConditions(s.latitude, s.longitude)
    if (c) setCond(c)
    // The map (when open) recenters its radar/temps on this point.
    window.dispatchEvent(new CustomEvent('ht:weather-place', {
      detail: { name, lat: s.latitude, lng: s.longitude },
    }))
  }

  const [saved, setSaved] = useState(false)
  const saveDefault = async () => {
    if (!label || !at) return
    try { localStorage.setItem('ht_weather_default', JSON.stringify({ name: label, lat: at.lat, lng: at.lng })) } catch { /* private mode */ }
    if (canSetDefault) {
      try { await setWeatherDefaultAction(label, at.lat, at.lng) } catch { /* device save already stuck */ }
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!cond) return null
  const city = label ? label.split(',')[0].trim() : null
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Weather — location & details"
        className="flex items-center gap-2 min-w-0 rounded-lg px-1.5 py-0.5 -my-0.5 hover:bg-navy-900 transition-colors"
      >
        <span className="font-display font-bold text-[13px] md:text-[14px] text-ink whitespace-nowrap">
          {weatherEmoji(cond.code)} {cond.tempF}°
        </span>
        <span className="hidden sm:flex items-center gap-1 font-mono text-[10px] text-muted whitespace-nowrap">
          <Wind className="h-3 w-3" />{cond.windMph}
        </span>
        {city && <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.1em] text-faint truncate max-w-[120px]">{city}</span>}
        {pws && (
          <span className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-amber whitespace-nowrap" title={`${pws.station} — home station`}>
            <Home className="h-3 w-3" />{pws.tempF}°
          </span>
        )}
        <ChevronDown className={'h-3 w-3 text-faint transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[264px] z-[60] rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
          {/* current conditions, spelled out */}
          <div className="px-3 py-2.5 border-b border-navy-800">
            <div className="flex items-baseline gap-2">
              <span className="font-display font-bold text-[22px] text-ink">{weatherEmoji(cond.code)} {cond.tempF}°</span>
              <span className="ml-auto font-mono text-[11px] text-muted flex items-center gap-1">
                <Wind className="h-3 w-3" />{cond.windMph} mph
              </span>
            </div>
            {label && (
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint flex items-center gap-1">
                <MapPin className="h-3 w-3 text-teal" /> {label}
              </p>
            )}
          </div>

          {/* location search + company-default star (moved from Layers) */}
          <div className="relative border-b border-navy-800">
            <div className="flex items-center gap-1.5 px-3 py-2">
              <Search className="h-3 w-3 text-faint flex-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Change location — city or place…"
                className="flex-1 min-w-0 bg-transparent text-[11.5px] text-ink placeholder:text-faint outline-none"
              />
              <button
                type="button"
                onClick={saveDefault}
                title={canSetDefault ? 'Save as company default location' : 'Save as my default on this device'}
                className="grid place-items-center w-5 h-5 rounded text-faint hover:text-amber flex-none"
              >
                {saved ? <Check className="h-3 w-3 text-amber" /> : <Star className="h-3 w-3" />}
              </button>
            </div>
            {suggestions.length > 0 && (
              <ul className="border-t border-navy-800">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => pick(s)}
                      className="w-full text-left px-3 py-1.5 text-[11.5px] text-ink hover:bg-navy-800 flex items-center gap-1.5"
                    >
                      <MapPin className="h-3 w-3 text-faint flex-none" />
                      <span className="truncate">{[s.name, s.admin1, s.country_code].filter(Boolean).join(', ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* home weather station — live hyper-local reading from the owner's PWS */}
          {pws && (
            <div className="px-3 py-2 bg-amber/[0.04]">
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
        </div>
      )}
    </div>
  )
}
