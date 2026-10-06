import { NextRequest, NextResponse } from 'next/server'
import { recordPhoneLocation } from '@/lib/phone-location'
import { recordBeaconSightings } from '@/lib/ble-sightings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * A crew phone as a BLE gateway (Brian, Sep 9: "phone as ble gateway is a
 * must"). The app scans while it is open and posts the tags it heard with
 * the phone's fix. What happens next depends on WHERE and WHEN (location
 * privacy, migration 132 — lib/location-policy.ts):
 *
 *  • On the clock, outside privacy zones: the fix lands on the person's own
 *    `phone-<uid>` asset and the tools it hears ride WITH it — the same
 *    matcher, strongest-signal arbitration and custody history as a truck.
 *  • Off the clock, or inside a privacy zone: nothing of the person is kept.
 *    The phone asset is not touched (not even created); each tag it heard is
 *    filed anonymously in `tool_sightings` — on a ~250 m grid cell (a privacy
 *    zone's: the cell of its centre), or at its exact spot when its asset is
 *    in recovery. "Stop sharing" still means the phone reports nothing.
 *
 * Auth = the user's own session. Body: { beacons: [{ id, rssi }], lat, lng,
 * accuracy?, heading?, battery? }. Ids are the Tag scanner's own forms
 * (UUID:major:minor decimal, or a MAC); the matcher tolerates both.
 * Reply: { ok, matched, holding, mode: 'custody' | 'anonymous', withheld? }
 * — the phone's status line says which, so the person can see it. Inside
 * someone else's personal ("only me") privacy zone the reply is the one the
 * same report gets outside any zone (133): nothing of the person is kept
 * there either, but a reply must never map a zone they cannot see.
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
  if (!perms.userId || !perms.companyId) return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
  if (!perms.features.includes('tags') || !perms.features.includes('track')) {
    return NextResponse.json({ ok: false, error: 'not allowed' }, { status: 403 })
  }
  // The app posts at most every 20 s (3 a minute) and backs off when quiet;
  // anything past 8 a minute is not the app. Per instance like every limiter
  // here — it ends a loop writing into the table the ledger scans, not a
  // careful attacker (sec-check, Oct 4).
  const { keyRateLimited } = await import('@/lib/rate-limit')
  if (keyRateLimited(perms.userId, 'ble-phone', 8)) {
    return NextResponse.json({ ok: false, error: 'too many reports' }, { status: 429 })
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

  const companyId = perms.companyId
  const userId = perms.userId
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { loadPrivacyZones, isOnShift, activeRecoveryIds, recordAnonymousSightings } = await import('@/lib/location-privacy')
  const { phoneFixPolicy, privacyZoneAt, reporterRank } = await import('@/lib/location-policy')

  // Where the person is in the policy. A privacy-zone read that fails keeps
  // nothing and asks the phone to try again — never "keep it, probably fine".
  let zones: Awaited<ReturnType<typeof loadPrivacyZones>>
  try { zones = await loadPrivacyZones(svc, companyId) } catch {
    return NextResponse.json({ ok: false, error: 'could not check privacy zones — will retry' }, { status: 503 })
  }
  let zone = privacyZoneAt({ lat, lng }, zones, { accuracyM: accuracy })
  // Read even inside a zone: the reply for someone else's personal zone has
  // to be the one this person gets outside it (custody on the clock).
  const onShift = await isOnShift(svc, companyId, userId)
  const policy = phoneFixPolicy({ source: 'gateway', onShift, privacyZone: zone })

  if (policy.custody) {
    // The fix lands on the phone's own asset first (creates/reactivates it);
    // that asset is the gateway. `userId`/`companyId` are this session's.
    const fix = await recordPhoneLocation({ userId, companyId }, {
      lat, lng, accuracy, heading: num(body.heading, 0, 360), battery: num(body.battery, 0, 100),
      source: 'gateway',
      // Never revives a stopped share — the gateway is not a way back onto the map.
      reactivate: false,
    })
    if (fix.withheld === 'privacy_zone') {
      // A zone marked private between the two reads — file anonymously below,
      // at that zone's cell; without it, ask the phone to try again.
      zones = await loadPrivacyZones(svc, companyId).catch(() => ({ zones: [], work: [] }))
      zone = privacyZoneAt({ lat, lng }, zones, { accuracyM: accuracy })
      if (!zone) return NextResponse.json({ ok: false, error: 'could not check privacy zones — will retry' }, { status: 503 })
    } else {
      if (!fix.ok || !fix.assetId) {
        if (fix.reason === 'sharing_off') {
          return NextResponse.json({ ok: false, error: 'location sharing is off' }, { status: 409 })
        }
        return NextResponse.json({ ok: false, error: 'could not record the phone fix' }, { status: 500 })
      }
      if (!beacons.length) return NextResponse.json({ ok: true, matched: 0, holding: 0, mode: 'custody' })
      const { data: gw } = await svc.from('assets').select('id, company_id').eq('id', fix.assetId).maybeSingle()
      if (!gw) return NextResponse.json({ ok: false, error: 'gateway asset missing' }, { status: 500 })
      // The phone writes iBeacon major/minor in DECIMAL (parseIBeacon) — the
      // matcher must not also run the hex reading of the same digits.
      const out = await recordBeaconSightings(svc, gw, { lat, lng, timestamp: new Date().toISOString() }, beacons, { reportedAs: 'dec' })
      return NextResponse.json({ ok: true, ...out, mode: 'custody' })
    }
  }

  // Off the clock or inside a privacy zone: the person's fix is not kept and
  // their phone asset is not touched. "Stop sharing" still means it — a phone
  // whose share was stopped reports nothing at all (ship-check, Sep 12).
  // A zone this person cannot see (someone else's "only me" zone) is never
  // named in the reply (133): it reads as the same report outside any zone.
  // Inside one they CAN see too (a company-wide zone around it), it says so.
  const seenZone = !!zone && !!privacyZoneAt({ lat, lng }, zones, { accuracyM: accuracy, onlyVisibleTo: userId })
  const asIfOutside = !!zone && !seenZone
  const withheld = seenZone ? 'privacy_zone' : 'off_shift'
  const { data: phone } = await svc.from('assets').select('active, metadata')
    .eq('company_id', companyId).eq('tracker_id', `phone-${userId}`).maybeSingle()
  if (phone && phone.active === false) {
    return NextResponse.json({ ok: false, error: 'location sharing is off' }, { status: 409 })
  }
  const reply = (matched: number, placed: number) => asIfOutside && onShift
    // What the custody path answers: the tags it heard, held by this phone.
    ? { ok: true, matched, holding: matched, mode: 'custody' as const }
    : { ok: true, matched, holding: 0, ...(beacons.length ? { placed } : {}), mode: 'anonymous' as const, withheld }
  if (!beacons.length) return NextResponse.json(reply(0, 0))
  // The sighting says nothing of whose phone heard it, but it is read at the
  // phone's own visibility level (111): the owner's hidden phone stays hidden.
  const { visibilityRank, assetVisibility } = await import('@/lib/permissions')
  const visibleRank = reporterRank(phone ? visibilityRank(assetVisibility(phone.metadata)) : null, { isMaster: perms.isMaster, role: perms.role })
  const recovery = await activeRecoveryIds(svc, companyId)
  const out = await recordAnonymousSightings(svc, companyId, beacons,
    { lat, lng, timestamp: new Date().toISOString() },
    { privacyZone: zone, recovery, visibleRank },
    { reportedAs: 'dec' })
  return NextResponse.json(reply(out.matched, out.placed))
}
