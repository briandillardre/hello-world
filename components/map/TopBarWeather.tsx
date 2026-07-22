'use client'

import { useEffect, useState } from 'react'
import { Home, Wind } from 'lucide-react'
import { fetchConditions, weatherEmoji, type Conditions } from '@/lib/weather'
import { fetchPws, type PwsConditions } from '@/lib/pws'

/**
 * Current conditions in the top bar, next to the branding (owner ask, Jul 21
 * — "weather doesn't need to live in the layers menu"). Self-contained:
 * resolves its location from the company default (props) or the device's
 * saved star, refreshes every 10 min. Renders nothing until it has a reading
 * — the bar never shows a spinner.
 */
export function TopBarWeather({
  place = null, coords = null,
}: {
  place?: string | null
  coords?: { lat: number; lng: number } | null
}) {
  const [cond, setCond] = useState<Conditions | null>(null)
  const [pws, setPws] = useState<PwsConditions | null>(null)
  const [label, setLabel] = useState<string | null>(place)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Company star (exact coords) → device star → give up quietly.
      let at = coords
      let name = place
      if (!at) {
        try {
          const raw = localStorage.getItem('ht_weather_default')
          if (raw) {
            const saved = JSON.parse(raw) as { name?: string; lat?: number; lng?: number }
            if (typeof saved.lat === 'number' && typeof saved.lng === 'number') {
              at = { lat: saved.lat, lng: saved.lng }
              name = name ?? saved.name ?? null
            }
          }
        } catch { /* corrupt value — skip */ }
      }
      if (!at) return
      const c = await fetchConditions(at.lat, at.lng)
      if (!cancelled && c) { setCond(c); setLabel(name) }
    }
    load()
    fetchPws().then((p) => { if (!cancelled) setPws(p) })
    const iv = setInterval(() => { load(); fetchPws().then((p) => { if (!cancelled) setPws(p) }) }, 10 * 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [place, coords])

  if (!cond) return null
  const city = label ? label.split(',')[0].trim() : null
  return (
    <span className="flex items-center gap-2 min-w-0">
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
    </span>
  )
}
