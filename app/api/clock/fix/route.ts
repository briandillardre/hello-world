import { NextRequest, NextResponse } from 'next/server'
import { recordPhoneLocation } from '@/lib/phone-location'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * One (or a small batch of) GPS fixes from a clocked-in phone. The shift
 * tracker posts here — from the page while the app is open, from the native
 * background watcher when it is not. Each fix lands on the person's
 * `phone-<uid>` asset through the same door Share location uses; the time
 * card's GPS column is built from exactly these rows (migration 103).
 *
 * Auth = the session. Body: { fixes: [{ lat, lng, accuracy?, speed?,
 * heading?, at? }] } (≤ 50) or a single fix at the top level.
 *
 * Only the OPEN shift's points are kept (133): a fix stamped before the
 * clock-in (2 min of slack for the phone's clock) is dropped — an offline
 * queue flushed at the next clock-in must not file last evening's off-clock
 * trail, and nobody can type a trail into a shift that already closed. Those
 * points get a 2xx (saved 0) so the phone lets go of them.
 */
type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; at: string | null }

const HOURLY_CAP = 240 // honest max ≈ 120/h at the 30 s cadence + move bursts
const MIN_GAP_MS = 10_000
/** Posts per minute per person: the recorder sends every 30 s (sooner after a
 *  40 m move) and replays a dead zone in batches of 50 — 20 is generous. */
const POSTS_PER_MIN = 20
/** A fix may carry a time this far before the clock-in (the phone's clock). */
const CLOCK_IN_SLACK_MS = 2 * 60_000
const HOUR_MS = 3_600_000

