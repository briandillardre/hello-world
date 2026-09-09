import { NextRequest, NextResponse } from 'next/server'
import { pushPhoneLocation } from '@/lib/actions/tracker'

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
 */
type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; at: string | null }

const HOURLY_CAP = 240 // honest max ≈ 120/h at the 30 s cadence + move bursts
const MIN_GAP_MS = 10_000

export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, mode: 'demo', saved: 0 })
  // Only a clocked-in person with the Time clock view level records shift
  // fixes, and only so many per hour — a trail cannot be typed in from home
  // after the fact, and a loop cannot burn the database's IO (sec-check P2).
  const { getRealPermissions } = await import('@/lib/permissions-server')
  const perms = await getRealPermissions()
  if (!perms.userId || !perms.companyId) return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
  if (!perms.features.includes('clock')) return NextResponse.json({ ok: false, error: 'not allowed' }, { status: 403 })
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: open } = await svc.from('time_entries').select('id')
    .eq('company_id', perms.companyId).eq('user_id', perms.userId).is('clock_out_at', null).limit(1).maybeSingle()
  if (!open) return NextResponse.json({ ok: false, error: 'not clocked in' }, { status: 409 })
  const { data: phone } = await svc.from('assets').select('id')
    .eq('company_id', perms.companyId).eq('tracker_id', `phone-${perms.userId}`).limit(1).maybeSingle()
  if (phone) {
    // Counted by the fixes' OWN time, not arrival: a phone coming out of a
    // dead zone replays hours of older fixes in a burst and must not be
    // refused for it; a live loop stamps everything "now" and is.
    const { count } = await svc.from('asset_locations').select('id', { count: 'exact', head: true })
      .eq('asset_id', phone.id).gte('timestamp', new Date(Date.now() - 3_600_000).toISOString())
    if ((count ?? 0) >= HOURLY_CAP) return NextResponse.json({ ok: false, error: 'too many fixes this hour' }, { status: 429 })
  }
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 }) }
  const obj = body && typeof body === 'object' ? body as { fixes?: unknown } & Record<string, unknown> : {}
  const raw = Array.isArray(obj.fixes) ? obj.fixes.slice(0, 50) : [obj]
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const fixes: Fix[] = []
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const r = f as Record<string, unknown>
    const lat = num(r.lat, -90, 90), lng = num(r.lng, -180, 180)
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue
    const accuracy = num(r.accuracy, 0, 10_000)
    if (accuracy != null && accuracy > 1000) continue // not a fix, a county
    const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? r.at : null
    fixes.push({ lat, lng, accuracy, speed: num(r.speed, 0, 300), heading: num(r.heading, 0, 360), at })
  }
  if (!fixes.length) return NextResponse.json({ ok: false, error: 'no usable fix' }, { status: 422 })

  // Oldest first so the asset's last-seen ends on the newest; fixes closer
  // than the tracker's own move cadence to the previous one are dropped.
  fixes.sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity))
  const spaced: Fix[] = []
  for (const f of fixes) {
    const prev = spaced[spaced.length - 1]
    if (prev && f.at && prev.at && Date.parse(f.at) - Date.parse(prev.at) < MIN_GAP_MS) continue
    spaced.push(f)
  }
  // One round trip per batch, not four per fix (a 50-fix dead-zone batch used
  // to be ~200 queries inside maxDuration): the phone asset is created (or
  // reactivated) through pushPhoneLocation for the FIRST fix when it does not
  // exist yet, the rest go in as one insert, the map revalidates once.
  let saved = 0
  let assetId = phone?.id ?? null
  let rest = spaced
  if (!assetId) {
    const first = await pushPhoneLocation({ ...spaced[0], source: 'shift' })
    if (first.reason === 'auth') return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
    if (!first.ok || !first.assetId) return NextResponse.json({ ok: false, error: 'could not record the fix' }, { status: 500 })
    assetId = first.assetId
    saved = 1
    rest = spaced.slice(1)
  } else {
    await svc.from('assets').update({ active: true }).eq('id', assetId).eq('active', false)
  }
  if (rest.length) {
    const nowMs = Date.now()
    const rows = rest.map((f) => {
      const t = f.at ? Date.parse(f.at) : nowMs
      const atMs = Math.min(nowMs, Math.max(nowMs - 24 * 3_600_000, Number.isFinite(t) ? t : nowMs))
      return {
        asset_id: assetId, company_id: perms.companyId,
        lat: f.lat, lng: f.lng, accuracy: f.accuracy, speed: f.speed, heading: f.heading,
        timestamp: new Date(atMs).toISOString(),
        raw: { source: 'phone', via: 'shift', lat: f.lat, lng: f.lng, accuracy: f.accuracy, speed: f.speed, heading: f.heading },
      }
    })
    const { error } = await svc.from('asset_locations').insert(rows)
    if (!error) saved += rows.length
    else if (!saved) return NextResponse.json({ ok: false, error: 'could not record the fixes' }, { status: 500 })
  }
  if (saved) { const { revalidatePath } = await import('next/cache'); revalidatePath('/map') }
  return NextResponse.json({ ok: saved > 0, saved })
}
