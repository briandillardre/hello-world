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
  // View levels (094): the switch lives on the Tag scanner page and the report
  // also shares the person's location, so both levels must still be on — a
  // phone whose switch was flipped before a Master narrowed the role must not
  // keep reporting (sec-check, Sep 9). REAL permissions: the physical phone is
  // the signed-in person's, a view-as preview is irrelevant here.
  const { getRealPermissions } = await import('@/lib/permissions-server')
  const perms = await getRealPermissions()
  if (!perms.userId) return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
  if (!perms.features.includes('tags') || !perms.features.includes('track')) {
    return NextResponse.json({ ok: false, error: 'not allowed' }, { status: 403 })
  }
  let body: { beacons?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown; heading?: unknown; battery?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 }) }

  const lat = Number(body.lat), lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return NextResponse.json({ ok: false, error: 'a fix is required' }, { status: 422 })
  }
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  // A gateway fix has to be a fix: a 10 km circle would pin every tag heard
  // to the wrong side of town (sec-check, Sep 9).
  const accuracy = num(body.accuracy, 0, 10_000)
  if (accuracy != null && accuracy > 500) return NextResponse.json({ ok: false, error: 'fix too coarse' }, { status: 422 })
  const raw = Array.isArray(body.beacons) ? body.beacons.slice(0, 60) : []
  const beacons = raw
    .map((b) => (b && typeof b === 'object' ? b as { id?: unknown; rssi?: unknown } : null))
    .filter((b): b is { id?: unknown; rssi?: unknown } => !!b)
    // rssi capped at -20 dBm: real radios never read hotter than ~-25 at
    // contact, and an uncapped 0 would out-shout every truck's in-cab
    // -50 by the 6 dB arbitration margin (sec-check, Sep 9).
    .map((b) => ({ id: String(b.id ?? '').trim().slice(0, 80), rssi: num(b.rssi, -127, -20) }))
    .filter((b) => /^[0-9A-Za-z:_-]{4,80}$/.test(b.id))

  // The fix lands on the phone's own asset first (creates/reactivates it and
  // enforces the session); that asset is the gateway.
  const fix = await pushPhoneLocation({ lat, lng, accuracy, heading: num(body.heading, 0, 360), battery: num(body.battery, 0, 100) })
  if (!fix.ok || !fix.assetId) {
    return NextResponse.json({ ok: false, error: fix.reason === 'auth' ? 'sign in' : 'could not record the phone fix' }, { status: fix.reason === 'auth' ? 401 : 500 })
  }
  if (!beacons.length) return NextResponse.json({ ok: true, matched: 0, holding: 0 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: gw } = await svc.from('assets').select('id, company_id').eq('id', fix.assetId).maybeSingle()
  if (!gw) return NextResponse.json({ ok: false, error: 'gateway asset missing' }, { status: 500 })
  // The phone writes iBeacon major/minor in DECIMAL (parseIBeacon) — the
  // matcher must not also run the hex reading of the same digits.
  const out = await recordBeaconSightings(svc, gw, { lat, lng, timestamp: new Date().toISOString() }, beacons, { reportedAs: 'dec' })
  return NextResponse.json({ ok: true, ...out })
}
