import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'

export const dynamic = 'force-dynamic'

/** A zone's site cameras for the map's zone sheet (138). Read under the
 *  caller's own RLS: same company only, nothing for prospects. */
export async function GET(req: NextRequest) {
  const zone = req.nextUrl.searchParams.get('zone') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(zone)) return NextResponse.json({ cameras: [] })
  const perms = await getMyPermissions().catch(() => null)
  if (!perms || !perms.features.includes('zones')) return NextResponse.json({ cameras: [] }, { status: 403 })
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data } = await createClient().from('zone_cameras')
      .select('id, name, kind, url').eq('geofence_id', zone).order('created_at')
    return NextResponse.json({ cameras: data ?? [] })
  } catch {
    return NextResponse.json({ cameras: [] })
  }
}
