import { NextRequest, NextResponse } from 'next/server'
import { resolvePlaces } from '@/lib/reverse-geocode'
import { formatPlace, placeKey } from '@/lib/place-label'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * "Where is it" for the cells the assets list could not answer from the
 * company's zones: `?pts=lat,lng;lat,lng` → `{ places: { key: "near 304 N
 * Church St, Greenville" | "in Greenville, SC" | null } }` keyed by
 * lib/place-label's cell key.
 *
 * Only cells the caller's OWN fleet occupies right now are answered, and the
 * geocoder is handed the fleet's coordinates, never the request's (sec-check,
 * Sep 5): a self-serve account must not get a free geocoding proxy, nor probe
 * the shared cache for cells other tenants' machines have parked in. The
 * `pts` list just says which of those cells the page still needs. Cached
 * lookups are one table read; at most 25 cells per call hit the free
 * providers (the rest come back unknown and are asked on the next load).
 */
export async function GET(req: NextRequest) {
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: auth } = await createClient().auth.getUser()
    if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const companyId = await getCurrentCompanyId()
  const [rawAssets, assoc] = await Promise.all([getAssetsWithLocations(companyId), getToolAssociations(companyId)])
  const own = new Map<string, { lat: number; lng: number }>()
  for (const a of resolveToolLocations(rawAssets, assoc)) {
    if (!a.location) continue
    const k = placeKey(a.location.lat, a.location.lng)
    if (!own.has(k)) own.set(k, { lat: a.location.lat, lng: a.location.lng })
  }
  const wanted = new Set<string>()
  for (const pair of (req.nextUrl.searchParams.get('pts') ?? '').split(';')) {
    const [a, b] = pair.split(',')
    const lat = Number(a), lng = Number(b)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) wanted.add(placeKey(lat, lng))
    if (wanted.size >= 100) break
  }
  const points = Array.from(own.entries()).filter(([k]) => wanted.has(k)).map(([, p]) => p)
  if (!points.length) return NextResponse.json({ places: {} })
  const parts = await resolvePlaces(points)
  const places: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parts)) places[k] = formatPlace(v)
  return NextResponse.json({ places }, { headers: { 'Cache-Control': 'private, max-age=300' } })
}
