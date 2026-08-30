import { NextRequest, NextResponse } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * Turn-by-turn driving directions for the in-app navigation panel.
 *
 * Proxies OSRM (the public demo server: free, keyless, OSM road data). Server
 * side rather than browser-side so we send one polite User-Agent, keep the
 * key-free host out of the client bundle, and can swap the engine later
 * without touching the map.
 *
 * HONEST LIMIT, surfaced in the UI: OSRM routes on free-flow speed limits.
 * There is no traffic in this ETA. The Traffic layer (TomTom) shows live
 * congestion over the same roads, which is why the directions panel offers
 * it — but the minutes below are "no traffic" minutes and the panel says so.
 */

interface Step {
  instruction: string
  distanceM: number
  /** Street being travelled, when OSRM knows it. */
  name: string | null
  /** 'turn' | 'merge' | 'arrive' … — drives the arrow glyph. */
  type: string
  /** 'left' | 'right' | 'straight' … */
  modifier: string | null
}

const cache = new Map<string, { at: number; body: unknown }>()
const TTL_MS = 60_000
const CACHE_CAP = 200

/** OSRM's maneuver object → one line a driver can act on. */
function instructionFor(m: { type?: string; modifier?: string; exit?: number }, name: string | null): string {
  const t = m.type ?? 'turn'
  const mod = m.modifier ?? ''
  const road = name ? ` onto ${name}` : ''
  const onto = name ? ` on ${name}` : ''
  const dir = mod.replace('slight ', 'slight ').replace('sharp ', 'sharp ')
  switch (t) {
    case 'depart': return name ? `Head out on ${name}` : 'Start driving'
    case 'arrive': return 'Arrive at your destination'
    case 'turn': return `Turn ${dir}${road}`
    case 'new name': return `Continue${onto}`
    case 'merge': return `Merge ${dir}${road}`.replace('Merge ' + road, 'Merge' + road)
    case 'on ramp': return `Take the ramp${road}`
    case 'off ramp': return `Take the exit${road}`
    case 'fork': return `Keep ${dir || 'straight'}${road}`
    case 'end of road': return `Turn ${dir}${road}`
    case 'continue': return `Continue ${dir}`.trim() + onto
    case 'roundabout':
    case 'rotary': return m.exit ? `Take exit ${m.exit} at the roundabout${road}` : `Enter the roundabout${road}`
    case 'exit roundabout':
    case 'exit rotary': return `Exit the roundabout${road}`
    default: return `Continue${onto}`
  }
}

const pair = (v: string | null) => {
  const [a, b] = (v ?? '').split(',').map(Number)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90 ? ([a, b] as [number, number]) : null
}

/** Great-circle km — bounds how much OSRM compute one call can demand. */
function kmBetween(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export async function GET(req: NextRequest) {
  // A person taps a map a few times a minute; a relay scraper doesn't.
  if (ipRateLimited(req, 'route', 30)) {
    return NextResponse.json({ error: 'Slow down a little — try again in a minute.' }, { status: 429 })
  }
  const sp = req.nextUrl.searchParams
  const from = pair(sp.get('from'))
  const to = pair(sp.get('to'))
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to are required as lng,lat' }, { status: 400 })
  }
  // Crews drive to the supply house, not across the continent — the cap
  // also destroys this endpoint's value as a bulk OD-matrix relay.
  if (kmBetween(from, to) > 400) {
    return NextResponse.json({ error: 'That trip is beyond in-app directions — use your maps app for long hauls.' }, { status: 400 })
  }

  const key = `${from.map((n) => n.toFixed(4))}|${to.map((n) => n.toFixed(4))}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body)

  const url = `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?overview=full&geometries=geojson&steps=true&annotations=false`

  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'HammerTrack directions (hello@hammertrack.ai)' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) throw new Error(`router ${r.status}`)
    const j = await r.json()
    const route = j?.routes?.[0]
    if (!route) {
      // OSRM says NoRoute for an unreachable pin (an island, the middle of a
      // lake, a private road it doesn't know) — that's an answer, not a fault.
      return NextResponse.json({ error: 'No driving route to that spot.' }, { status: 404 })
    }

    const steps: Step[] = []
    for (const leg of route.legs ?? []) {
      for (const st of leg.steps ?? []) {
        const name: string | null = st.name || null
        // OSRM emits a zero-length "arrive" per leg; keep only the real last one.
        steps.push({
          instruction: instructionFor(st.maneuver ?? {}, name),
          distanceM: Math.round(st.distance ?? 0),
          name,
          type: st.maneuver?.type ?? 'continue',
          modifier: st.maneuver?.modifier ?? null,
        })
      }
    }

    const body = {
      distanceM: Math.round(route.distance ?? 0),
      durationSec: Math.round(route.duration ?? 0),
      geometry: route.geometry ?? null,
      steps,
      /** The panel prints this; never let an ETA imply we modelled traffic. */
      trafficAware: false,
    }
    cache.set(key, { at: Date.now(), body })
    if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string)
    return NextResponse.json(body)
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'The routing service is slow right now — try again.'
      : 'Could not get directions right now.'
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
