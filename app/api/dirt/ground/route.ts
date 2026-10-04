/**
 * GET /api/dirt/ground?takeoff=<id>&bbox=minLng,minLat,maxLng,maxLat
 *
 * Existing ground for the takeoff editor: the USGS 1 m lidar grid under a site
 * (lib/dirt/ground.ts), as the HTDG binary (lib/dirt/ground-format.ts).
 *
 * Signed in, the `zones` view level, a company with the dirt add-on, never a
 * prospect — and only near one of the caller's own takeoffs (its zone's
 * outline or saved traces, plus 1.5 km), so a login can't use this to pull
 * elevation for anywhere in the country. New USGS reads are capped per person
 * (lib/dirt/ground.ts). A grid already in the bucket is handed over as a
 * short-lived signed link (a big site's grid is 6–8 MB — past what a function
 * response should carry); anything else streams.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive, takeoffExtent } from '@/lib/db/dirt'
import { boxInside, boxTooBig, growBox, parseBox } from '@/lib/dirt/ground-box'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NEAR_M = 1500

function stream(bytes: Uint8Array): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1 << 18) c.enqueue(bytes.subarray(i, Math.min(bytes.length, i + (1 << 18))))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  // The editor can't exist in demo mode — only local development reads here without a login.
  if (isMock && process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (ipRateLimited(req, 'dirt-ground', 20)) return NextResponse.json({ error: 'Too many requests — wait a minute.' }, { status: 429 })
  const sp = req.nextUrl.searchParams
  const parts = (sp.get('bbox') ?? '').split(',').map(Number)
  const box = parts.length === 4 ? parseBox({ minLng: parts[0], minLat: parts[1], maxLng: parts[2], maxLat: parts[3] }) : null
  if (!box) return NextResponse.json({ error: 'bbox=minLng,minLat,maxLng,maxLat' }, { status: 400 })
  if (boxTooBig(box)) return NextResponse.json({ error: 'Lidar is read for sites up to about 3 km across.' }, { status: 413 })
  const takeoffId = sp.get('takeoff') ?? ''

  let svc: unknown = null
  let companyId = 'demo'
  let who: string | undefined
  if (!isMock) {
    if (!UUID.test(takeoffId)) return NextResponse.json({ error: 'Which takeoff is this for?' }, { status: 400 })
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
    const perms = await getMyPermissions()
    if (isProspect(perms) || !perms.features.includes('zones')) return NextResponse.json({ error: 'Not available for this login.' }, { status: 403 })
    const cid = await getCurrentCompanyId()
    if (!cid || !(await dirtAddonActive(cid))) return NextResponse.json({ error: 'Dirt takeoff is an add-on — ask us to turn it on.' }, { status: 403 })
    const near = await takeoffExtent(takeoffId)
    if (!near) return NextResponse.json({ error: 'That takeoff was not found.' }, { status: 404 })
    if (!boxInside(box, growBox(near, NEAR_M))) return NextResponse.json({ error: 'Lidar is read near this takeoff’s site only — save your traces first if they reach farther out.' }, { status: 403 })
    companyId = cid
    who = user.id
    svc = createServiceClient()
  }

  try {
    const { groundCached } = await import('@/lib/dirt/ground')
    const g = await groundCached(svc as never, box, AbortSignal.timeout(45000), { companyId, who })
    if (g.stored && svc) {
      const { data } = await (svc as { storage: { from(b: string): { createSignedUrl(p: string, s: number): Promise<{ data: { signedUrl: string } | null }> } } })
        .storage.from('dirt').createSignedUrl(g.stored, 120)
      if (data?.signedUrl) {
        const res = NextResponse.redirect(data.signedUrl, 302)
        res.headers.set('cache-control', 'no-store')
        return res
      }
    }
    return stream(g.bytes)
  } catch (e) {
    if (e instanceof Error && e.name === 'GroundBusy') return NextResponse.json({ error: e.message }, { status: 429 })
    console.error('dirt ground failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'USGS elevation did not answer — try again in a minute.' }, { status: 503 })
  }
}
