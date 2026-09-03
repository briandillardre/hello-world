import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Community weather stations for the map — the Ambient Weather public
 * network, proxied server-side (their map feed is keyless but has no CORS).
 * Compact payload, 5-minute cache per area. Unofficial feed: if Ambient
 * ever reshapes it this degrades to an empty layer, never a broken map.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface PwsStation {
  id: string
  name: string
  lat: number
  lng: number
  tempF: number | null
  feelsF: number | null
  windMph: number | null
  gustMph: number | null
  humidity: number | null
  rainInHr: number | null
  ageMin: number | null
  /** Observation time, epoch ms (Ambient dateutc) — the popup's "as of". */
  obsAt: number | null
}

const cache = new Map<string, { at: number; stations: PwsStation[] }>()
const TTL_MS = 5 * 60_000

function demoStations(): PwsStation[] {
  // A handful around the demo site so the layer shows off without the feed.
  const base = { lat: 36.165, lng: -86.785 }
  return Array.from({ length: 7 }, (_, i) => ({
    id: `demo-${i}`,
    name: ['Riverfront WX', 'Maple St Station', 'East Bank', 'Germantown', 'The Gulch', 'Shelby Park', 'Sylvan Park'][i],
    lat: base.lat + (Math.sin(i * 2.1) * 0.05),
    lng: base.lng + (Math.cos(i * 1.7) * 0.07),
    tempF: 82 + i * 2,
    feelsF: 86 + i * 2,
    windMph: 4 + i,
    gustMph: 9 + i,
    humidity: 62 - i * 3,
    rainInHr: i === 2 ? 0.12 : 0,
    ageMin: 1 + i,
    obsAt: Date.now() - (1 + i) * 60_000,
  }))
}

export async function GET(req: NextRequest) {
  const bbox = (req.nextUrl.searchParams.get('bbox') ?? '').split(',').map(Number)
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 })
  }
  let [w, s, e, n] = bbox
  // Clamp to a sane area so a zoomed-out map doesn't ask for the planet.
  if (e - w > 6) { const c = (e + w) / 2; w = c - 3; e = c + 3 }
  if (n - s > 6) { const c = (n + s) / 2; s = c - 3; n = c + 3 }

  if (isMock) return NextResponse.json({ stations: demoStations() })

  // Half-degree buckets keep the cache warm as the map pans around town.
  const key = [w, s, e, n].map((v) => (Math.round(v * 2) / 2).toFixed(1)).join(',')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ stations: hit.stations }, { headers: { 'Cache-Control': 'private, max-age=120' } })
  }

  let stations: PwsStation[] = []
  try {
    const url = `https://lightning.ambientweather.net/devices?$publicBox[0][0]=${w}&$publicBox[0][1]=${s}&$publicBox[1][0]=${e}&$publicBox[1][1]=${n}&$limit=250`
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'HammerTrack weather map' },
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) {
      const j = await r.json() as { data?: Array<Record<string, unknown>> }
      stations = (j.data ?? []).flatMap((d) => {
        const info = d.info as { name?: string; coords?: { coords?: { lat?: number; lon?: number }; geo?: { coordinates?: number[] } } } | undefined
        const last = d.lastData as Record<string, unknown> | undefined
        const lat = info?.coords?.coords?.lat ?? info?.coords?.geo?.coordinates?.[1]
        const lng = info?.coords?.coords?.lon ?? info?.coords?.geo?.coordinates?.[0]
        if (typeof lat !== 'number' || typeof lng !== 'number' || !last) return []
        const num = (k: string) => (typeof last[k] === 'number' ? (last[k] as number) : null)
        const at = typeof last.dateutc === 'number' ? (last.dateutc as number) : null
        return [{
          id: String(d.macAddress ?? d._id ?? `${lat},${lng}`),
          name: info?.name || 'Weather station',
          lat, lng,
          tempF: num('tempf'),
          feelsF: num('feelsLike'),
          windMph: num('windspeedmph'),
          gustMph: num('windgustmph'),
          humidity: num('humidity'),
          rainInHr: num('hourlyrainin'),
          ageMin: at ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : null,
          obsAt: at,
        }]
      })
    }
  } catch { /* feed down — empty layer, not a broken map */ }

  if (stations.length || !hit) cache.set(key, { at: Date.now(), stations })
  if (cache.size > 200) cache.clear()
  return NextResponse.json({ stations }, { headers: { 'Cache-Control': 'private, max-age=120' } })
}
