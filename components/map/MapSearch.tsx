'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Mic, X, Hexagon } from 'lucide-react'
import type { AssetType } from '@/lib/types'

/**
 * Find-anything box for the live map: type (or talk) a few letters and jump
 * straight to an asset or zone. Voice uses the built-in Web Speech API
 * (Chrome/Android/iOS Safari) — no cloud, no keys; the mic hides where the
 * browser doesn't support it. A final voice result with exactly one match
 * selects it hands-free.
 */

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }

export interface SearchItem {
  kind: 'asset' | 'zone'
  id: string
  name: string
  type?: AssetType
  color?: string
  /** e.g. "on site now" / "last seen 3h ago" */
  sub?: string
}

/** A geocoded address hit (Photon — same free geocoder the server uses). */
export interface PlaceHit {
  name: string
  sub: string
  lat: number
  lng: number
}

// Minimal typings for the vendor-prefixed Web Speech API.
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

export function MapSearch({ items, onPick, onPickPlace, bias = null, top = 58, inline = false, anchor = 'top-left', overlay = false }: {
  items: SearchItem[]
  onPick: (item: SearchItem) => void
  /** Address hit chosen — fly the camera there (Brian, Aug 22: search finds
   *  assets, zones AND addresses). Omitting it hides address results. */
  onPickPlace?: (p: PlaceHit) => void
  /** Bias geocoding toward the fleet so "Greenville" is the SC one. */
  bias?: { lat: number; lng: number } | null
  top?: number
  /** Render as a flex-row member (beside the layers pill) instead of an
   *  absolutely positioned element; the open box overlays from that spot. */
  inline?: boolean
  /** Which corner of the inline slot the open box grows from —
   *  'bottom-right' for the thumb cluster (box grows up-left). */
  anchor?: 'top-left' | 'bottom-right'
  /** No trigger of its own: opens on the 'ht:open-search' window event (the
   *  rail's search button) as a top-center overlay with a dim backdrop. */
  overlay?: boolean
}) {
  const [open, setOpen] = useState(false)
  // Overlay mode: the rail button is the trigger.
  useEffect(() => {
    if (!overlay) return
    const openIt = () => setOpen(true)
    window.addEventListener('ht:open-search', openIt)
    return () => window.removeEventListener('ht:open-search', openIt)
  }, [overlay])
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [listening, setListening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    // startsWith beats includes — "sil" should rank Silverado above Drill.
    const starts = items.filter((i) => i.name.toLowerCase().startsWith(s))
    const contains = items.filter((i) => !i.name.toLowerCase().startsWith(s) && i.name.toLowerCase().includes(s))
    return [...starts, ...contains].slice(0, 8)
  }, [q, items])
  useEffect(() => { setHi(0) }, [q])

  // Address results (Photon, debounced) — shown BELOW fleet matches; the
  // fleet always wins the top of the list. Deps are PRIMITIVES + a ref for
  // the callback: MapView re-renders constantly (live repulls), and identity
  // deps tore this effect down every cycle — churning a free community
  // geocoder toward a rate-limit (ship-check P2).
  const [places, setPlaces] = useState<PlaceHit[]>([])
  const onPickPlaceRef = useRef(onPickPlace)
  onPickPlaceRef.current = onPickPlace
  const placesOn = !!onPickPlace
  const biasLat = bias?.lat
  const biasLng = bias?.lng
  useEffect(() => {
    if (!placesOn) return
    const s = q.trim()
    if (s.length < 4) { setPlaces([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      const biasQs = biasLat != null && biasLng != null ? `&lat=${biasLat.toFixed(3)}&lon=${biasLng.toFixed(3)}` : ''
      fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(s)}&limit=4&lang=en${biasQs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> }[] } | null) => {
          if (!j?.features) return
          setPlaces(j.features.flatMap((f) => {
            const [lng, lat] = f.geometry?.coordinates ?? []
            if (typeof lat !== 'number' || typeof lng !== 'number') return []
            const p = f.properties ?? {}
            const name = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.name ?? p.street), p.city ?? p.county].filter(Boolean).join(', ')
            if (!name) return []
            return [{ name, sub: [p.state, p.postcode].filter(Boolean).join(' '), lat, lng }]
          }).slice(0, 4))
        })
        .catch(() => { /* geocoder down — fleet search still works */ })
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q, biasLat, biasLng, placesOn])
  useEffect(() => { if (!open) setPlaces([]) }, [open])

  const pickPlace = (p: PlaceHit) => {
    onPickPlaceRef.current?.(p)
    setQ('')
    setOpen(false)
    recRef.current?.stop()
  }

  const pick = (it: SearchItem) => {
    onPick(it)
    setQ('')
    setOpen(false)
    recRef.current?.stop()
  }

  const startVoice = () => {
    const Ctor = getSpeechCtor()
    if (!Ctor) return
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const results = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>)
      const text = results.map((r) => r[0].transcript).join(' ').trim()
      setQ(text)
      // Final phrase with one clear winner → hands-free select.
      if (results.some((r) => r.isFinal)) {
        const s = text.toLowerCase()
        const hits = itemsRef.current.filter((i) => i.name.toLowerCase().includes(s))
        if (hits.length === 1) pick(hits[0])
      }
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    setOpen(true)
    rec.start()
  }

  // One keyboard list across fleet matches AND address rows — typing an
  // address usually means ZERO fleet matches, and Enter must still work
  // (ship-check P1).
  const totalRows = matches.length + places.length
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.max(0, Math.min(h + 1, totalRows - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (hi < matches.length && matches[hi]) pick(matches[hi])
      else if (places[hi - matches.length]) pickPlace(places[hi - matches.length])
    }
    else if (e.key === 'Escape') { setOpen(false); setQ('') }
  }

  if (!open) {
    if (overlay) return null
    return (
      <button
        style={inline ? undefined : { top }}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
        aria-label="Search assets and zones"
        className={
          (inline ? 'flex-none ' : 'absolute left-3 z-20 ') +
          'grid place-items-center w-9 h-9 rounded-xl bg-navy-950/80 backdrop-blur border border-navy-700 shadow-panel text-faint hover:text-teal transition-colors'
        }
      >
        <Search className="h-4 w-4" />
      </button>
    )
  }

  const body = (
    <>
      <div className="flex items-center gap-1.5 rounded-xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel px-2.5 py-2">
        <Search className="h-3.5 w-3.5 text-teal flex-none" />
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={onPickPlace ? 'Find asset, zone, or address…' : 'Find asset or zone…'}
          className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-faint outline-none"
        />
        {getSpeechCtor() && (
          <button
            onClick={startVoice}
            aria-label="Search by voice"
            className={'grid place-items-center w-6 h-6 rounded-md flex-none transition-colors ' + (listening ? 'text-alert animate-blink' : 'text-faint hover:text-teal')}
          >
            <Mic className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => { setOpen(false); setQ(''); recRef.current?.stop() }}
          aria-label="Close search"
          className="grid place-items-center w-6 h-6 rounded-md text-faint hover:text-ink flex-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {listening && matches.length === 0 && (
        <p className="mt-1.5 rounded-lg bg-navy-950/90 border border-navy-700 px-3 py-2 font-mono text-[11px] text-alert">
          Listening… say an asset or zone name
        </p>
      )}
      {(matches.length > 0 || places.length > 0) && (
        <ul className="mt-1.5 rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
          {matches.map((it, i) => (
            <li key={`${it.kind}-${it.id}`}>
              <button
                onMouseDown={(e) => { e.preventDefault(); pick(it) }}
                onMouseEnter={() => setHi(i)}
                className={'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ' + (i === hi ? 'bg-navy-800' : '')}
              >
                {it.kind === 'zone' ? (
                  <Hexagon className="h-4 w-4 flex-none" style={{ color: it.color ?? '#2dd4bf' }} />
                ) : (
                  <span className="text-base flex-none">{it.type ? TYPE_EMOJI[it.type] : '📍'}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink truncate">{it.name}</span>
                  {it.sub && <span className="block font-mono text-[10px] text-faint truncate">{it.sub}</span>}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wide text-faint flex-none">{it.kind}</span>
              </button>
            </li>
          ))}
          {onPickPlace && places.map((p, i) => (
            <li key={`place-${i}-${p.lat}-${p.lng}`}>
              <button
                onMouseDown={(e) => { e.preventDefault(); pickPlace(p) }}
                onMouseEnter={() => setHi(matches.length + i)}
                className={'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ' + (matches.length + i === hi ? 'bg-navy-800' : '')}
              >
                <span className="text-base flex-none">📍</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink truncate">{p.name}</span>
                  {p.sub && <span className="block font-mono text-[10px] text-faint truncate">{p.sub}</span>}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wide text-faint flex-none">address</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  // Inline mode: hold the button's 36px slot in the row and overlay the open
  // box from that anchor, so the pill beside it doesn't jump.
  if (overlay) {
    return (
      <>
        <button aria-label="Close search" onClick={() => setOpen(false)} className="absolute inset-0 z-40 w-full h-full bg-black/30 cursor-default" />
        {/* Phones: below the floating top bar (which now sits under the
            status bar, edge-to-edge) — not on top of the clock. */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[var(--ht-map-top,12px)] md:top-3 z-50 w-[min(340px,92vw)]">{body}</div>
      </>
    )
  }
  if (inline) {
    return (
      <div className="relative w-9 h-9 flex-none">
        <div className={(anchor === 'bottom-right' ? 'absolute right-0 bottom-0 flex flex-col-reverse' : 'absolute left-0 top-0') + ' z-30 w-[248px]'}>{body}</div>
      </div>
    )
  }

  return (
    <div style={{ top }} className="absolute left-3 z-20 w-[248px]">{body}</div>
  )
}
