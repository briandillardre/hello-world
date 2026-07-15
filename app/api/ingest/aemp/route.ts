import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { parseAempFleet } from '@/lib/aemp'
import { applyAempReadings } from '@/lib/aemp-ingest'

/**
 * Push endpoint for ISO 15143-3 (AEMP 2.0) Fleet data. Most OEM feeds are
 * pull-only (that's the oem-sync cron), but some aggregators can POST a Fleet
 * snapshot here, and it's the clean path for backfills and connector testing.
 *
 * Auth: shared INGEST_API_KEY via x-api-key (same credential as the OBD2 /
 * location ingest — never the Supabase service-role key). Company is resolved
 * from a required `?company=<id>` param, since a raw ISO 15143-3 payload has no
 * tenant of its own. Machines map to assets by serial / `aemp:<serial>`.
 */

const HMAC_SECRET = 'hammertrack-api-key-comparison'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

function verifyApiKey(request: NextRequest): boolean {
  const expected = process.env.INGEST_API_KEY
  if (!expected) return isMock
  const key = request.headers.get('x-api-key') ?? ''
  if (!key) return false
  try {
    const a = createHmac('sha256', HMAC_SECRET).update(key).digest()
    const b = createHmac('sha256', HMAC_SECRET).update(expected).digest()
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const readings = parseAempFleet(body)
  if (readings.length === 0) {
    return NextResponse.json({ error: 'No Equipment found in ISO 15143-3 payload' }, { status: 422 })
  }

  const provider = request.nextUrl.searchParams.get('provider') || 'custom'

  if (isMock) {
    return NextResponse.json({
      ok: true,
      mode: 'demo',
      parsed: readings.length,
      sample: readings[0],
      message: 'Demo mode: AEMP data parsed (not persisted)',
    })
  }

  const companyId = request.nextUrl.searchParams.get('company')
  if (!companyId) {
    return NextResponse.json({ error: 'company query param required' }, { status: 400 })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  const result = await applyAempReadings(supabase, companyId, provider, readings)
  return NextResponse.json({ ok: true, parsed: readings.length, ...result })
}
