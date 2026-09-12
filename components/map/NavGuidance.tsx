'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUp, CornerUpLeft, CornerUpRight,
  Flag, Merge, Volume2, VolumeX, X,
} from 'lucide-react'
import {
  cumulativeDistances, stepAnchors, snapToRoute, guidanceAt, bearingBetween,
  showDistance, showDuration, arrivalClock, rungFor, phraseFor,
  OFF_ROUTE_M, OFF_ROUTE_STRIKES,
  type NavStep, type LngLat, type Rung,
} from '@/lib/navigation'

/**
 * Turn-by-turn guidance (Brian, Sep 12: "I want turn by turn navigation").
 *
 * The preview panel is a list you read before you go; this is the screen you
 * drive with. It owns the phone's fix, walks it along the route, and answers
 * the only question that matters at 45 mph: what do I do, and when.
 *
 * Shape of the screen, from the top:
 *   · the maneuver band — arrow, distance to it, the street you turn onto
 *   · a thin "then" strip for the one after, so a quick double turn is not
 *     a surprise
 *   · the trip bar at the bottom — arrival clock, time left, distance left,
 *     mute, and End
 *
 * Voice rides the browser's own speech synthesis (no key, no network, works
 * inside the Capacitor WebView). Every announcement fires once per step at
 * one of four distances; a re-route resets the ladder.
 *
 * HONESTY, same rule as the preview panel: the ETA is OSRM's free-flow
 * number, so the trip bar tags it "no traffic". A navigator that quietly
 * implies it knows about the backup on 385 is worse than one that says it
 * doesn't.
 */

function maneuverIcon(type: string, modifier: string | null) {
  const mod = modifier ?? ''
  if (type === 'arrive') return Flag
  if (type === 'merge') return Merge
  if (mod.includes('uturn')) return CornerUpLeft
  if (mod === 'slight left') return CornerUpLeft
  if (mod === 'slight right') return CornerUpRight
  if (mod.includes('left')) return ArrowLeft
  if (mod.includes('right')) return ArrowRight
  return ArrowUp
}

const VOICE_KEY = 'ht_nav_voice'

export interface NavRoute {
  distanceM: number
  durationSec: number
  geometry: GeoJSON.LineString
  steps: NavStep[]
}

