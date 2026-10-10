import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect, visibleAssets } from '@/lib/permissions'
import { getCurrentCompanyId, getCompanySettings } from '@/lib/db/company'
import { getAssets } from '@/lib/db/assets'
import { getVehicleGlance, isScoredAsset } from '@/lib/db/driving'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { safeTz } from '@/lib/dates'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * One vehicle's driving glance for the map panel — the same numbers and the
 * same gate as the asset page's Driving card: the `reports` view level, never
 * a Prospective Client, only a vehicle the caller (or the view-as target) may
 * see (111), read with the caller's client so RLS + 134 decide the rest.
 * `{ glance: null }` = not an OBD / wired road vehicle, or not visible.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = (params.id ?? '').trim()
  if (!isMock && !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  let db = null
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    db = createClient()
    const { data: auth } = await db.auth.getUser()
    if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (ipRateLimited(req, 'safety-asset', 60)) return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })

  const [perms, companyId, settings] = await Promise.all([getMyPermissions(), getCurrentCompanyId(), getCompanySettings()])
  const none = NextResponse.json({ glance: null }, { headers: { 'Cache-Control': 'private, no-store' } })
  if (!perms.features.includes('reports') || isProspect(perms)) return none

  const fleet = visibleAssets((await getAssets(companyId)).filter((a) => a.active), perms)
    .map((a) => ({ id: a.id, name: a.name, type: a.type, tracker_id: a.tracker_id, metadata: (a.metadata ?? null) as Record<string, unknown> | null }))
  const self = fleet.find((a) => a.id === id)
  if (!self || !isScoredAsset(self)) return none

  const tz = safeTz(resolveDigestPrefs(settings.digest_prefs).tz)
  const glance = await getVehicleGlance(db, { companyId, tz, asset: self, fleet, days: 30 })
  return NextResponse.json({ glance, days: 30 }, { headers: { 'Cache-Control': 'private, no-store' } })
}
