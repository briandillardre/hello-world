import { NextRequest, NextResponse } from 'next/server'
import { verifyIngestKey } from '@/lib/ingest-auth'
import type { IngestObd2Payload } from '@/lib/types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function POST(request: NextRequest) {
  // Platform INGEST_API_KEY (timing-safe, unscoped — existing devices) or a
  // per-company key (companies.api_key — ingest scoped to that company).
  const auth = await verifyIngestKey(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IngestObd2Payload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { tracker_id, lat, lng, accuracy, battery, timestamp, speed, odometer, engine_on } = body
  if (!tracker_id || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'tracker_id, lat, and lng are required' }, { status: 422 })
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 422 })
  }

  if (isMock) {
    return NextResponse.json({ ok: true, mode: 'demo', message: 'Demo mode: OBD2 data logged (not persisted)' })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  // A company key only resolves that company's assets — another tenant's
  // tracker_id is indistinguishable from an unknown one (same 404).
  let assetQuery = supabase
    .from('assets')
    .select('id, company_id, metadata')
    .eq('tracker_id', tracker_id)
    // active-only + 082's one-active-owner index: the platform-key path
    // resolves unambiguously; deactivating an asset releases its tracker.
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
    speed: speed ?? null,
    heading: null,
    // Ignition powers the idle math (034) — the OBD payload's engine_on IS
    // ignition; it was landing only in raw/metadata, so direct-OBD assets
    // read as "phantom idle" all day (code review, Jul 21).
    ignition: typeof engine_on === 'boolean' ? engine_on : null,
    timestamp: timestamp ?? new Date().toISOString(),
    raw: { speed, odometer, engine_on, ...body },
  })

  // Merge telemetry into metadata — never replace the whole jsonb blob,
  // and skip the write entirely when the payload carries neither field.
  if (odometer !== undefined || engine_on !== undefined) {
    await supabase
      .from('assets')
      .update({
        metadata: {
          ...((asset.metadata as Record<string, unknown> | null) ?? {}),
          ...(odometer !== undefined ? { odometer } : {}),
          ...(engine_on !== undefined ? { engine_on } : {}),
        },
      })
      .eq('id', asset.id)
  }

  return NextResponse.json({ ok: true })
}
