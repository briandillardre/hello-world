import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Public webcams near the map view — Windy Webcams API v3, proxied so the
 * key stays server-side and the free tier (500 calls/day) survives a wall
 * display: responses cache 10 minutes per area bucket.
 * No WINDY_WEBCAMS_KEY → 501 and the layer just stays empty.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface WebcamPoint {
  id: string
  title: string
  lat: number
  lng: number
  thumb: string | null
  page: string | null
}

const cache = new Map<string, { at: number; cams: WebcamPoint[] }>()
const TTL_MS = 10 * 60_000

export async function GET(req: NextRequest) {
  const bbox = (req.nextUrl.searchParams.get('bbox') ?? '').split(',').map(Number)
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 })
  }
  let [w, s, e, n] = bbox
  if (e - w > 6) { const c = (e + w) / 2; w = c - 3; e = c + 3 }
  if (n - s > 6) { const c = (n + s) / 2; s = c - 3; n = c + 3 }

  if (isMock) {
    // Demo: a couple of placeholder cams so the layer demos without a key.
    return NextResponse.json({
      cams: [
        { id: 'demo-1', title: 'I-24 @ Downtown', lat: 36.155, lng: -86.77, thumb: null, page: null },
        { id: 'demo-2', title: 'Riverfront crane cam', lat: 36.17, lng: -86.79, thumb: null, page: null },
      ] satisfies WebcamPoint[],
    })
  }

  const key = process.env.WINDY_WEBCAMS_KEY
  if (!key) return NextResponse.json({ error: 'add WINDY_WEBCAMS_KEY (free at api.windy.com) to enable webcams' }, { status: 501 })

  const bucket = [w, s, e, n].map((v) => (Math.round(v * 2) / 2).toFixed(1)).join(',')
  const hit = cache.get(bucket)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ cams: hit.cams }, { headers: { 'Cache-Control': 'private, max-age=300' } })
  }

  let cams: WebcamPoint[] = []
  try {
    // Windy v3: bbox is "north,east,south,west" (their order, not ours).
    const r = await fetch(
      `https://api.windy.com/webcams/api/v3/webcams?bbox=${n},${e},${s},${w}&include=images,location,urls&limit=50`,
      { headers: { 'x-windy-api-key': key }, signal: AbortSignal.timeout(8000) }
    )
    if (r.ok) {
      const j = await r.json() as { webcams?: Array<{ webcamId?: number; title?: string; location?: { latitude?: number; longitude?: number }; images?: { current?: { preview?: string; thumbnail?: string } }; urls?: { detail?: string } }> }
      cams = (j.webcams ?? []).flatMap((c) => {
        const lat = c.location?.latitude
        const lng = c.location?.longitude
        if (typeof lat !== 'number' || typeof lng !== 'number') return []
        return [{
          id: String(c.webcamId ?? `${lat},${lng}`),
          title: c.title ?? 'Webcam',
          lat, lng,
          thumb: c.images?.current?.preview ?? c.images?.current?.thumbnail ?? null,
          page: c.urls?.detail ?? null,
        }]
      })
    }
  } catch { /* Windy down — empty layer, never a broken map */ }

  if (cams.length || !hit) cache.set(bucket, { at: Date.now(), cams })
  if (cache.size > 200) cache.clear()
  return NextResponse.json({ cams }, { headers: { 'Cache-Control': 'private, max-age=300' } })
}
