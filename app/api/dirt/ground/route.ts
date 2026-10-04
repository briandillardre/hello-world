/**
 * GET /api/dirt/ground?bbox=minLng,minLat,maxLng,maxLat
 *
 * Existing ground for the takeoff editor: the USGS 1 m lidar grid under a site
 * (lib/dirt/ground.ts), as the HTDG binary (lib/dirt/ground-format.ts).
 * Signed in, company with the dirt add-on, never a prospect; ~3 km max; the
 * grid is cached so the server's own run on Save reads the same numbers.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { boxTooBig, type LngLatBox } from '@/lib/dirt/ground-box'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function GET(req: NextRequest) {
  if (ipRateLimited(req, 'dirt-ground', 20)) return NextResponse.json({ error: 'Too many requests — wait a minute.' }, { status: 429 })
  const parts = (req.nextUrl.searchParams.get('bbox') ?? '').split(',').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return NextResponse.json({ error: 'bbox=minLng,minLat,maxLng,maxLat' }, { status: 400 })
  const box: LngLatBox = { minLng: parts[0], minLat: parts[1], maxLng: parts[2], maxLat: parts[3] }
  if (box.minLng >= box.maxLng || box.minLat >= box.maxLat || box.minLng < -180 || box.maxLng > 180 || box.minLat < -85 || box.maxLat > 85) {
    return NextResponse.json({ error: 'That box is not a place on the map.' }, { status: 400 })
  }
  if (boxTooBig(box)) return NextResponse.json({ error: 'Lidar is read for sites up to about 3 km across.' }, { status: 413 })

  let svc: unknown = null
  if (!isMock) {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
    const perms = await getMyPermissions()
    if (isProspect(perms)) return NextResponse.json({ error: 'Not available for this login.' }, { status: 403 })
    const companyId = await getCurrentCompanyId()
    if (!(await dirtAddonActive(companyId))) return NextResponse.json({ error: 'Dirt takeoff is an add-on — ask us to turn it on.' }, { status: 403 })
    svc = createServiceClient()
  }

  try {
    const { groundCached } = await import('@/lib/dirt/ground')
    const g = await groundCached(svc as never, box, AbortSignal.timeout(45000))
    return new NextResponse(Buffer.from(g.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'private, max-age=86400',
        'x-ground-source': encodeURIComponent(g.header.source),
        'x-ground-cached': g.cached ? '1' : '0',
      },
    })
  } catch (e) {
    console.error('dirt ground failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'USGS elevation did not answer — try again in a minute.' }, { status: 503 })
  }
}
