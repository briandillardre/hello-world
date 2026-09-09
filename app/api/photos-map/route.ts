import { NextRequest, NextResponse } from 'next/server'
import { getFieldPhotos } from '@/lib/db/photos'
import { safeHttps } from '@/lib/safe-url'
import { getMyPermissions } from '@/lib/permissions-server'

export const dynamic = 'force-dynamic'

/**
 * Photos for the map layer: every geotagged job photo in the window (Live =
 * last 30 days; replays pass their window). Thumbnails ride the response so
 * the map can draw the pictures themselves once you zoom into a site
 * (Google Photos' map, Brian's ask). RLS-scoped through the session.
 */
export async function GET(req: NextRequest) {
  try {
    // Same view level as /logs and /photos.
    if (!(await getMyPermissions()).features.includes('logs')) return NextResponse.json({ photos: [] })
    const q = new URL(req.url).searchParams
    const toMs = Number(q.get('to')) || Date.now()
    const fromMs = Number(q.get('from')) || toMs - 30 * 86_400_000
    const photos = await getFieldPhotos({ fromMs, toMs, limit: 1500 })
    return NextResponse.json({
      photos: photos
        .map((p) => ({ ...p, safeUrl: safeHttps(p.url, { ourHostOnly: true }), safeThumb: safeHttps(p.thumb_url ?? p.url, { ourHostOnly: true }) }))
        .filter((p) => p.safeUrl)
        .map((p) => ({
          id: p.id, lat: p.lat, lng: p.lng, thumb: p.safeThumb ?? p.safeUrl, url: p.safeUrl, at: p.taken_at,
          zone: p.zone, by: p.by, caption: p.caption, source: p.source, sourceId: p.source_id,
        })),
    })
  } catch {
    return NextResponse.json({ photos: [] })
  }
}
