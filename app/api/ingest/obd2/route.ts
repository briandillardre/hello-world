import { NextRequest, NextResponse } from 'next/server'
import { verifyIngestKey } from '@/lib/ingest-auth'
import { recordTelemetry, safeBag, plausibleTimestamp } from '@/lib/telemetry-ingest'
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
  // Same plausibility window as the flespi webhook (sec-check, Sep 21): a
  // fix dated in the future sits as the asset's latest forever, and a
  // timestamp that is not a time at all used to reach the readings row and
  // break every later merge for that key.
  const ts = plausibleTimestamp(timestamp)
  if (ts === false) {
    return NextResponse.json({ error: 'timestamp must be an ISO 8601 date within the last 30 days' }, { status: 422 })
  }
  const at = ts ?? new Date().toISOString()
  const bag = safeBag(body)

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

  const { error: insertError } = await supabase.from('asset_locations').insert({
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
    timestamp: at,
    raw: { speed, odometer, engine_on, ...bag },
  })
  if (insertError) {
    console.error(`obd2 ingest: insert failed for ${asset.id}: ${insertError.code} ${insertError.message}`)
    return NextResponse.json({ error: 'Could not store the fix' }, { status: 500 })
  }
  // Truck readings (115): everything but the position columns, folded into
  // the asset's stored map so the panel and the AI see it in words. Only for
  // a fix that was actually stored — the readings row must never say more
  // than the history does.
  {
    const { tracker_id: _t, lat: _la, lng: _ln, accuracy: _ac, battery: _b, timestamp: _ts, ...rest } = bag
    void _t; void _la; void _ln; void _ac; void _b; void _ts
    await recordTelemetry(supabase, asset.id, asset.company_id, [{ timestamp: at, params: { speed, odometer, engine_on, ...rest } }])
  }

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
