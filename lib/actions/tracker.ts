'use server'

import { revalidatePath } from 'next/cache'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// One phone asset per user, keyed by a deterministic tracker id.
const phoneTracker = (userId: string) => `phone-${userId}`

/** What Go Live sends: a fix taken just now. */
export interface PhoneFix {
  lat: number
  lng: number
  speed?: number | null
  accuracy?: number | null
  heading?: number | null
  battery?: number | null
}

/** Go Live posts every ~8 s (7–8 a minute); anything past this is not the app. */
const PUSH_PER_MIN = 12

/**
 * Go Live (/track, "Show me on the fleet map"): push one GPS fix from the
 * signed-in person's phone onto the fleet map. Auth is the Supabase session
 * cookie; the write itself is lib/phone-location.ts `recordPhoneLocation`
 * (the one door — it provisions the person's "phone" asset on first use).
 *
 * This is the CLIENT's door, so it checks who may use it (133): the Share
 * location view level (which a Prospective Client never holds — 118: a
 * prospect must never appear on the map), never inside a "view app as"
 * preview (it would record the previewer's own phone under the preview),
 * at most PUSH_PER_MIN a minute, and the fix is always "now" — a client
 * cannot backdate a trail or choose how it is filed.
 *
 * Privacy zones (132): a fix inside a zone an Admin marked private is never
 * kept. The reply says `withheld: 'privacy_zone'` with ok: true so the
 * sharing screen can say recording paused — but only for a zone this person
 * can see (company-wide, or their own). Inside someone else's personal
 * ("only me") zone nothing is kept either, and the reply is exactly what a
 * kept fix gets: posting made-up points must not map a home nobody else may
 * see.
 */
export async function pushPhoneLocation(fix: PhoneFix): Promise<{ ok: boolean; reason?: string; withheld?: 'privacy_zone' }> {
  const lat = fix?.lat, lng = fix?.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'coords' }
  }
  if (isMock) return { ok: false, reason: 'demo' }

  const { getRealPermissions, getMyPermissions } = await import('@/lib/permissions-server')
  const { isProspect } = await import('@/lib/permissions')
  const [real, mine] = await Promise.all([getRealPermissions(), getMyPermissions()])
  if (!real.userId || !real.companyId) return { ok: false, reason: 'auth' }
  if (mine.viewingAs) return { ok: false, reason: 'preview' }
  if (isProspect(real) || !real.features.includes('track')) return { ok: false, reason: 'not_allowed' }
  const { keyRateLimited } = await import('@/lib/rate-limit')
  if (keyRateLimited(real.userId, 'phone-push', PUSH_PER_MIN)) return { ok: false, reason: 'rate' }

  const { recordPhoneLocation } = await import('@/lib/phone-location')
  const r = await recordPhoneLocation({ userId: real.userId, companyId: real.companyId }, {
    lat, lng, speed: fix.speed ?? null, accuracy: fix.accuracy ?? null, heading: fix.heading ?? null, battery: fix.battery ?? null,
    source: 'live',
  })
  if (r.withheld === 'privacy_zone') return r.hiddenZone ? { ok: true } : { ok: true, withheld: 'privacy_zone' }
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

/** Stop sharing: deactivate the phone asset so its pin drops off the fleet map
 *  (history is kept). Next share reactivates it. */
export async function stopPhoneShare(): Promise<{ ok: boolean }> {
  if (isMock) return { ok: false }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  const companyId = profile?.company_id ?? user.id
  const svc = createServiceClient()
  await svc.from('assets').update({ active: false }).eq('company_id', companyId).eq('tracker_id', phoneTracker(user.id))
  revalidatePath('/map')
  return { ok: true }
}
