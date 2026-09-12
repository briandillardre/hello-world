'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Fix } from '@/lib/aircraft-log'
import type { PatternWork } from '@/lib/pattern'
import { PatternCard } from './PatternCard'
import { FlightProfile } from './FlightProfile'
import type { FlightRow } from './FlightLog'

/**
 * One expanded flight: a plan view of the track, then the three profile
 * charts. The track is fetched only when a flight is actually opened — a
 * month of tracks up front is megabytes nobody asked for.
 */
export function FlightDetail({ flight }: { flight: FlightRow }) {
  const [track, setTrack] = useState<Fix[] | null>(null)
  const [pattern, setPattern] = useState<PatternWork[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setTrack(null); setPattern([]); setError(null)
    fetch(`/api/aircraft/flight?id=${encodeURIComponent(flight.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return
        setPattern(Array.isArray(j?.flight?.pattern) ? (j.flight.pattern as PatternWork[]) : [])
        if (j?.flight?.track?.length) setTrack(j.flight.track as Fix[])
        else setError('No track was recorded for this flight.')
      })
      .catch(() => { if (live) setError('Could not load this flight.') })
    return () => { live = false }
  }, [flight.id])

  return (
    <div className="mt-1.5 space-y-2 rounded-xl border border-navy-800 bg-navy-950 p-2.5">
      {!track && !error && (
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the track…
        </p>
      )}
      {error && <p className="text-[12px] text-faint">{error}</p>}
      {track && (
        <>
          <PlanView track={track} />
          {/* Circuits before the profile charts: on a flight with pattern
              work, "how were the laps" is the question, and the altitude
              trace is just four sawteeth until you know that. */}
          {pattern.filter((w) => w.circuits.length > 0).map((w) => (
            <PatternCard key={w.field.ident} work={w} />
          ))}
          <FlightProfile track={track} touchdowns={pattern.flatMap((w) => w.approaches.map((a) => a.at))} />
        </>
      )}
    </div>
  )
}

/**
 * The shape of the flight from above — enough to recognise it at a glance
 * ("that's the Charleston run") without loading a map engine into a list row.
 * Equirectangular with a cos(lat) correction, which is honest at the scale of
 * one flight.
 */
function PlanView({ track }: { track: Fix[] }) {
  const pts = track.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
  if (pts.length < 2) return null

  const PAD = 14
  const MAX_H = 220
  const midLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const kx = Math.cos((midLat * Math.PI) / 180)
  const xs = pts.map((p) => p.lon * kx)
  const ys = pts.map((p) => p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)

  /**
   * The FRAME takes the flight's shape, instead of the flight being letter-
   * boxed into a fixed frame. Both earlier attempts left most of the box
   * empty — a Charleston–Greenville hop is nearly square, and a 6:1 strip
   * drew it as a short scratch in a void.
   *
   * So: the viewBox carries the true geographic aspect (no distortion — the
   * shape is the point), the SVG fills the card's width, and `maxWidth`
   * bounds the height that implies. A square route renders as a centred
   * square, a long east–west leg as a full-width strip.
   */
  const aspect = Math.max(0.75, Math.min(6.5, spanX / spanY))
  const VB_H = 200
  const VB_W = VB_H * aspect
  const fit = Math.min((VB_W - PAD * 2) / spanX, (VB_H - PAD * 2) / spanY)
  const ox = (VB_W - spanX * fit) / 2
  const oy = (VB_H - spanY * fit) / 2
  const px = (i: number) => ox + (xs[i] - minX) * fit
  // Latitude grows north, screen y grows down.
  const py = (i: number) => VB_H - (oy + (ys[i] - minY) * fit)

  const d = pts.map((_, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(i).toFixed(1)}`).join(' ')
  const last = pts.length - 1

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VB_W.toFixed(0)} ${VB_H}`}
        width="100%"
        height="auto"
        style={{ maxWidth: Math.round(MAX_H * aspect), display: 'block', margin: '0 auto' }}
        className="rounded-lg bg-navy-900"
        role="img"
        aria-label="The path this flight took, seen from above"
      >
        <path d={d} fill="none" stroke="#ff9e16" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        {/* Takeoff hollow, landing filled — direction without an arrowhead. */}
        <circle cx={px(0)} cy={py(0)} r={4.5} fill="#00203a" stroke="#2dd4bf" strokeWidth={2} />
        <circle cx={px(last)} cy={py(last)} r={4.5} fill="#2dd4bf" stroke="#00203a" strokeWidth={2} />
      </svg>
      <figcaption className="mt-1 text-center text-[10.5px] text-faint">
        The path from above — hollow marks the takeoff, solid the landing.
      </figcaption>
    </figure>
  )
}
