'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp,
  CornerUpLeft, CornerUpRight, ExternalLink, Flag, List, LocateFixed, Merge, TrafficCone,
} from 'lucide-react'
import { MapSheet } from './MapSheet'

/** Mirrors /api/route's wire shape (OSRM proxied server-side). */
interface RouteStep {
  instruction: string
  distanceM: number
  name: string | null
  type: string
  modifier: string | null
}
interface RouteData {
  distanceM: number
  durationSec: number
  geometry: GeoJSON.LineString
  steps: RouteStep[]
  /** Always false today — the ETA is free-flow OSRM. The tag beside the
   *  number exists because of this field; never drop one without the other. */
  trafficAware: boolean
}

type Origin = { lat: number; lng: number; label: string }

/* ── formatting ─────────────────────────────────────────────────────────── */

const fmtMi = (m: number) => {
  const mi = m / 1609.344
  return mi < 10 ? mi.toFixed(1) : String(Math.round(mi))
}

const fmtDur = (s: number) => {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

/** Step sub-line: feet close in ("500 ft" reads like a navigator), miles out. */
const fmtStepDist = (m: number) => {
  const mi = m / 1609.344
  if (mi < 0.15) return `${Math.max(10, Math.round((m * 3.28084) / 10) * 10)} ft`
  return `${fmtMi(m)} mi`
}

/** Maneuver → arrow glyph. OSRM's type/modifier pair collapses onto seven
 *  lucide arrows; anything unrecognized reads as "keep going". */
function stepIcon(type: string, modifier: string | null) {
  const mod = modifier ?? ''
  if (type === 'arrive') return Flag
  if (type === 'merge') return Merge
  if (mod.includes('uturn')) return CornerUpLeft // right-hand traffic: U-turns go left
  if (mod === 'slight left') return CornerUpLeft
  if (mod === 'slight right') return CornerUpRight
  if (mod.includes('left')) return ArrowLeft
  if (mod.includes('right')) return ArrowRight
  return ArrowUp
}

/**
 * In-app preview routing (Brian, Aug 29: "routing, traffic, etc., just like
 * Google Maps — an app my guys stay in all day"). Same shared sheet as the
 * asset/zone panels: on phones the header (destination + distance/ETA) rides
 * the bottom edge with the MAP still live above it — steps sit behind an
 * expand so twenty turns never bury the End button; desktop gets the right
 * rail with the full list.
 *
 * HONESTY RULE, wired to the API's trafficAware:false — the ETA is a
 * free-flow OSRM number, so a "no-traffic estimate" tag sits right beside it
 * and the Traffic chip only toggles the live congestion OVERLAY (TomTom
 * colours on the same roads). The minutes never pretend to include it.
 */
export function DirectionsSheet({
  dest, origin, mapCenter, onRouteGeometry, onEnd, trafficOn, onToggleTraffic,
}: {
  dest: { lat: number; lng: number; name: string }
  /** Route start when the caller already knows one (an asset's fix, a place).
   *  Null = ask the phone where it is. */
  origin: { lat: number; lng: number; label: string } | null
  /** Last-ditch start point offered only when the phone won't share location. */
  mapCenter?: { lat: number; lng: number } | null
  /** Fires the route line to the map when one lands; null clears it — on
   *  error, on destination change, and on unmount. */
  onRouteGeometry: (geo: GeoJSON.LineString | null) => void
  onEnd: () => void
  trafficOn: boolean
  onToggleTraffic: () => void
}) {
  const [from, setFrom] = useState<Origin | null>(origin)
  const [geoFailed, setGeoFailed] = useState(false)
  const [route, setRoute] = useState<RouteData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)

  // Parents pass inline closures; a ref keeps the callback out of the effect
  // deps so a parent re-render never re-fetches an unchanged route.
  const onGeoRef = useRef(onRouteGeometry)
  onGeoRef.current = onRouteGeometry

  // Resolve the start point — on mount and again when the destination moves
  // (a fresh fix beats a stale one). The caller's origin always wins; without
  // one we ask the phone, and a denial leaves `from` alone so a map-center
  // choice the user already made survives.
  useEffect(() => {
    if (origin) {
      setFrom(origin)
      setGeoFailed(false)
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoFailed(true)
      return
    }
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return
        setFrom({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'your location' })
        setGeoFailed(false)
      },
      () => { if (!cancelled) setGeoFailed(true) },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, origin?.label, dest.lat, dest.lng])

  // Fetch the route once both ends exist. Cleanup clears the map line, so a
  // destination change or unmount never strands yesterday's ribbon on screen.
  useEffect(() => {
    if (!from) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    setRoute(null) // stale numbers must not sit under a new destination
    fetch(`/api/route?from=${from.lng},${from.lat}&to=${dest.lng},${dest.lat}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok || !j || j.error || !j.geometry) {
          // 404 carries the API's own words ("No driving route to that spot.").
          setErr((j && typeof j.error === 'string' && j.error) || 'Could not get directions right now.')
          onGeoRef.current(null)
          return
        }
        setRoute(j as RouteData)
        onGeoRef.current((j as RouteData).geometry)
      })
      .catch(() => {
        if (cancelled) return
        setErr('Could not get directions right now.')
        onGeoRef.current(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      onGeoRef.current(null)
    }
  }, [from?.lat, from?.lng, dest.lat, dest.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handoff link: origin+dest when we know the start, dest-only otherwise
  // (Google then routes from ITS live fix — which is the better behavior).
  const gmapsHref = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${dest.lat},${dest.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`

  // The summary lives in the sheet HEADER, not the body — on phones the
  // collapsed sheet shows only the header, and distance/ETA must stay
  // visible while someone pans the map with the route up.
  const subtitle = route ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-display font-black text-lg text-ink leading-tight">
        {fmtMi(route.distanceM)} mi · {fmtDur(route.durationSec)}
      </span>
      {/* Sits beside the ETA on purpose: trafficAware:false from the API. */}
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint border border-navy-700 rounded-full px-1.5 py-0.5">
        no-traffic estimate
      </span>
    </span>
  ) : err ? (
    <span className="text-alert">{err}</span>
  ) : loading ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-3 border-2 border-teal border-t-transparent rounded-full animate-spin" />
      Finding a route…
    </span>
  ) : geoFailed && !from ? (
    <span className="text-amber">Turn on location to route from where you are</span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-3 border-2 border-teal border-t-transparent rounded-full animate-spin" />
      Finding your location…
    </span>
  )

  return (
    <MapSheet
      icon={<span className="text-2xl">🧭</span>}
      title={dest.name}
      subtitle={subtitle}
      onClose={onEnd}
    >
      <div className="space-y-3">
        {from && (
          <p className="font-mono text-[11px] text-faint truncate">From {from.label}</p>
        )}

        {/* Phone said no to geolocation — plain words plus the only honest
            fallback we have (the map's own center), when the caller gave us one. */}
        {geoFailed && !from && (
          <div className="rounded-lg bg-navy-800 p-3 space-y-2">
            <p className="text-[12.5px] text-muted leading-snug">
              Turn on location to route from where you are.
            </p>
            {mapCenter && (
              <button
                onClick={() => setFrom({ lat: mapCenter.lat, lng: mapCenter.lng, label: 'map center' })}
                className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-900 border border-navy-700 text-ink text-sm font-medium hover:bg-navy-700 transition-colors"
              >
                <LocateFixed className="h-4 w-4 text-teal" /> Use map center
              </button>
            )}
          </div>
        )}

        {err && !loading && (
          <div className="rounded-lg bg-alert/10 border border-alert/30 px-3 py-2.5 text-[12.5px] text-alert leading-snug">
            {err}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className="w-3.5 h-3.5 border-2 border-teal border-t-transparent rounded-full animate-spin" />
            Routing…
          </div>
        )}

        {route && route.steps.length > 0 && (
          <div>
            {/* Phone: steps behind a tap — the collapsed sheet is summary +
                controls, and the map stays the star while driving. Desktop
                always lists them (the rail has the room). */}
            <button
              type="button"
              onClick={() => setStepsOpen((o) => !o)}
              className="md:hidden w-full h-10 inline-flex items-center justify-between rounded-lg bg-navy-800 border border-navy-700 px-3 text-sm text-ink font-medium"
            >
              <span className="inline-flex items-center gap-1.5">
                <List className="h-4 w-4 text-faint" /> Steps · {route.steps.length}
              </span>
              {stepsOpen ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
            </button>
            <p className="hidden md:block font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
              Turn-by-turn
            </p>
            {/* Bounded + inner-scroll so a 30-turn route never pushes the End
                button out of reach; overscroll-contain keeps the list from
                stealing the map's pan when it hits its end. */}
            <ol className={(stepsOpen ? 'mt-2 ' : 'hidden ') + 'md:block md:mt-1.5 max-h-[38vh] md:max-h-[45vh] overflow-y-auto overscroll-contain'}>
              {route.steps.map((st, i) => {
                const Icon = stepIcon(st.type, st.modifier)
                return (
                  <li key={i} className="flex items-start gap-2.5 px-1 py-2 border-b border-navy-800 last:border-0">
                    <Icon className="h-4 w-4 text-teal flex-none mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink leading-snug">{st.instruction}</span>
                      {st.distanceM > 0 && (
                        <span className="block font-mono text-[10.5px] text-faint mt-0.5">{fmtStepDist(st.distanceM)}</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {/* ── controls ── */}
        <div className="pt-3 border-t border-navy-800 space-y-2">
          <a
            href={gmapsHref}
            target="_blank" rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium py-2.5 hover:bg-navy-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 text-faint" /> Open in Google Maps
          </a>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggleTraffic}
              aria-pressed={trafficOn}
              title="live congestion overlay"
              className={'h-10 inline-flex items-center gap-1.5 rounded-full border px-3.5 font-mono text-[11px] transition-colors ' +
                (trafficOn
                  ? 'bg-amber/15 border-amber/40 text-amber'
                  : 'bg-navy-800 border-navy-700 text-muted hover:text-ink')}
            >
              <TrafficCone className="h-3.5 w-3.5" /> Traffic
            </button>
            <button
              type="button"
              onClick={onEnd}
              className="flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-lg bg-alert/15 border border-alert/40 text-alert text-sm font-semibold hover:bg-alert/25 transition-colors"
            >
              End
            </button>
          </div>
        </div>
      </div>
    </MapSheet>
  )
}