export function NavGuidance({
  route, dest, onReroute, onFollow, onProgress, onEnd,
}: {
  route: NavRoute
  dest: { lat: number; lng: number; name: string }
  /** Ask the parent for a fresh route from here; it hands back the new one
   *  (or null when routing failed, which leaves the old line up). */
  onReroute: (from: { lat: number; lng: number }) => Promise<NavRoute | null>
  /** Drive the camera: chase view, heading up. */
  onFollow: (lng: number, lat: number, bearing: number) => void
  /** Where the driver is on the line, so the map can draw the travelled part
   *  differently and put the puck on the road instead of in the ditch. */
  onProgress: (snapped: LngLat, alongM: number, bearing: number) => void
  onEnd: () => void
}) {
  const [live, setLive] = useState(route)
  const [voice, setVoice] = useState(true)
  const [arrived, setArrived] = useState(false)
  const [gpsLost, setGpsLost] = useState(false)
  const [view, setView] = useState<{
    stepIndex: number; toManeuverM: number; remainingM: number; remainingSec: number; offRouteM: number
  } | null>(null)

  // Derived once per route: the spine (metres at each vertex) and where each
  // maneuver sits on it. Rebuilt on a re-route, never on a fix.
  const idx = useRef({ coords: [] as LngLat[], cum: [] as number[], anchors: [] as number[] })
  const lastIndex = useRef(0)
  const saidRef = useRef(new Map<number, Set<Rung>>())
  const strikes = useRef(0)
  const rerouting = useRef(false)
  const endedRef = useRef(false)

  useEffect(() => {
    const coords = (live.geometry?.coordinates ?? []) as LngLat[]
    const cum = cumulativeDistances(coords)
    idx.current = { coords, cum, anchors: stepAnchors(live.steps, coords, cum) }
    lastIndex.current = 0
    saidRef.current = new Map()
  }, [live])

  useEffect(() => {
    try { setVoice(localStorage.getItem(VOICE_KEY) !== '0') } catch { /* private mode */ }
  }, [])
  const toggleVoice = () => {
    setVoice((v) => {
      const next = !v
      try { localStorage.setItem(VOICE_KEY, next ? '1' : '0') } catch { /* fine */ }
      if (!next && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
      return next
    })
  }

  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const say = useCallback((text: string) => {
    if (!voiceRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.05
      u.volume = 1
      // A queued backlog is worse than silence — the corner has passed by the
      // time the third sentence plays.
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    } catch { /* WebView without TTS: the band on screen still says it */ }
  }, [])

  // Stable refs for the watch callback: it is registered once for the life of
  // the drive, so it must not close over changing state.
  const liveRef = useRef(live)
  liveRef.current = live
  const onFollowRef = useRef(onFollow); onFollowRef.current = onFollow
  const onProgressRef = useRef(onProgress); onProgressRef.current = onProgress
  const onRerouteRef = useRef(onReroute); onRerouteRef.current = onReroute

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setGpsLost(true); return }
    let lastPos: LngLat | null = null

    const onFix = (p: GeolocationPosition) => {
      if (endedRef.current) return
      setGpsLost(false)
      const pos: LngLat = [p.coords.longitude, p.coords.latitude]
      const { coords, cum, anchors } = idx.current
      if (coords.length < 2) return

      const snap = snapToRoute(coords, cum, pos, lastIndex.current)
      // Heading: the device's own course when it has one (it is smoother at
      // speed), else the direction the road runs where we are.
      const course = Number.isFinite(p.coords.heading as number) && (p.coords.speed ?? 0) > 1.5
        ? (p.coords.heading as number)
        : bearingBetween(coords[snap.index], coords[Math.min(coords.length - 1, snap.index + 1)])

      // Off the line? Count strikes before believing it — one wild fix in a
      // parking garage is not a wrong turn.
      if (snap.offRouteM > OFF_ROUTE_M) {
        strikes.current++
        if (strikes.current >= OFF_ROUTE_STRIKES && !rerouting.current) {
          rerouting.current = true
          say('Rerouting')
          onRerouteRef.current({ lat: pos[1], lng: pos[0] })
            .then((next) => { if (next && !endedRef.current) setLive(next) })
            .finally(() => { rerouting.current = false; strikes.current = 0 })
        }
      } else {
        strikes.current = 0
        lastIndex.current = snap.index
      }

      const g = guidanceAt(liveRef.current.steps, anchors, liveRef.current.distanceM, liveRef.current.durationSec, snap.alongM)
      setView({
        stepIndex: g.stepIndex,
        toManeuverM: g.toManeuverM,
        remainingM: g.remainingM,
        remainingSec: g.remainingSec,
        offRouteM: snap.offRouteM,
      })

      onFollowRef.current(snap.snapped[0], snap.snapped[1], course)
      onProgressRef.current(snap.snapped, snap.alongM, course)
      lastPos = pos

      if (g.arrived) {
        if (!endedRef.current) {
          endedRef.current = true
          setArrived(true)
          say('You have arrived.')
        }
        return
      }

      // The ladder: one announcement per step per rung, only on the way down.
      const step = liveRef.current.steps[g.stepIndex]
      if (!step) return
      const rung = rungFor(g.toManeuverM)
      if (rung == null) return
      let said = saidRef.current.get(g.stepIndex)
      if (!said) { said = new Set(); saidRef.current.set(g.stepIndex, said) }
      if (said.has(rung)) return
      // Mark every rung above this one as spent, so a step entered late does
      // not fire "in one mile" after the mile is gone.
      for (const r of [1600, 800, 300, 60] as Rung[]) if (r >= rung) said.add(r)
      say(phraseFor(step, rung, g.toManeuverM))
    }

    const id = navigator.geolocation.watchPosition(
      onFix,
      () => { setGpsLost(true); if (!lastPos) setView(null) },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
    )
    return () => {
      navigator.geolocation.clearWatch(id)
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    }
    // One watcher for the whole drive; a re-route swaps the data under it.
  }, [say])

  useEffect(() => () => { endedRef.current = true }, [])

  const steps = live.steps
  const step = view ? steps[view.stepIndex] : steps[0]
  const next = view ? steps[view.stepIndex + 1] : steps[1]
  const Icon = maneuverIcon(step?.type ?? 'continue', step?.modifier ?? null)
  const NextIcon = next ? maneuverIcon(next.type, next.modifier) : null

  return (
    <>
      {/* ── the maneuver band ── */}
      <div
        className="absolute inset-x-0 z-40 px-2 pointer-events-none"
        style={{ top: 'calc(var(--ht-safe-top, 0px) + 8px)' }}
      >
        <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-teal/30 bg-navy-950/95 backdrop-blur shadow-panel overflow-hidden">
          {arrived ? (
            <div className="flex items-center gap-3 p-4">
              <span className="grid place-items-center h-12 w-12 rounded-xl bg-teal/15 border border-teal/40 flex-none">
                <Flag className="h-6 w-6 text-teal" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-black text-lg text-ink leading-tight">You&apos;re here</p>
                <p className="text-[12.5px] text-muted truncate">{dest.name}</p>
              </div>
              <button
                onClick={onEnd}
                className="flex-none rounded-lg bg-teal text-[#04212b] font-display font-bold text-sm px-4 py-2.5"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3.5">
                <span className="grid place-items-center h-14 w-14 rounded-xl bg-teal/15 border border-teal/40 flex-none">
                  <Icon className="h-8 w-8 text-teal" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-black text-[26px] leading-none text-ink tabular-nums">
                    {view ? showDistance(view.toManeuverM) : '—'}
                  </p>
                  <p className="text-[14px] text-ink leading-snug mt-1 line-clamp-2">
                    {step?.instruction ?? 'Starting…'}
                  </p>
                </div>
                <button
                  onClick={toggleVoice}
                  aria-label={voice ? 'Mute voice' : 'Unmute voice'}
                  aria-pressed={voice}
                  className={'flex-none grid place-items-center h-10 w-10 rounded-lg border transition-colors ' +
                    (voice ? 'bg-navy-800 border-navy-700 text-ink' : 'bg-navy-900 border-navy-800 text-faint')}
                >
                  {voice ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
                </button>
              </div>

              {next && (
                <div className="flex items-center gap-2 px-3.5 py-2 bg-navy-900/80 border-t border-navy-800">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint flex-none">then</span>
                  {NextIcon && <NextIcon className="h-3.5 w-3.5 text-muted flex-none" />}
                  <span className="text-[12px] text-muted truncate">{next.instruction}</span>
                </div>
              )}
            </>
          )}

          {gpsLost && !arrived && (
            <p className="px-3.5 py-2 bg-amber/10 border-t border-amber/30 text-[11.5px] text-amber">
              Waiting for GPS — guidance pauses until your location comes back.
            </p>
          )}
          {!gpsLost && view && view.offRouteM > OFF_ROUTE_M && !arrived && (
            <p className="px-3.5 py-2 bg-amber/10 border-t border-amber/30 text-[11.5px] text-amber">
              Off the route — finding a new way.
            </p>
          )}
        </div>
      </div>

      {/* ── the trip bar ── */}
      {!arrived && (
        <div
          className="absolute inset-x-0 z-40 px-2 pointer-events-none"
          style={{ bottom: 'calc(var(--ht-safe-bottom, 0px) + 62px)' }}
        >
          <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-navy-700 bg-navy-950/95 backdrop-blur shadow-panel flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="font-display font-black text-lg text-ink leading-none tabular-nums">
                {view ? arrivalClock(view.remainingSec) : '—'}
              </p>
              <p className="font-mono text-[10.5px] text-faint mt-1 truncate">
                {view ? `${showDuration(view.remainingSec)} · ${showDistance(view.remainingM)}` : 'locating…'}
                <span className="text-faint/70"> · no traffic</span>
              </p>
            </div>
            <button
              onClick={onEnd}
              className="flex-none inline-flex items-center gap-1.5 rounded-lg bg-alert/15 border border-alert/40 text-alert text-sm font-semibold px-3.5 py-2 hover:bg-alert/25 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> End
            </button>
          </div>
        </div>
      )}
    </>
  )
}
