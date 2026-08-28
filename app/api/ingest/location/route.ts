import { NextRequest, NextResponse } from 'next/server'
import { verifyIngestKey } from '@/lib/ingest-auth'
import type { IngestLocationPayload } from '@/lib/types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function POST(request: NextRequest) {
  // Platform INGEST_API_KEY (timing-safe, unscoped — existing devices) or a
  // per-company key (companies.api_key — ingest scoped to that company).
  const auth = await verifyIngestKey(request)
  if (!auth.ok) {
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

  // A company key only resolves that company's assets — another tenant's
  // tracker_id is indistinguishable from an unknown one (same 404).
  let assetQuery = supabase
    .from('assets')
    .select('id, company_id')
    .eq('tracker_id', tracker_id)
    // active-only + 082's one-active-owner index (same rule as obd2).
    .eq('active', true)
  if (auth.companyId) assetQuery = assetQuery.eq('company_id', auth.companyId)
  const { data: asset } = await assetQuery.single()

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