export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, mode: 'demo', saved: 0 })
  // Only a clocked-in person with the Time clock view level records shift
  // fixes, and only so many per hour — a trail cannot be typed in from home
  // after the fact, and a loop cannot burn the database's IO (sec-check P2).
  const { getRealPermissions } = await import('@/lib/permissions-server')
  const perms = await getRealPermissions()
  if (!perms.userId || !perms.companyId) return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
  if (!perms.features.includes('clock')) return NextResponse.json({ ok: false, error: 'not allowed' }, { status: 403 })
  const { keyRateLimited } = await import('@/lib/rate-limit')
  if (keyRateLimited(perms.userId, 'clock-fix', POSTS_PER_MIN)) {
    return NextResponse.json({ ok: false, error: 'too many reports' }, { status: 429 })
  }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: open } = await svc.from('time_entries').select('id, clock_in_at')
    .eq('company_id', perms.companyId).eq('user_id', perms.userId).is('clock_out_at', null)
    .order('clock_in_at', { ascending: false }).limit(1).maybeSingle()
  if (!open) return NextResponse.json({ ok: false, error: 'not clocked in' }, { status: 409 })
  const shiftFromMs = Date.parse(open.clock_in_at as string) - CLOCK_IN_SLACK_MS
  if (!Number.isFinite(shiftFromMs)) return NextResponse.json({ ok: false, error: 'not clocked in' }, { status: 409 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 }) }
  const obj = body && typeof body === 'object' ? body as { fixes?: unknown } & Record<string, unknown> : {}
  const raw = Array.isArray(obj.fixes) ? obj.fixes.slice(0, 50) : [obj]
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const nowMs = Date.now()
  // The time a fix is filed at: its own, clamped to [now − 24 h, now].
  const fixMs = (f: Fix) => {
    const t = f.at ? Date.parse(f.at) : nowMs
    return Math.min(nowMs, Math.max(nowMs - 24 * HOUR_MS, Number.isFinite(t) ? t : nowMs))
  }
  const fixes: Fix[] = []
  let usable = 0
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const r = f as Record<string, unknown>
    const lat = num(r.lat, -90, 90), lng = num(r.lng, -180, 180)
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue
    const accuracy = num(r.accuracy, 0, 10_000)
    if (accuracy != null && accuracy > 1000) continue // not a fix, a county
    const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? r.at : null
    const fix: Fix = { lat, lng, accuracy, speed: num(r.speed, 0, 300), heading: num(r.heading, 0, 360), at }
    usable++
    // Before this shift began: not this shift's to keep (133).
    if (fixMs(fix) < shiftFromMs) continue
    fixes.push(fix)
  }
  if (!usable) return NextResponse.json({ ok: false, error: 'no usable fix' }, { status: 422 })
  if (!fixes.length) return NextResponse.json({ ok: true, saved: 0, withheld: 0, paused: null })

  // Oldest first so the asset's last-seen ends on the newest; fixes closer
  // than the tracker's own move cadence to the previous one are dropped.
  fixes.sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity))
  const spacedAll: Fix[] = []
  for (const f of fixes) {
    const prev = spacedAll[spacedAll.length - 1]
    if (prev && f.at && prev.at && Date.parse(f.at) - Date.parse(prev.at) < MIN_GAP_MS) continue
    spacedAll.push(f)
  }

  const { data: phone } = await svc.from('assets').select('id')
    .eq('company_id', perms.companyId).eq('tracker_id', `phone-${perms.userId}`).limit(1).maybeSingle()
  if (phone) {
    // Counted by the fixes' OWN time, not arrival: a phone coming out of a
    // dead zone replays hours of older fixes in a burst and must not be
    // refused for it; a live loop stamps everything "now" and is. The window
    // reaches back to this batch's oldest fix (never under an hour) and
    // allows HOURLY_CAP per hour of it — backdated points count too (133).
    const oldestMs = Math.min(nowMs - HOUR_MS, ...spacedAll.map(fixMs))
    const allowance = HOURLY_CAP * Math.max(1, Math.ceil((nowMs - oldestMs) / HOUR_MS))
    const { count } = await svc.from('asset_locations').select('id', { count: 'exact', head: true })
      .eq('asset_id', phone.id).gte('timestamp', new Date(oldestMs).toISOString())
    if ((count ?? 0) >= allowance) return NextResponse.json({ ok: false, error: 'too many fixes this hour' }, { status: 429 })
  }

  // Privacy zones (132/133): a point inside a zone an Admin marked private
  // (or within its accuracy, 50–150 m, of the edge — a site or yard always
  // wins) is not kept, on the clock or not. A zone read that fails keeps
  // nothing and asks the phone to send the batch again (it holds it until a
  // 2xx). `withheld` counts them and `paused` says the NEWEST fix was inside
  // one, so the clock card can say recording stopped there — but only for
  // zones this person can see: inside someone else's personal ("only me")
  // zone nothing is kept either, and the reply counts the point as saved,
  // exactly as outside it (posting made-up points must not map a home).
  const { loadPrivacyZones } = await import('@/lib/location-privacy')
  const { privacyZoneAt } = await import('@/lib/location-policy')
  let zones: Awaited<ReturnType<typeof loadPrivacyZones>>
  try { zones = await loadPrivacyZones(svc, perms.companyId) } catch {
    return NextResponse.json({ ok: false, error: 'could not check privacy zones — will retry' }, { status: 503 })
  }
  const spaced: Fix[] = []
  let withheld = 0
  let unseen = 0
  let paused: 'privacy_zone' | null = null
  for (const f of spacedAll) {
    const hit = privacyZoneAt(f, zones, { accuracyM: f.accuracy })
    const seen = !!hit && !!privacyZoneAt(f, zones, { accuracyM: f.accuracy, onlyVisibleTo: perms.userId })
    if (!hit) spaced.push(f)
    else if (seen) withheld++
    else unseen++
    if (f === spacedAll[spacedAll.length - 1]) paused = hit && seen ? 'privacy_zone' : null
  }
  if (!spaced.length) return NextResponse.json({ ok: true, saved: unseen, withheld, paused })
  // One round trip per batch, not four per fix (a 50-fix dead-zone batch used
  // to be ~200 queries inside maxDuration): the phone asset is created (or
  // reactivated) through the one door for the FIRST fix when it does not
  // exist yet, the rest go in as one insert, the map revalidates once.
  let saved = 0
  let assetId = phone?.id ?? null
  let rest = spaced
  if (!assetId) {
    const first = await recordPhoneLocation({ userId: perms.userId, companyId: perms.companyId }, { ...spaced[0], source: 'shift' })
    // A zone marked private since the read above (nothing was kept): the
    // phone resends the batch and the next read files it the same way.
    if (first.withheld === 'privacy_zone') return NextResponse.json({ ok: false, error: 'could not check privacy zones — will retry' }, { status: 503 })
    if (!first.ok || !first.assetId) return NextResponse.json({ ok: false, error: 'could not record the fix' }, { status: 500 })
    assetId = first.assetId
    saved = 1
    rest = spaced.slice(1)
  } else {
    await svc.from('assets').update({ active: true }).eq('id', assetId).eq('active', false)
  }
  if (rest.length) {
    const rows = rest.map((f) => ({
      asset_id: assetId, company_id: perms.companyId,
      lat: f.lat, lng: f.lng, accuracy: f.accuracy, speed: f.speed, heading: f.heading,
      timestamp: new Date(fixMs(f)).toISOString(),
      raw: { source: 'phone', via: 'shift', lat: f.lat, lng: f.lng, accuracy: f.accuracy, speed: f.speed, heading: f.heading },
    }))
    const { error } = await svc.from('asset_locations').insert(rows)
    if (!error) saved += rows.length
    else if (!saved) return NextResponse.json({ ok: false, error: 'could not record the fixes' }, { status: 500 })
  }
  if (saved) { const { revalidatePath } = await import('next/cache'); revalidatePath('/map') }
  return NextResponse.json({ ok: saved > 0, saved: saved + unseen, withheld, paused })
}
