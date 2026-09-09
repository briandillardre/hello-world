import { NextRequest, NextResponse } from 'next/server'
import { getFieldPhotos } from '@/lib/db/photos'

export const dynamic = 'force-dynamic'

/**
 * Photos for the map layer: every geotagged job photo in the window (Live =
 * last 30 days; replays pass their window). Thumbnails ride the response so
 * the map can draw the pictures themselves once you zoom into a site
 * (Google Photos' map, Brian's ask). RLS-scoped through the session.
 */
export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const toMs = Number(q.get('to')) || Date.now()
    const fromMs = Number(q.get('from')) || toMs - 30 * 86_400_000
    const photos = await getFieldPhotos({ fromMs, toMs, limit: 1500 })
    return NextResponse.json({
      photos: photos.map((p) => ({
        id: p.id, lat: p.lat, lng: p.lng, thumb: p.thumb_url ?? p.url, url: p.url, at: p.taken_at,
        zone: p.zone, by: p.by, caption: p.caption, source: p.source, sourceId: p.source_id,
      })),
    })
  } catch {
    return NextResponse.json({ photos: [] })
  }
}
