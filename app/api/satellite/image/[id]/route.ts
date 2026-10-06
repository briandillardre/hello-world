/**
 * GET /api/satellite/image/<zone_imagery id>
 *
 * A licensed satellite picture (Planet) for the zone page and the map. Those
 * pictures live in the PRIVATE `satellite` bucket — Planet's terms forbid
 * letting anyone download them — so their `zone_imagery.url` points here
 * instead of at a public file. The caller must be signed in and able to read
 * the picture's row under RLS (their own company; prospects read imagery by
 * the 119 allow-list); the answer is a two-minute signed link to the file.
 * Sentinel-2 pictures are free and open data and never come through here.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORAGE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (isMock || !UUID.test(params.id)) return new NextResponse(null, { status: 404 })
  if (ipRateLimited(req, 'satellite-image', 240)) return new NextResponse(null, { status: 429 })
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const sb = createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })
  // Readable under the caller's own RLS, or it doesn't exist for them.
  const { data: img } = await sb.from('zone_imagery').select('id').eq('id', params.id).maybeSingle()
  if (!img) return new NextResponse(null, { status: 404 })
  const svc = createServiceClient()
  const { data: scene } = await svc.from('satellite_scenes').select('storage_path').eq('imagery_id', params.id).maybeSingle()
  const path = scene?.storage_path as string | null | undefined
  if (!path || !STORAGE_PATH.test(path)) return new NextResponse(null, { status: 404 })
  const { data: signed } = await svc.storage.from('satellite').createSignedUrl(path, 120)
  if (!signed?.signedUrl) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'cache-control': 'private, max-age=60' } })
}
