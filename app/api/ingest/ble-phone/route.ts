import { NextRequest, NextResponse } from 'next/server'
import { pushPhoneLocation } from '@/lib/actions/tracker'
import { recordBeaconSightings } from '@/lib/ble-sightings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * A crew phone as a BLE gateway (Brian, Sep 9: "phone as ble gateway is a
 * must"). The app scans while it is open and, every ~20 s, posts the tags it
 * heard with the phone's fix. The phone IS an asset (the same `phone-<uid>`
 * personnel asset the Share-location page uses), so the tools it hears ride
 * with the person on the map exactly the way they ride with a truck — same
 * matcher, same strongest-signal arbitration, same custody history.
 *
 * Auth = the user's own session. Body: { beacons: [{ id, rssi }], lat, lng,
 * accuracy?, heading?, battery? }. Ids are the Tag scanner's own forms
 * (UUID:major:minor decimal, or a MAC); the matcher tolerates both.
 */
export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, mode: 'demo', matched: 0, holding: 0 })
  let body: { beacons?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown; heading?: unknown; battery?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 }) }

  const lat = Number(body.lat), lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return NextResponse.json({ ok: false, error: 'a fix is required' }, { status: 422 })
  }
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const raw = Array.isArray(body.beacons) ? body.beacons.slice(0, 60) : []
  const beacons = raw
    .map((b) => (b && typeof b === 'object' ? b as { id?: unknown; rssi?: unknown } : null))
    .filter((b): b is { id?: unknown; rssi?: unknown } => !!b)
    .map((b) => ({ id: String(b.id ?? '').trim().slice(0, 80), rssi: num(b.rssi, -127, 0) }))
    .filter((b) => /^[0-9A-Za-z:_-]{4,80}$/.test(b.id))

  // The fix lands on the phone's own asset first (creates/reactivates it and
  // enforces the session); that asset is the gateway.
  const fix = await pushPhoneLocation({ lat, lng, accuracy: num(body.accuracy, 0, 10_000), heading: num(body.heading, 0, 360), battery: num(body.battery, 0, 100) })
  if (!fix.ok || !fix.assetId) {
    return NextResponse.json({ ok: false, error: fix.reason === 'auth' ? 'sign in' : 'could not record the phone fix' }, { status: fix.reason === 'auth' ? 401 : 500 })
  }
  if (!beacons.length) return NextResponse.json({ ok: true, matched: 0, holding: 0 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: gw } = await svc.from('assets').select('id, company_id').eq('id', fix.assetId).maybeSingle()
  if (!gw) return NextResponse.json({ ok: false, error: 'gateway asset missing' }, { status: 500 })
  const out = await recordBeaconSightings(svc, gw, { lat, lng, timestamp: new Date().toISOString() }, beacons)
  return NextResponse.json({ ok: true, ...out })
}
