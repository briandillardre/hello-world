/**
 * GET /api/plans/image/<zone_imagery id>[?w=160]
 *
 * A plan sheet's picture (migration 144). Since the Nov 7 sec-check the
 * pictures of new uploads live in the PRIVATE `plans` bucket beside their
 * PDFs — a public URL works forever once it is forwarded — so their
 * `zone_imagery.url` points here. The caller must be signed in and able to
 * read the picture's row under RLS; the answer is a two-minute signed link
 * (a resized one for thumbnails). The satellite route is the pattern.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (isMock || !UUID.test(params.id)) return new NextResponse(null, { status: 404 })
  if (ipRateLimited(req, 'plan-image', 600)) return new NextResponse(null, { status: 429 })
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const sb = createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })
  // Readable under the caller's own RLS, or it doesn't exist for them.
  const { data: img } = await sb.from('zone_imagery').select('id, company_id, kind').eq('id', params.id).maybeSingle()
  if (!img || img.kind !== 'plan' || !UUID.test(String(img.company_id))) return new NextResponse(null, { status: 404 })
  const path = `${img.company_id}/img/${img.id}`
  const w = Number(new URL(req.url).searchParams.get('w'))
  const width = Number.isInteger(w) && w >= 40 && w <= 800 ? w : null
  const { data: signed } = await createServiceClient().storage.from('plans')
    .createSignedUrl(path, 120, width ? { transform: { width, height: width, resize: 'contain' } } : undefined)
  if (!signed?.signedUrl) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'cache-control': 'private, max-age=60' } })
}
