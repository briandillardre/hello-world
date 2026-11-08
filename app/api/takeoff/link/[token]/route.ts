import { NextResponse } from 'next/server'
import { permissionsOf } from '@/lib/permissions-server'
import { ipRateLimited } from '@/lib/rate-limit'
import { buildTakeoff } from '@/lib/takeoff-summary'
import { takeoffCsvRows } from '@/lib/takeoff-export'
import { toCsv } from '@/lib/xlsx'

export const dynamic = 'force-dynamic'

/**
 * A site's takeoff as CSV behind a private, revocable link (migration 146) —
 * what Google Sheets' IMPORTDATA and Excel's Power Query (Data → From Web)
 * read. The link is the credential: 32 random letters, made by an editor,
 * carrying dollars only when its maker could see costs. Quantities only flow
 * out; nothing a spreadsheet does can change a takeoff.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.csv$/i, '')
  if (!/^[A-Za-z0-9]{24,40}$/.test(token)) return new NextResponse('Not found', { status: 404 })
  if (ipRateLimited(req, 'takeoff-link', 60)) return new NextResponse('Slow down', { status: 429 })
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: link } = await svc.from('takeoff_links').select('token, company_id, geofence_id, include_costs, revoked_at, last_used_at, created_by').eq('token', token).maybeSingle()
  if (!link || link.revoked_at) return new NextResponse('Not found', { status: 404 })
  // A link lives only while the person who made it is still on the team —
  // someone who leaves doesn't keep a feed of the company's quantities.
  const maker = link.created_by ? await permissionsOf(svc, String(link.created_by), String(link.company_id)) : null
  if (!maker) return new NextResponse('Not found', { status: 404 })
  // Prices only while the maker can still see them (their costs switch can be
  // turned off after the link was made — sec-check, Nov 8); quantities otherwise.
  const withCosts = !!link.include_costs && maker.canViewCosts
  const t = await buildTakeoff(svc, String(link.company_id), String(link.geofence_id), withCosts)
  if (!t) return new NextResponse('Not found', { status: 404 })
  // Note the use at most every 10 minutes (spreadsheets refresh often).
  const last = link.last_used_at ? Date.parse(String(link.last_used_at)) : 0
  if (Date.now() - last > 10 * 60_000) await svc.from('takeoff_links').update({ last_used_at: new Date().toISOString() }).eq('token', token)
  return new NextResponse(toCsv(takeoffCsvRows(t, withCosts)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
