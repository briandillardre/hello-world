import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { normalizeMessage, type FlespiMessage, type NormalizedReading } from '@/lib/flespi'

const HMAC_SECRET = 'hammertrack-flespi-token-comparison'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

function verifyToken(request: NextRequest): boolean {
  const expected = process.env.FLESPI_WEBHOOK_TOKEN
  // Fail closed: with a real database but no webhook token configured,
  // reject rather than accept unauthenticated location writes.
  if (!expected) return isMock

  const token = request.headers.get('x-flespi-token') ?? ''
  if (!token) return false
  try {
    const a = createHmac('sha256', HMAC_SECRET).update(token).digest()
    const b = createHmac('sha256', HMAC_SECRET).update(expected).digest()
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // flespi posts either a single message or an array of messages.
  const messages: FlespiMessage[] = Array.isArray(body) ? body : [body as FlespiMessage]
  const normalized = messages.map(normalizeMessage).filter((r): r is NormalizedReading => r !== null)

  if (normalized.length === 0) {
    return NextResponse.json({ error: 'No valid messages (need ident + position)' }, { status: 422 })
  }

  if (isMock) {
    return NextResponse.json({
      ok: true,
      mode: 'demo',
      accepted: normalized.length,
      beacons_seen: normalized.reduce((n, r) => n + r.beacons.length, 0),
      message: 'Demo mode: flespi data parsed (not persisted)',
    })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  let persisted = 0
  for (const r of normalized) {
    const { data: asset } = await supabase
      .from('assets')
      .select('id, company_id')
      .eq('tracker_id', r.tracker_id)
      .single()
    if (!asset) continue

    await supabase.from('asset_locations').insert({
      asset_id: asset.id,
      company_id: asset.company_id,
      lat: r.lat,
      lng: r.lng,
      speed: r.speed,
      heading: r.heading,
      battery: r.battery,
      accuracy: null,
      timestamp: r.timestamp,
      raw: { source: 'flespi' },
    })
    persisted++

    // Associate detected BLE beacons (tools) with this gateway asset.
    // Convention: a tool asset's `tracker_id` is set to its BLE beacon ID/MAC
    // (the same value the gateway reports in ble.beacons[].id). Register tools
    // with their beacon UUID as the tracker_id for this lookup to match.
    for (const beacon of r.beacons) {
      const { data: tool } = await supabase
        .from('assets')
        .select('id')
        .eq('company_id', asset.company_id)
        .eq('tracker_id', beacon.id)
        .single()
      if (!tool) continue
      await supabase.from('tool_associations').upsert(
        {
          company_id: asset.company_id,
          tool_asset_id: tool.id,
          gateway_asset_id: asset.id,
          rssi: beacon.rssi,
          last_seen: r.timestamp,
        },
        { onConflict: 'tool_asset_id' }
      )
    }
  }

  return NextResponse.json({ ok: true, persisted })
}
