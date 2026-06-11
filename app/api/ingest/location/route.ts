import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import type { IngestLocationPayload } from '@/lib/types'

const HMAC_SECRET = 'hammertrack-api-key-comparison'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

function verifyApiKey(request: NextRequest): boolean {
  // Dedicated ingest credential — never the Supabase service-role key, which
  // would hand every tracker integration full database access.
  const expected = process.env.INGEST_API_KEY
  // Demo mode accepts unauthenticated posts (nothing is persisted);
  // with a real database but no key configured, fail closed.
  if (!expected) return isMock

  const key = request.headers.get('x-api-key') ?? ''
  if (!key) return false

  try {
    const hashA = createHmac('sha256', HMAC_SECRET).update(key).digest()
    const hashB = createHmac('sha256', HMAC_SECRET).update(expected).digest()
    return timingSafeEqual(hashA, hashB)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IngestLocationPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { tracker_id, lat, lng, accuracy, battery, timestamp } = body
  if (!tracker_id || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'tracker_id, lat, and lng are required' }, { status: 422 })
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 422 })
  }

  if (isMock) {
    return NextResponse.json({ ok: true, mode: 'demo', message: 'Demo mode: location logged (not persisted)' })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  const { data: asset } = await supabase
    .from('assets')
    .select('id, company_id')
    .eq('tracker_id', tracker_id)
    .single()

  if (!asset) {
    return NextResponse.json({ error: 'No asset found with that tracker_id' }, { status: 404 })
  }

  await supabase.from('asset_locations').insert({
    asset_id: asset.id,
    company_id: asset.company_id,
    lat,
    lng,
    accuracy: accuracy ?? null,
    battery: battery ?? null,
    speed: null,
    heading: null,
    timestamp: timestamp ?? new Date().toISOString(),
    raw: body,
  })

  return NextResponse.json({ ok: true })
}
