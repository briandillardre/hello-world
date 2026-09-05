import { NextRequest, NextResponse } from 'next/server'
import { resolvePlaces } from '@/lib/reverse-geocode'
import { formatPlace } from '@/lib/place-label'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * "Where is it" for a batch of points the assets list could not answer from
 * the company's zones: `?pts=lat,lng;lat,lng` (≤100) → `{ places: { key:
 * "near 304 N Church St, Greenville" | "in Greenville, SC" | null } }` keyed
 * by lib/place-label's cell key. Cached lookups are one table read; at most
 * 25 cells per call hit the free geocoders (the rest come back unknown and
 * are asked on the next load). Signed-in users only — this must not become
 * anyone's free geocoding proxy.
 */
export async function GET(req: NextRequest) {
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: auth } = await createClient().auth.getUser()
    if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const raw = req.nextUrl.searchParams.get('pts') ?? ''
  const pts: { lat: number; lng: number }[] = []
  for (const pair of raw.split(';')) {
    const [a, b] = pair.split(',')
    const lat = Number(a), lng = Number(b)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) pts.push({ lat, lng })
    if (pts.length >= 100) break
  }
  if (!pts.length) return NextResponse.json({ places: {} })
  const parts = await resolvePlaces(pts)
  const places: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parts)) places[k] = formatPlace(v)
  return NextResponse.json({ places }, { headers: { 'Cache-Control': 'private, max-age=300' } })
}
