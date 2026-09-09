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

export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, mode: 'demo', saved: 0 })
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

  // Oldest first so the asset's last-seen ends on the newest.
  fixes.sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity))
  let saved = 0
  for (const f of fixes) {
    const res = await pushPhoneLocation({ ...f, source: 'shift' })
    if (res.reason === 'auth') return NextResponse.json({ ok: false, error: 'sign in' }, { status: 401 })
    if (res.ok) saved++
  }
  return NextResponse.json({ ok: saved > 0, saved })
}
