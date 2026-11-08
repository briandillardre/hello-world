import { NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { buildTakeoff } from '@/lib/takeoff-summary'
import { takeoffWorkbook } from '@/lib/takeoff-export'
import { buildXlsx } from '@/lib/xlsx'

export const dynamic = 'force-dynamic'

/**
 * The site's takeoff as an Excel workbook (migration 146): Summary with live
 * qty × price formulas, By sheet, By revision against a snapshot, Sheets,
 * Memo. Signed-in, the plans view level, the caller's own company; dollar
 * columns only for a login that can see costs.
 */
export async function GET(req: Request, { params }: { params: { zoneId: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.zoneId)) return NextResponse.json({ error: 'Bad site' }, { status: 400 })
  const perms = await getMyPermissions()
  if (!perms.features.includes('plans')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in' }, { status: 401 })
  const companyId = await getCurrentCompanyId()
  // The site must be one this login can read (RLS) — then the service client sums it.
  const { data: zone } = await db.from('geofences').select('id').eq('id', params.zoneId).maybeSingle()
  if (!zone) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const t = await buildTakeoff(createServiceClient(), companyId, params.zoneId, perms.canViewCosts)
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const snapId = new URL(req.url).searchParams.get('snapshot')
  let snapshot = null
  if (snapId && /^[0-9a-f-]{36}$/i.test(snapId)) {
    const { data } = await db.from('takeoff_snapshots').select('name, created_at, data').eq('id', snapId).eq('geofence_id', params.zoneId).maybeSingle()
    if (data) snapshot = { name: String(data.name), createdAt: String(data.created_at), data: data.data as { items: { code: string; name: string; unit: string; qty: number }[] } }
  }
  const { data: memo } = await db.from('bid_memos').select('body').eq('geofence_id', params.zoneId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const bytes = buildXlsx(takeoffWorkbook(t, { costs: perms.canViewCosts, snapshot, memo: (memo?.body as string | undefined) ?? null }))
  const name = `${t.zoneName.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'site'}-takeoff.xlsx`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
